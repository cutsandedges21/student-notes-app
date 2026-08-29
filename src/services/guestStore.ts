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

/** Stand-in for auth.uid() so row shapes match the Postgres tables. */
export const GUEST_USER_ID = 'guest'

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

function write<T>(key: string, rows: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(rows))
  } catch (caught) {
    // Quota exceeded, or storage disabled (private mode in some browsers).
    console.error(`[guestStore] failed to persist ${key}:`, caught)
  }
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
  classes[index] = updated
  write(CLASSES_KEY, classes)
  return updated
}

export function guestDeleteClass(classId: string): void {
  write(
    CLASSES_KEY,
    read<ClassRow>(CLASSES_KEY).filter((row) => row.id !== classId),
  )
  // Mirrors `on delete cascade` on documents.class_id.
  write(
    DOCUMENTS_KEY,
    read<DocumentRow>(DOCUMENTS_KEY).filter((row) => row.class_id !== classId),
  )
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
    version: 1,
    created_at: timestamp,
    updated_at: timestamp,
  }

  write(DOCUMENTS_KEY, [...read<DocumentRow>(DOCUMENTS_KEY), row])
  return row
}

export function guestSaveDocument(params: {
  documentId: string
  title: string
  content: JSONContent
  expectedVersion: number
}): SaveResult {
  const { documentId, title, content, expectedVersion } = params
  const documents = read<DocumentRow>(DOCUMENTS_KEY)
  const index = documents.findIndex((row) => row.id === documentId)

  if (index === -1) return { status: 'stale' }

  // Same optimistic-concurrency contract as the Postgres path: a save built on
  // a version that is no longer current is refused, not applied. Two tabs in
  // guest mode share one localStorage, so this is a real scenario.
  if (documents[index].version !== expectedVersion) return { status: 'stale' }

  const version = expectedVersion + 1
  const classId = documents[index].class_id
  documents[index] = {
    ...documents[index],
    title,
    slug: uniqueSlug(
      title || 'untitled',
      documents.filter((row) => row.class_id === classId).map((row) => row.slug),
      documents[index].slug,
    ),
    content,
    content_text: extractPlainText(content),
    version,
    updated_at: now(),
  }

  write(DOCUMENTS_KEY, documents)
  return { status: 'saved', version }
}

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
  localStorage.removeItem(CLASSES_KEY)
  localStorage.removeItem(DOCUMENTS_KEY)
}
