import type { JSONContent } from '@tiptap/react'
import { extractPlainText } from '../lib/tiptap'
import { uniqueSlug } from '../lib/slug'
import type {
  ClassRow,
  ClassWithCount,
  DocumentListItem,
  DocumentRow,
} from '../types/database'
import type { ClassInput } from './classes'
import type { SaveResult } from './documents'
import { buildSnippet, rankHits, SEARCH_LIMIT, type SearchHit } from './searchResults'

/**
 * Browser-local storage for people using the app without an account.
 *
 * Deliberately mirrors the Supabase service contracts (same row shapes, same
 * SaveResult, same cascade-delete behaviour) so pages can call one API and stay
 * unaware of which backend is active. Anything that diverges here becomes a bug
 * that only reproduces for signed-out users.
 *
 * Guest data is intentionally NOT durable: it lives on one device, in one
 * browser profile, and is cleared once migrated into an account.
 */

const CLASSES_KEY = 'margin.guest.classes'
const DOCUMENTS_KEY = 'margin.guest.documents'
/** Local id -> remote id, so an interrupted migration resumes instead of duplicating. */
const MIGRATION_KEY = 'margin.guest.migration'

/** Stand-in for auth.uid() so row shapes match the Postgres tables. */
export const GUEST_USER_ID = 'guest'

// ---------------------------------------------------------------------------
// storage failure
//
// A write to localStorage can fail, and until this existed it failed silently:
// the error was logged and the caller carried on as though the note had been
// saved. The UI then said "Saved" for a note that only existed in a React
// state variable, which is the worst possible lie a note-taking app can tell.
// ---------------------------------------------------------------------------

export type StorageFailureReason = 'quota' | 'unavailable' | 'unknown'

/** Thrown by every guest mutation whose write did not reach storage. */
export class GuestStorageError extends Error {
  readonly reason: StorageFailureReason

  constructor(reason: StorageFailureReason, message: string, options?: { cause?: unknown }) {
    super(message, options as ErrorOptions)
    this.name = 'GuestStorageError'
    this.reason = reason
  }
}

/** Legacy Firefox name and the two numeric codes browsers still report. */
const QUOTA_NAMES = new Set(['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED'])
const QUOTA_CODES = new Set([22, 1014])
const UNAVAILABLE_NAMES = new Set(['SecurityError', 'ReferenceError', 'InvalidAccessError'])

function readString(value: unknown, key: string): string {
  if (typeof value === 'object' && value !== null && key in value) {
    const found = (value as Record<string, unknown>)[key]
    if (typeof found === 'string') return found
  }
  return ''
}

function readNumber(value: unknown, key: string): number | null {
  if (typeof value === 'object' && value !== null && key in value) {
    const found = (value as Record<string, unknown>)[key]
    if (typeof found === 'number') return found
  }
  return null
}

/**
 * Sorts a thrown storage error into the three cases the UI can act on.
 *
 * Deliberately structural rather than `instanceof DOMException`: Safari in
 * private mode throws a plain Error, older Firefox throws with the legacy
 * NS_ERROR name, and a disabled-storage browser can throw before any DOM
 * exception type is involved at all.
 */
export function classifyStorageError(caught: unknown): StorageFailureReason {
  const name = readString(caught, 'name') || (caught instanceof Error ? caught.name : '')
  const code = readNumber(caught, 'code')
  const message = (
    readString(caught, 'message') || (caught instanceof Error ? caught.message : String(caught ?? ''))
  ).toLowerCase()

  if (QUOTA_NAMES.has(name)) return 'quota'
  if (code !== null && QUOTA_CODES.has(code)) return 'quota'
  // Safari private mode: "QuotaExceededError: The quota has been exceeded."
  if (message.includes('quota') || message.includes('exceeded the storage')) return 'quota'

  if (UNAVAILABLE_NAMES.has(name)) return 'unavailable'
  if (
    message.includes('access is denied') ||
    message.includes('localstorage is not defined') ||
    message.includes('storage is disabled') ||
    message.includes('not available in this context')
  ) {
    return 'unavailable'
  }

  return 'unknown'
}

/** Copy the user actually sees. Says what happened and what to do about it. */
export function describeStorageFailure(reason: StorageFailureReason): string {
  switch (reason) {
    case 'quota':
      return "This browser's storage is full, so your note wasn't saved. Download a backup, then free up space or create an account to keep writing."
    case 'unavailable':
      return "This browser is blocking local storage, so your note wasn't saved. Leave private browsing or allow site data, then retry."
    default:
      return "Your note couldn't be saved to this browser. Download a backup so you don't lose it, then retry."
  }
}

function toStorageError(caught: unknown): GuestStorageError {
  if (caught instanceof GuestStorageError) return caught
  const reason = classifyStorageError(caught)
  return new GuestStorageError(reason, describeStorageFailure(reason), { cause: caught })
}

/** False in SSR, in a sandboxed frame, and wherever site data is switched off. */
export function guestStorageAvailable(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false
    const probe = '__margin_probe__'
    localStorage.setItem(probe, '1')
    localStorage.removeItem(probe)
    return true
  } catch {
    return false
  }
}

function read<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    // Corrupted or unparsable storage must not take down the whole app.
    // Treat it as empty; the user loses local notes but can still work.
    console.error(`[guestStore] unreadable localStorage key: ${key}`)
    return []
  }
}

/** Raw value, or null when it is absent or storage cannot be read at all. */
function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/**
 * Applies a set of key writes, restoring every previous value if any one fails.
 *
 * Cascade deletes touch two keys. Writing them one at a time meant a failure
 * between the two left the store inconsistent -- a class gone but its notes
 * still present, or the reverse. There is no transaction in the Web Storage
 * API, so the next best thing is to put back what was there.
 */
function writeAll(entries: Array<{ key: string; rows: unknown[] }>): void {
  const previous = entries.map(({ key }) => [key, readRaw(key)] as const)

  try {
    for (const { key, rows } of entries) {
      localStorage.setItem(key, JSON.stringify(rows))
    }
  } catch (caught) {
    for (const [key, raw] of previous) {
      try {
        if (raw === null) localStorage.removeItem(key)
        else localStorage.setItem(key, raw)
      } catch {
        // Nothing more can be done: storage is refusing writes entirely. The
        // thrown error below is what stops the caller reporting success.
      }
    }
    throw toStorageError(caught)
  }
}

/** Throws GuestStorageError when the value did not reach storage. */
function write<T>(key: string, rows: T[]): void {
  writeAll([{ key, rows }])
}

function newId(): string {
  return crypto.randomUUID()
}

function now(): string {
  return new Date().toISOString()
}

const byNewestEdit = <T extends { updated_at: string }>(a: T, b: T) =>
  b.updated_at.localeCompare(a.updated_at)

// ---------------------------------------------------------------------------
// classes
// ---------------------------------------------------------------------------

export function guestFetchClasses(): ClassWithCount[] {
  const classes = read<ClassRow>(CLASSES_KEY)
  const documents = read<DocumentRow>(DOCUMENTS_KEY)

  return [...classes].sort(byNewestEdit).map((row) => ({
    ...row,
    note_count: documents.filter((doc) => doc.class_id === row.id).length,
  }))
}

export function guestFetchClass(classId: string): ClassRow | null {
  return read<ClassRow>(CLASSES_KEY).find((row) => row.id === classId) ?? null
}

export function guestClassSlugs(): string[] {
  return read<ClassRow>(CLASSES_KEY).map((row) => row.slug)
}

export function guestFetchClassBySlug(slug: string): ClassRow | null {
  return read<ClassRow>(CLASSES_KEY).find((row) => row.slug === slug) ?? null
}

/**
 * Throws GuestStorageError when the write does not reach storage.
 *
 * Callers reach this through classes.ts, whose signature is already a promise,
 * so the rejection surfaces at the same `catch` that already handles Supabase
 * failures. That is deliberate: a create that did not persist has to look like
 * a create that failed, not like one that worked.
 */
export function guestCreateClass(input: ClassInput): ClassRow {
  const timestamp = now()
  const row: ClassRow = {
    ...input,
    slug: uniqueSlug(input.name, guestClassSlugs()),
    id: newId(),
    user_id: GUEST_USER_ID,
    created_at: timestamp,
    updated_at: timestamp,
  }

  write(CLASSES_KEY, [...read<ClassRow>(CLASSES_KEY), row])
  return row
}

export function guestUpdateClass(classId: string, patch: Partial<ClassInput>): ClassRow | null {
  const classes = read<ClassRow>(CLASSES_KEY)
  const index = classes.findIndex((row) => row.id === classId)
  if (index === -1) return null

  const updated: ClassRow = {
    ...classes[index],
    ...patch,
    // Renaming re-slugs, matching the signed-in path.
    ...(patch.name
      ? {
          slug: uniqueSlug(
            patch.name,
            classes.map((row) => row.slug),
            classes[index].slug,
          ),
        }
      : {}),
    updated_at: now(),
  }
  // Built as a new array rather than assigned into `classes`, so a failed
  // write leaves no half-updated view behind for this call to return.
  const next = classes.map((row, at) => (at === index ? updated : row))
  write(CLASSES_KEY, next)
  return updated
}

export function guestDeleteClass(classId: string): void {
  // One atomic-ish unit: the class and the notes it cascades to. Mirrors
  // `on delete cascade` on documents.class_id, and rolls both back together
  // if storage refuses either write.
  writeAll([
    {
      key: CLASSES_KEY,
      rows: read<ClassRow>(CLASSES_KEY).filter((row) => row.id !== classId),
    },
    {
      key: DOCUMENTS_KEY,
      rows: read<DocumentRow>(DOCUMENTS_KEY).filter((row) => row.class_id !== classId),
    },
  ])
}

// ---------------------------------------------------------------------------
// documents
// ---------------------------------------------------------------------------

export function guestFetchDocuments(classId: string): DocumentListItem[] {
  return read<DocumentRow>(DOCUMENTS_KEY)
    .filter((row) => row.class_id === classId)
    .sort(byNewestEdit)
    .map(({ id, class_id, title, slug, created_at, updated_at }) => ({
      id,
      class_id,
      title,
      slug,
      created_at,
      updated_at,
    }))
}

export function guestFetchDocument(documentId: string): DocumentRow | null {
  return read<DocumentRow>(DOCUMENTS_KEY).find((row) => row.id === documentId) ?? null
}

export function guestDocumentSlugs(classId: string): string[] {
  return read<DocumentRow>(DOCUMENTS_KEY)
    .filter((row) => row.class_id === classId)
    .map((row) => row.slug)
}

export function guestFetchDocumentBySlug(
  classId: string,
  slug: string,
): DocumentRow | null {
  return (
    read<DocumentRow>(DOCUMENTS_KEY).find(
      (row) => row.class_id === classId && row.slug === slug,
    ) ?? null
  )
}

export function guestCreateDocument(classId: string, title = ''): DocumentRow {
  const timestamp = now()
  const row: DocumentRow = {
    id: newId(),
    class_id: classId,
    user_id: GUEST_USER_ID,
    title,
    slug: uniqueSlug(title || 'untitled', guestDocumentSlugs(classId)),
    content: { type: 'doc', content: [] },
    content_text: '',
    header: { type: 'doc', content: [] },
    footer: { type: 'doc', content: [] },
    page_numbers: 'off',
    page_setup: null,
    starred: false,
    version: 1,
    created_at: timestamp,
    updated_at: timestamp,
  }

  write(DOCUMENTS_KEY, [...read<DocumentRow>(DOCUMENTS_KEY), row])
  return row
}

/**
 * Saves a note, or says why it could not.
 *
 * Three outcomes, and the third is the reason this function exists: 'saved'
 * when the row was written, 'stale' when a newer version already exists, and
 * 'failed' when storage refused the write. It used to return 'saved' in the
 * third case too, because write() swallowed the error -- so the editor showed
 * "Saved" over a note that had never left memory.
 */
export function guestSaveDocument(params: {
  documentId: string
  title: string
  content: JSONContent
  expectedVersion: number
  header?: JSONContent
  footer?: JSONContent
  pageNumbers?: string
  starred?: boolean
  pageSetup?: unknown
  /** See documents.saveDocument: off on the autosave path, by design. */
  reslug?: boolean
}): SaveResult {
  const {
    documentId,
    title,
    content,
    expectedVersion,
    header,
    footer,
    pageNumbers,
    starred,
    pageSetup,
    reslug,
  } = params
  const documents = read<DocumentRow>(DOCUMENTS_KEY)
  const index = documents.findIndex((row) => row.id === documentId)

  if (index === -1) return { status: 'stale' }

  const current = documents[index]

  // Same optimistic-concurrency contract as the Postgres path: a save built on
  // a version that is no longer current is refused, not applied. Two tabs in
  // guest mode share one localStorage, so this is a real scenario.
  if (current.version !== expectedVersion) return { status: 'stale' }

  const version = expectedVersion + 1
  const classId = current.class_id
  const updated: DocumentRow = {
    ...current,
    title,
    // Mirrors the Supabase path: the slug only moves when asked. The note's
    // address is its id, so a slug lagging behind the title costs nothing.
    ...(reslug
      ? {
          slug: uniqueSlug(
            title || 'untitled',
            documents
              .filter((row) => row.class_id === classId && row.id !== documentId)
              .map((row) => row.slug),
            current.slug,
          ),
        }
      : {}),
    content,
    content_text: extractPlainText(content),
    ...(header ? { header } : {}),
    ...(footer ? { footer } : {}),
    ...(pageNumbers ? { page_numbers: pageNumbers } : {}),
    ...(pageSetup === undefined ? {} : { page_setup: pageSetup }),
    ...(starred === undefined ? {} : { starred }),
    version,
    updated_at: now(),
  }

  // A new array, never an assignment into `documents`. If the write throws,
  // nothing anywhere has been advanced to a state that implies it landed.
  const next = documents.map((row, at) => (at === index ? updated : row))

  try {
    write(DOCUMENTS_KEY, next)
  } catch (caught) {
    if (!(caught instanceof GuestStorageError)) throw caught
    console.error('[guestStore] save did not reach storage:', caught)
    return {
      status: 'failed',
      reason: caught.reason,
      message: caught.message,
      // Unchanged: the write never happened, so the note is still at the
      // version the caller came in with. Reported so a caller that tracks
      // versions stays consistent instead of drifting a step ahead of storage.
      version: expectedVersion,
    }
  }

  return { status: 'saved', version }
}

/** Throws GuestStorageError when the deletion does not reach storage. */
export function guestDeleteDocument(documentId: string): void {
  write(
    DOCUMENTS_KEY,
    read<DocumentRow>(DOCUMENTS_KEY).filter((row) => row.id !== documentId),
  )
}

// ---------------------------------------------------------------------------
// migration support
// ---------------------------------------------------------------------------

export interface GuestSnapshot {
  classes: ClassRow[]
  documents: DocumentRow[]
}

export function guestHasData(): boolean {
  return read<ClassRow>(CLASSES_KEY).length > 0
}

export function guestSnapshot(): GuestSnapshot {
  return {
    classes: read<ClassRow>(CLASSES_KEY),
    documents: read<DocumentRow>(DOCUMENTS_KEY),
  }
}

export function guestClear(): void {
  // Best effort by design. Everything is already in the account by the time
  // this runs, so a browser that refuses removeItem must not turn a completed
  // migration into a reported failure. The ledger goes with it, and it is the
  // ledger that stops the leftover local copy being migrated twice.
  for (const key of [CLASSES_KEY, DOCUMENTS_KEY, MIGRATION_KEY]) {
    try {
      localStorage.removeItem(key)
    } catch (caught) {
      console.error(`[guestStore] failed to clear ${key}:`, caught)
    }
  }
}

// ---------------------------------------------------------------------------
// migration ledger
//
// Migration is a sequence of remote writes with no transaction around it. A
// failure halfway used to leave the local copy intact (correct) but with no
// record of what had already been written, so the retry created everything a
// second time. The ledger is that record: local id -> remote id, written after
// each successful remote write.
// ---------------------------------------------------------------------------

export interface MigrationLedger {
  /** Scopes the ledger to one account: signing into a different one starts over. */
  userId: string
  /** local class id -> remote class id */
  classes: Record<string, string>
  /** local document id -> remote document id */
  documents: Record<string, string>
}

function emptyLedger(userId: string): MigrationLedger {
  return { userId, classes: {}, documents: {} }
}

export function readMigrationLedger(userId: string): MigrationLedger {
  try {
    const raw = localStorage.getItem(MIGRATION_KEY)
    if (!raw) return emptyLedger(userId)
    const parsed = JSON.parse(raw) as Partial<MigrationLedger> | null
    // A ledger from another account says nothing about this one's rows.
    if (!parsed || parsed.userId !== userId) return emptyLedger(userId)
    return {
      userId,
      classes: parsed.classes ?? {},
      documents: parsed.documents ?? {},
    }
  } catch {
    console.error('[guestStore] unreadable migration ledger; starting a fresh one')
    return emptyLedger(userId)
  }
}

/**
 * Best effort, and deliberately so.
 *
 * Migration writes go to the server; only this bookkeeping is local. If a full
 * or disabled localStorage refuses it, the migration itself is still perfectly
 * valid -- the only thing lost is resume-without-duplicates on a later retry,
 * which is exactly the behaviour that existed before the ledger. Throwing here
 * would turn a successful migration into a failed one.
 */
export function writeMigrationLedger(ledger: MigrationLedger): void {
  try {
    localStorage.setItem(MIGRATION_KEY, JSON.stringify(ledger))
  } catch (caught) {
    console.error('[guestStore] could not persist the migration ledger:', caught)
  }
}

// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------

/** Bumped if the shape ever changes, so an old file can still be recognised. */
export const GUEST_EXPORT_VERSION = 1

export interface GuestExport extends GuestSnapshot {
  format: 'margin.guest-export'
  version: number
  exported_at: string
}

/**
 * Everything the guest store holds, as a JSON string.
 *
 * The escape hatch for a browser that will not persist: when saving fails, the
 * notes still exist in memory and in whatever was last written, and this is how
 * the user gets them out rather than being told to copy and paste.
 */
export function guestExportJson(): string {
  const payload: GuestExport = {
    format: 'margin.guest-export',
    version: GUEST_EXPORT_VERSION,
    exported_at: now(),
    ...guestSnapshot(),
  }
  return JSON.stringify(payload, null, 2)
}

/** Suggested filename; dated so repeated exports do not overwrite each other. */
export function guestExportFilename(): string {
  return `margin-notes-${now().slice(0, 10)}.json`
}

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

/**
 * Searches guest notes, matching what `searchNotes` does against Postgres.
 *
 * Guest notes live in one browser, so this is an array scan rather than a
 * query -- and at the size localStorage can hold, that is the whole design.
 * It is here rather than in `search.ts` so the storage keys and row shapes
 * stay in the one module that knows them.
 */
export function guestSearchNotes(query: string): SearchHit[] {
  const needle = query.toLowerCase()
  const classes = read<ClassRow>(CLASSES_KEY)
  const documents = read<DocumentRow>(DOCUMENTS_KEY)

  const hits = [...documents]
    .sort(byNewestEdit)
    .filter(
      (doc) =>
        doc.title.toLowerCase().includes(needle) ||
        (doc.content_text ?? '').toLowerCase().includes(needle),
    )
    .slice(0, SEARCH_LIMIT)
    .map((doc) => {
      const klass = classes.find((row) => row.id === doc.class_id)
      return {
        documentId: doc.id,
        title: doc.title,
        classId: doc.class_id,
        className: klass?.name ?? 'Unfiled',
        classSlug: klass?.slug ?? '',
        slug: doc.slug,
        snippet: buildSnippet(doc.content_text ?? '', query),
        inTitle: doc.title.toLowerCase().includes(needle),
      }
    })

  return rankHits(hits)
}
