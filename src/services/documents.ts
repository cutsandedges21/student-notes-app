import { supabase } from '../lib/supabase'
import { extractPlainText } from '../lib/tiptap'
import { uniqueSlug } from '../lib/slug'
import type { JSONContent } from '@tiptap/react'
import type { DocumentListItem, DocumentRow } from '../types/database'
import {
  guestCreateDocument,
  guestDeleteDocument,
  guestFetchDocument,
  guestFetchDocumentBySlug,
  guestFetchDocuments,
  guestSaveDocument,
  type StorageFailureReason,
} from './guestStore'

const EMPTY_DOC: JSONContent = { type: 'doc', content: [] }

/** Why a save never reached storage. Mirrors guestStore's StorageFailureReason. */
export type SaveFailureReason = StorageFailureReason

/**
 * The outcome of a save.
 *
 * 'saved' and 'stale' are unchanged -- the editor's concurrency handling is
 * built on them. 'failed' is new, and covers the case the guest path could not
 * previously express: the write was refused by the browser, so nothing was
 * persisted. Only the guest path returns it; Supabase failures throw.
 */
export type SaveResult =
  | { status: 'saved'; version: number }
  | { status: 'stale' }
  | {
      status: 'failed'
      reason: SaveFailureReason
      message: string
      /**
       * The version the note is STILL at, because nothing was written.
       *
       * Carried so a caller that tracks versions cannot drift a step ahead of
       * what is actually stored. It is not a success signal: `status` is the
       * only thing that says whether the save happened, and any caller that
       * shows a "Saved" indicator must branch on it first.
       */
      version: number
    }

/**
 * Translates the row returned by a conditional update into a save outcome.
 *
 * The update is gated on the version the client last read. If another tab
 * saved first, the version no longer matches, zero rows are affected, and
 * PostgREST returns null — meaning this save is stale and must be discarded
 * rather than retried blindly, which would clobber the newer content.
 */
export function interpretSaveResult(
  row: { id: string; version: number } | null,
): SaveResult {
  if (!row) return { status: 'stale' }
  return { status: 'saved', version: row.version }
}

/** See the note in classes.ts on why `userId` is threaded through explicitly. */

export async function fetchDocuments(
  userId: string | null,
  classId: string,
): Promise<DocumentListItem[]> {
  if (!userId) return guestFetchDocuments(classId)

  const { data, error } = await supabase
    .from('documents')
    .select('id, class_id, title, slug, created_at, updated_at')
    .eq('class_id', classId)
    .order('updated_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as DocumentListItem[]
}

export async function fetchDocument(
  userId: string | null,
  documentId: string,
): Promise<DocumentRow | null> {
  if (!userId) return guestFetchDocument(documentId)

  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('id', documentId)
    .maybeSingle()

  if (error) throw error
  return data as DocumentRow | null
}

/** Slugs already used inside this class. */
async function takenDocumentSlugs(classId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('documents')
    .select('slug')
    .eq('class_id', classId)

  if (error) throw error
  return (data ?? []).map((row) => row.slug as string)
}

export async function fetchDocumentBySlug(
  userId: string | null,
  classId: string,
  slug: string,
): Promise<DocumentRow | null> {
  if (!userId) return guestFetchDocumentBySlug(classId, slug)

  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('class_id', classId)
    .eq('slug', slug)
    .maybeSingle()

  if (error) throw error
  return data as DocumentRow | null
}

export async function createDocument(
  userId: string | null,
  classId: string,
  title = '',
): Promise<DocumentRow> {
  if (!userId) return guestCreateDocument(classId, title)

  const slug = uniqueSlug(title || 'untitled', await takenDocumentSlugs(classId))

  const { data, error } = await supabase
    .from('documents')
    .insert({
      user_id: userId,
      class_id: classId,
      title,
      slug,
      content: EMPTY_DOC,
      content_text: '',
      header: EMPTY_DOC,
      footer: EMPTY_DOC,
      page_numbers: 'off',
    })
    .select()
    .single()

  if (error) throw error
  return data as DocumentRow
}

/**
 * Conditionally saves a document.
 *
 * `expectedVersion` is the version the caller last read. The update only
 * applies if the stored version still matches, which makes concurrent saves
 * from two tabs safe: the loser gets `{ status: 'stale' }` and re-reads.
 */
export async function saveDocument(
  userId: string | null,
  params: {
    documentId: string
    title: string
    content: JSONContent
    expectedVersion: number
    /**
     * Where to re-slug within. Only consulted when `reslug` is set: the slug
     * has to be unique inside the class, so regenerating one needs to know
     * which class to check against.
     */
    classId?: string
    /**
     * Regenerate the slug from the title.
     *
     * Off by default, and deliberately not something autosave asks for. Every
     * save used to re-slug, which meant every keystroke in the title cost two
     * extra round trips (read the row, list the class's slugs) and, worse,
     * changed the note's address mid-sentence. The address is now anchored on
     * the immutable id, so the slug is free to lag behind the title until
     * something explicitly asks for it to catch up.
     */
    reslug?: boolean
    header?: JSONContent
    footer?: JSONContent
    pageNumbers?: string
    /**
     * Only sent when supplied. `documents.starred` arrived after this app
     * shipped, so a project that has not yet run supabase/schema.sql would
     * reject the column; omitting it keeps every save that does not care about
     * starring working against both schemas.
     */
    starred?: boolean
  },
): Promise<SaveResult> {
  if (!userId) return guestSaveDocument(params)

  const {
    documentId,
    title,
    content,
    expectedVersion,
    classId,
    header,
    footer,
    pageNumbers,
    starred,
    reslug,
  } = params

  // Two extra round trips, so only taken when a caller has actually asked to
  // move the note's readable name along -- never on the autosave path.
  let slugPatch: Record<string, string> = {}
  if (reslug && classId) {
    const current = await fetchDocument(userId, documentId)
    const nextSlug = uniqueSlug(
      title || 'untitled',
      await takenDocumentSlugs(classId),
      current?.slug,
    )
    if (nextSlug !== current?.slug) slugPatch = { slug: nextSlug }
  }

  const { data, error } = await supabase
    .from('documents')
    .update({
      title,
      ...slugPatch,
      content,
      content_text: extractPlainText(content),
      ...(header ? { header } : {}),
      ...(footer ? { footer } : {}),
      ...(pageNumbers ? { page_numbers: pageNumbers } : {}),
      ...(starred === undefined ? {} : { starred }),
      version: expectedVersion + 1,
    })
    .eq('id', documentId)
    .eq('version', expectedVersion)
    .select('id, version')
    .maybeSingle()

  if (error) throw error
  return interpretSaveResult(data as { id: string; version: number } | null)
}

export async function deleteDocument(
  userId: string | null,
  documentId: string,
): Promise<void> {
  if (!userId) {
    guestDeleteDocument(documentId)
    return
  }

  const { error } = await supabase.from('documents').delete().eq('id', documentId)
  if (error) throw error
}

/**
 * Snapshot the current content before an AI edit, so the change is reversible.
 * Signed-in only: guest history is out of scope for local storage.
 */
export async function snapshotDocument(
  userId: string,
  documentId: string,
  content: JSONContent,
  createdBy: 'user' | 'ai' = 'ai',
): Promise<void> {
  const { error } = await supabase.from('document_versions').insert({
    user_id: userId,
    document_id: documentId,
    content,
    created_by: createdBy,
  })
  if (error) throw error
}
