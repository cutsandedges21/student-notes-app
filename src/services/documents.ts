import { supabase } from '../lib/supabase'
import { extractPlainText } from '../lib/tiptap'
import type { JSONContent } from '@tiptap/react'
import type { DocumentListItem, DocumentRow } from '../types/database'
import {
  guestCreateDocument,
  guestDeleteDocument,
  guestFetchDocument,
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
    .select('id, class_id, title, created_at, updated_at')
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

export async function createDocument(
  userId: string | null,
  classId: string,
  title = '',
): Promise<DocumentRow> {
  if (!userId) return guestCreateDocument(classId, title)

  const { data, error } = await supabase
    .from('documents')
    .insert({
      user_id: userId,
      class_id: classId,
      title,
      content: EMPTY_DOC,
      content_text: '',
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
  },
): Promise<SaveResult> {
  if (!userId) return guestSaveDocument(params)

  const { documentId, title, content, expectedVersion } = params

  const { data, error } = await supabase
    .from('documents')
    .update({
      title,
      content,
      content_text: extractPlainText(content),
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
