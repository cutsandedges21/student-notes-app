import type { JSONContent } from '@tiptap/react'
import { createDocument, fetchDocument, saveDocument } from './documents'
import type { DocumentRow } from '../types/database'

/**
 * Managing a note rather than writing in it: copying it, and filing it
 * somewhere else.
 *
 * Both go through the ordinary create-and-save path rather than inserting
 * rows directly. `createDocument` owns slug generation and uniqueness within a
 * class, and `saveDocument` owns the denormalised `content_text` the search
 * and the assistant both read. A copy made by inserting a row would be a note
 * with a slug nobody checked and a text column nobody filled -- findable by
 * neither.
 *
 * `sharing.copySharedDocument` does the same thing for a note somebody else
 * owns. This is the version for your own, where there is no class to invent
 * and no permission to check beyond the row already being yours.
 */

/** Everything that makes a note itself, rather than a row in a table. */
const CARRIED = [
  'content',
  'header',
  'footer',
  'page_numbers',
  'page_setup',
  'starred',
] as const

/**
 * Makes a copy of a note, in the same class.
 *
 * Deliberately not a deep copy of the row. Version history, comments,
 * conversations and share tokens all hang off the note's id, and carrying any
 * of them would mean a copy that shares a conversation with its original or
 * arrives with a live share link the student never created. A copy is the
 * writing, the page furniture and the settings -- nothing that was about the
 * old note's life.
 */
export async function duplicateDocument(
  userId: string | null,
  documentId: string,
): Promise<DocumentRow> {
  const source = await fetchDocument(userId, documentId)
  if (!source) throw new Error('That note no longer exists.')

  const title = source.title ? `Copy of ${source.title}` : 'Untitled copy'
  const created = await createDocument(userId, source.class_id, title)

  const result = await saveDocument(userId, {
    documentId: created.id,
    title,
    content: (source.content as JSONContent) ?? { type: 'doc', content: [] },
    expectedVersion: created.version,
    header: (source.header as JSONContent) ?? undefined,
    footer: (source.footer as JSONContent) ?? undefined,
    pageNumbers: source.page_numbers,
    // Sent because the copy is being made now, so the column either exists or
    // this whole call fails -- unlike an autosave, which must keep working
    // against a database that has not run the migration.
    pageSetup: source.page_setup,
  })

  if (result.status !== 'saved') {
    /*
     * The row exists and its body did not land. Thrown rather than returned,
     * because the caller is about to navigate to a note that would be empty --
     * and an empty copy the student then has to notice is worse than a
     * failure they can retry.
     */
    throw new Error('The copy was created but its contents did not save.')
  }

  return { ...created, ...pick(source), title }
}

/** The carried fields, so the returned row matches what was written. */
function pick(source: DocumentRow): Partial<DocumentRow> {
  const carried: Record<string, unknown> = {}
  for (const field of CARRIED) carried[field] = source[field as keyof DocumentRow]
  return carried as Partial<DocumentRow>
}

/**
 * Files a note under a different class.
 *
 * The note keeps its id, so every link to it still works, every comment stays
 * attached and its history follows it. Only where it is filed changes -- which
 * is what "move" means and is the reason this is not a copy-and-delete.
 *
 * The slug is re-derived because uniqueness is per class: two notes called
 * "Lecture 1" in different classes are ordinary, and the same slug arriving in
 * a class that already has one would collide.
 */
export async function moveDocument(
  userId: string | null,
  documentId: string,
  destinationClassId: string,
): Promise<void> {
  const source = await fetchDocument(userId, documentId)
  if (!source) throw new Error('That note no longer exists.')

  if (source.class_id === destinationClassId) return

  const result = await saveDocument(userId, {
    documentId,
    title: source.title,
    content: (source.content as JSONContent) ?? { type: 'doc', content: [] },
    expectedVersion: source.version,
    classId: destinationClassId,
    // The one caller that genuinely wants a new slug: it is moving into a
    // class whose existing slugs it has never been checked against.
    reslug: true,
  })

  if (result.status === 'stale') {
    throw new Error('Somebody else changed this note. Reopen it and try again.')
  }
  if (result.status !== 'saved') {
    throw new Error('That note could not be moved.')
  }
}
