import { supabase } from '../lib/supabase'
import type { CommentAnchor } from '../comments/anchor'

/**
 * Comment threads and their replies.
 *
 * Signed-in only, and that is a real limitation rather than an oversight worth
 * hiding: a comment is addressed to somebody, and guest notes live in one
 * browser on one device with nobody else able to open them. The panel says so
 * instead of offering a box that writes to nowhere.
 *
 * Reads go through `list_comment_threads` / `list_comments` rather than plain
 * selects. Both need the author's display name, and `profiles` is readable only
 * by its owner -- a straight join returns null for everybody except yourself,
 * so every comment but your own would be signed "Someone". The functions run as
 * SECURITY DEFINER to read names and are gated on `can_view_document`, so they
 * cannot be used to enumerate anyone.
 */

export interface CommentThread {
  id: string
  authorId: string
  authorName: string
  anchor: CommentAnchor
  resolvedAt: string | null
  resolvedBy: string | null
  createdAt: string
  replyCount: number
}

export interface Comment {
  id: string
  threadId: string
  authorId: string
  authorName: string
  body: string
  createdAt: string
  updatedAt: string
}

interface ThreadRow {
  id: string
  author_id: string
  author_name: string
  anchor: CommentAnchor
  resolved_at: string | null
  resolved_by: string | null
  created_at: string
  reply_count: number
}

interface CommentRow {
  id: string
  thread_id: string
  author_id: string
  author_name: string
  body: string
  created_at: string
  updated_at: string
}

const toThread = (row: ThreadRow): CommentThread => ({
  id: row.id,
  authorId: row.author_id,
  authorName: row.author_name,
  anchor: row.anchor,
  resolvedAt: row.resolved_at,
  resolvedBy: row.resolved_by,
  createdAt: row.created_at,
  replyCount: row.reply_count,
})

const toComment = (row: CommentRow): Comment => ({
  id: row.id,
  threadId: row.thread_id,
  authorId: row.author_id,
  authorName: row.author_name,
  body: row.body,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

/** Everything on one document, in one round trip each. */
export async function fetchComments(
  documentId: string,
): Promise<{ threads: CommentThread[]; comments: Comment[] }> {
  const [threadResult, commentResult] = await Promise.all([
    supabase.rpc('list_comment_threads', { p_document_id: documentId }),
    supabase.rpc('list_comments', { p_document_id: documentId }),
  ])

  if (threadResult.error) throw threadResult.error
  if (commentResult.error) throw commentResult.error

  return {
    threads: ((threadResult.data ?? []) as ThreadRow[]).map(toThread),
    comments: ((commentResult.data ?? []) as CommentRow[]).map(toComment),
  }
}

/**
 * Starts a thread and writes its first comment.
 *
 * Not a transaction, because PostgREST has no way to express one from here. If
 * the comment insert fails the thread is removed again rather than left behind:
 * an anchored thread with nothing in it renders as a highlight over the
 * student's text that says nothing and cannot be replied to.
 */
export async function createThread(params: {
  documentId: string
  userId: string
  anchor: CommentAnchor
  body: string
}): Promise<string> {
  const { data, error } = await supabase
    .from('comment_threads')
    .insert({
      document_id: params.documentId,
      author_id: params.userId,
      anchor: params.anchor,
    })
    .select('id')
    .single()

  if (error) throw error
  const threadId = (data as { id: string }).id

  const { error: commentError } = await supabase.from('comments').insert({
    thread_id: threadId,
    author_id: params.userId,
    body: params.body,
  })

  if (commentError) {
    await supabase.from('comment_threads').delete().eq('id', threadId)
    throw commentError
  }

  return threadId
}

export async function replyToThread(params: {
  threadId: string
  userId: string
  body: string
}): Promise<void> {
  const { error } = await supabase.from('comments').insert({
    thread_id: params.threadId,
    author_id: params.userId,
    body: params.body,
  })
  if (error) throw error
}

/**
 * Resolves or reopens a thread.
 *
 * Reopening clears who resolved it as well as when. Leaving the name behind
 * would make the next resolution ambiguous: the row would claim a resolver
 * while being unresolved.
 */
export async function setThreadResolved(params: {
  threadId: string
  userId: string
  resolved: boolean
}): Promise<void> {
  const { error } = await supabase
    .from('comment_threads')
    .update(
      params.resolved
        ? { resolved_at: new Date().toISOString(), resolved_by: params.userId }
        : { resolved_at: null, resolved_by: null },
    )
    .eq('id', params.threadId)

  if (error) throw error
}

/** Removes a thread and, by cascade, every reply in it. */
export async function deleteThread(threadId: string): Promise<void> {
  const { error } = await supabase.from('comment_threads').delete().eq('id', threadId)
  if (error) throw error
}

export async function updateComment(params: {
  commentId: string
  body: string
}): Promise<void> {
  const { error } = await supabase
    .from('comments')
    .update({ body: params.body })
    .eq('id', params.commentId)
  if (error) throw error
}

export async function deleteComment(commentId: string): Promise<void> {
  const { error } = await supabase.from('comments').delete().eq('id', commentId)
  if (error) throw error
}
