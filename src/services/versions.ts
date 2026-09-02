import type { JSONContent } from '@tiptap/react'
import { supabase } from '../lib/supabase'

/**
 * Version history.
 *
 * `document_versions` has existed since the first migration and nothing has
 * ever read it. Snapshots were written before AI edits so an AI change stayed
 * reversible after the editor's own undo history was gone -- a good instinct
 * with no way to act on it.
 *
 * Insert-only by policy: the table has no update and no delete policy, and
 * that is deliberate. History cannot be rewritten by the client, and rows
 * disappear only when the document or the account does, by cascade. Restoring
 * therefore adds a version rather than removing any, which is also the
 * behaviour you want -- restoring the wrong version is itself undoable.
 *
 * Signed-in only, like comments. Guest notes live in one browser with no
 * server to keep history on, and the panel says so rather than showing an
 * empty list that never fills.
 */

export type VersionOrigin = 'user' | 'ai'

export interface DocumentVersion {
  id: string
  documentId: string
  /** What produced this snapshot, not who wrote the words. */
  createdBy: VersionOrigin
  createdAt: string
}

/** A version with its content. Fetched one at a time; the list carries none. */
export interface DocumentVersionContent extends DocumentVersion {
  content: JSONContent
}

interface VersionRow {
  id: string
  document_id: string
  created_by: VersionOrigin
  created_at: string
}

interface VersionContentRow extends VersionRow {
  content: JSONContent
}

function toVersion(row: VersionRow): DocumentVersion {
  return {
    id: row.id,
    documentId: row.document_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }
}

/**
 * How many versions a single page of history holds.
 *
 * The list deliberately does not select `content`. A note's history is the one
 * table in the app that grows without bound, and each row carries a full copy
 * of the document -- fetching thirty of those to render thirty timestamps
 * would move megabytes to draw a list.
 */
export const VERSION_PAGE_SIZE = 30

/**
 * Newest first, because that is the end people look at.
 *
 * `before` pages backwards through time using the previous page's oldest
 * `createdAt`, rather than an offset. Offsets shift under inserts, and this
 * table gets inserts while you are reading it.
 */
export async function listVersions(
  documentId: string,
  options: { before?: string; limit?: number } = {},
): Promise<DocumentVersion[]> {
  let query = supabase
    .from('document_versions')
    .select('id, document_id, created_by, created_at')
    .eq('document_id', documentId)
    .order('created_at', { ascending: false })
    .limit(options.limit ?? VERSION_PAGE_SIZE)

  if (options.before) query = query.lt('created_at', options.before)

  const { data, error } = await query
  if (error) throw error

  return (data ?? []).map((row) => toVersion(row as VersionRow))
}

/** One version, with its content, for previewing or restoring. */
export async function fetchVersion(versionId: string): Promise<DocumentVersionContent> {
  const { data, error } = await supabase
    .from('document_versions')
    .select('id, document_id, created_by, created_at, content')
    .eq('id', versionId)
    .single()

  if (error) throw error
  if (!data) throw new Error('That version no longer exists.')

  const row = data as VersionContentRow
  return { ...toVersion(row), content: row.content }
}

/**
 * Writes a snapshot.
 *
 * Deliberately not called from autosave. Autosave runs a second after every
 * pause in typing, and a version per pause would turn an afternoon's work into
 * hundreds of rows, each holding a whole copy of the note -- a history nobody
 * can read stored at a cost nobody agreed to. Snapshots are taken at moments
 * that mean something instead: before an AI edit rewrites the note, before a
 * restore replaces it, and when the writer asks.
 */
export async function createVersion(
  userId: string,
  documentId: string,
  content: JSONContent,
  createdBy: VersionOrigin = 'user',
): Promise<void> {
  const { error } = await supabase.from('document_versions').insert({
    user_id: userId,
    document_id: documentId,
    content,
    created_by: createdBy,
  })
  if (error) throw error
}
