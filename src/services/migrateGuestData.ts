import type { JSONContent } from '@tiptap/react'
import { createClass as createClassRemote } from './classes'
import { createDocument as createDocumentRemote, saveDocument } from './documents'
import { guestClear, guestHasData, guestSnapshot } from './guestStore'
import type { ClassRow } from '../types/database'

export type MigrationResult =
  | { migrated: false; classes: 0; documents: 0; error?: unknown }
  | { migrated: true; classes: number; documents: number }

/**
 * Injectable writers so the migration can be tested without a live database.
 * Defaults hit Supabase through the normal service layer.
 */
export interface MigrationWriters {
  createClass: (...args: Parameters<typeof createClassRemote>) => Promise<ClassRow>
  createDocument: (classId: string, title: string, content: JSONContent) => Promise<{ id: string }>
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
 * only copy of their notes. The cost is possible duplicates on a retry, which
 * is strictly better than silent data loss.
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
    (async (classId, title, content) => {
      const created = await createDocumentRemote(userId, classId, title)
      // createDocument only seeds a title; push the body through the normal
      // save path so content_text is derived exactly as it is everywhere else.
      await saveDocument(userId, {
        documentId: created.id,
        title,
        content,
        expectedVersion: created.version,
      })
      return created
    })

  const { classes, documents } = guestSnapshot()

  try {
    let documentCount = 0

    for (const localClass of classes) {
      const remote = await createClass(userId, {
        name: localClass.name,
        course_code: localClass.course_code,
        professor: localClass.professor,
        semester: localClass.semester,
        course_level: localClass.course_level,
      })

      const notes = documents.filter((doc) => doc.class_id === localClass.id)
      for (const note of notes) {
        await createDocument(remote.id, note.title, note.content as JSONContent)
        documentCount += 1
      }
    }

    guestClear()
    return { migrated: true, classes: classes.length, documents: documentCount }
  } catch (error) {
    console.error('[migrateGuestData] migration failed; keeping local copy:', error)
    return { migrated: false, classes: 0, documents: 0, error }
  }
}
