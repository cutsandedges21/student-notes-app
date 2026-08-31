import type { JSONContent } from '@tiptap/react'
import { createClass as createClassRemote } from './classes'
import { createDocument as createDocumentRemote, saveDocument } from './documents'
import {
  guestClear,
  guestHasData,
  guestSnapshot,
  readMigrationLedger,
  writeMigrationLedger,
} from './guestStore'
import type { ClassInput } from './classes'
import type { ClassRow, DocumentRow } from '../types/database'

export type MigrationResult =
  | { migrated: false; classes: 0; documents: 0; error?: unknown }
  | { migrated: true; classes: number; documents: number }

// ---------------------------------------------------------------------------
// field plans
//
// The migration used to carry a hand-written subset of columns, and the subset
// silently fell behind the row: header, footer and page_numbers all shipped
// after it was written and were all dropped on the way into an account, along
// with everything the note's furniture describes.
//
// These two Records replace the subset with an exhaustive decision. Every
// field of the row has to appear, with one of three verdicts:
//
//   migrate  copied across verbatim
//   derive   recomputed at the destination (a new id, a re-slug, a fresh
//            content_text) -- present in the copy, just not carried
//   drop     deliberately not carried, with the reason written down
//
// Because they are `Record<keyof Row, FieldPlan>`, adding a column to
// ClassRow or DocumentRow fails the build here until someone decides which of
// the three it is. That is the point: the previous list could not tell the
// difference between "considered and dropped" and "forgotten".
// ---------------------------------------------------------------------------

export type FieldPlan = 'migrate' | 'derive' | 'drop'

export const CLASS_FIELD_PLAN: Record<keyof ClassRow, FieldPlan> = {
  // Postgres mints its own uuid; the local id survives only in the ledger.
  id: 'drop',
  // Local rows are owned by GUEST_USER_ID; the destination row is owned by the account.
  user_id: 'drop',
  name: 'migrate',
  // Re-slugged by createClass so it is unique within the destination account.
  slug: 'derive',
  course_code: 'migrate',
  professor: 'migrate',
  semester: 'migrate',
  course_level: 'migrate',
  // Column default now(); there is no client-writable path for either, and the
  // migration date is the truthful "created in this account" answer anyway.
  created_at: 'drop',
  updated_at: 'drop',
}

export const DOCUMENT_FIELD_PLAN: Record<keyof DocumentRow, FieldPlan> = {
  id: 'drop', // as above: a new uuid at the destination
  class_id: 'derive', // remapped to the newly created remote class id
  user_id: 'drop', // re-owned by the account
  title: 'migrate',
  slug: 'derive', // re-slugged for uniqueness within the destination class
  content: 'migrate',
  content_text: 'derive', // recomputed by saveDocument via extractPlainText
  header: 'migrate',
  footer: 'migrate',
  page_numbers: 'migrate',
  starred: 'migrate',
  version: 'derive', // the copy starts its own optimistic-concurrency counter
  created_at: 'drop',
  updated_at: 'drop',
  /*
   * Sharing does not survive the move into an account, deliberately.
   *
   * A guest note has never been shared -- it lived in one browser and there
   * was no server to share it from -- so there is nothing to carry. Even if
   * there were, silently arriving with a live share link would be the wrong
   * default: the account's owner should decide what is public, not inherit it.
   * The destination row gets the column defaults, which are 'private' and a
   * fresh token.
   */
  share_mode: 'drop',
  share_token: 'drop',
  /*
   * No CRDT state to carry either, for the same reason: collaboration requires
   * a backend the guest path does not have. The destination note is seeded
   * from `content` on its first collaborative open, which is the same path
   * every pre-existing note takes.
   */
  ydoc: 'drop',
}

/** Everything a destination document needs; one field per 'migrate' above. */
export interface MigrationDocument {
  title: string
  content: JSONContent
  header: JSONContent
  footer: JSONContent
  pageNumbers: string
  starred: boolean
}

/** Everything a destination class needs; one field per 'migrate' above. */
export type MigrationClass = ClassInput

const EMPTY_DOC: JSONContent = { type: 'doc', content: [] }

/** Reads a Tiptap column that older local rows may not have. */
function asDoc(value: unknown): JSONContent {
  return value && typeof value === 'object' ? (value as JSONContent) : EMPTY_DOC
}

export function toMigrationClass(local: ClassRow): MigrationClass {
  return {
    name: local.name,
    course_code: local.course_code,
    professor: local.professor,
    semester: local.semester,
    course_level: local.course_level,
  }
}

export function toMigrationDocument(local: DocumentRow): MigrationDocument {
  return {
    title: local.title,
    content: asDoc(local.content),
    header: asDoc(local.header),
    footer: asDoc(local.footer),
    // Rows written before these columns existed read as the column defaults
    // rather than as undefined, which would blank them at the destination.
    pageNumbers: local.page_numbers ?? 'off',
    starred: local.starred ?? false,
  }
}

/**
 * Injectable writers so the migration can be tested without a live database.
 * Defaults hit Supabase through the normal service layer.
 */
export interface MigrationWriters {
  createClass: (...args: Parameters<typeof createClassRemote>) => Promise<ClassRow>
  createDocument: (classId: string, input: MigrationDocument) => Promise<{ id: string }>
}

/**
 * Moves work created while signed out into a real account.
 *
 * Ordering matters: each class is created first so its new remote id can parent
 * the notes that belonged to the local class. Local ids are never reused —
 * Postgres generates its own.
 *
 * Local data is cleared ONLY after every write succeeds. If anything fails
 * midway the local copy stays put, because at that moment it may be the user's
 * only copy of their notes.
 *
 * A retry after such a failure resumes rather than starting over: every
 * successful remote write is recorded in a local ledger keyed on the local id,
 * so rows that already made it across are skipped. Before the ledger, the
 * second attempt duplicated everything the first attempt had managed to write.
 */
export async function migrateGuestData(
  userId: string,
  writers?: Partial<MigrationWriters>,
): Promise<MigrationResult> {
  if (!guestHasData()) return { migrated: false, classes: 0, documents: 0 }

  const createClass: MigrationWriters['createClass'] =
    writers?.createClass ?? ((uid, input) => createClassRemote(uid, input))

  const createDocument: MigrationWriters['createDocument'] =
    writers?.createDocument ??
    (async (classId, input) => {
      const created = await createDocumentRemote(userId, classId, input.title)
      // createDocument only seeds a title; push the body through the normal
      // save path so content_text is derived exactly as it is everywhere else.
      const result = await saveDocument(userId, {
        documentId: created.id,
        title: input.title,
        content: input.content,
        expectedVersion: created.version,
        header: input.header,
        footer: input.footer,
        pageNumbers: input.pageNumbers,
        starred: input.starred,
      })
      // A note whose body never landed is a half-migrated note. Failing here
      // keeps the local copy, which is the whole safety contract.
      if (result.status !== 'saved') {
        throw new Error(
          `[migrateGuestData] note "${input.title}" was created but its content did not save (${result.status})`,
        )
      }
      return created
    })

  const { classes, documents } = guestSnapshot()
  const ledger = readMigrationLedger(userId)

  try {
    let documentCount = 0

    for (const localClass of classes) {
      let remoteClassId = ledger.classes[localClass.id]

      if (!remoteClassId) {
        const remote = await createClass(userId, toMigrationClass(localClass))
        remoteClassId = remote.id
        ledger.classes[localClass.id] = remoteClassId
        writeMigrationLedger(ledger)
      }

      const notes = documents.filter((doc) => doc.class_id === localClass.id)
      for (const note of notes) {
        if (ledger.documents[note.id]) {
          // Already across from an earlier attempt. Counted, not rewritten.
          documentCount += 1
          continue
        }

        const created = await createDocument(remoteClassId, toMigrationDocument(note))
        ledger.documents[note.id] = created.id
        writeMigrationLedger(ledger)
        documentCount += 1
      }
    }

    // Takes the ledger with it: the local rows it referred to are gone.
    guestClear()
    return { migrated: true, classes: classes.length, documents: documentCount }
  } catch (error) {
    console.error('[migrateGuestData] migration failed; keeping local copy:', error)
    return { migrated: false, classes: 0, documents: 0, error }
  }
}
