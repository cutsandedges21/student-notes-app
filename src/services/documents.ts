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
} from './guestStore'

const EMPTY_DOC: JSONContent = { type: 'doc', content: [] }

export type SaveResult = { status: 'saved'; version: number } | { status: 'stale' }

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
    /** Supply to keep the slug in step with the title. */
    classId?: string
    header?: JSONContent
    footer?: JSONContent
  },
): Promise<SaveResult> {
  if (!userId) return guestSaveDocument(params)

  const { documentId, title, content, expectedVersion, classId, header, footer } = params

  // Retitling re-slugs so the URL keeps matching the note. Only done when the
  // caller passes classId, since the new slug has to be unique within it.
  let slugPatch: Record<string, string> = {}
  if (classId) {
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
