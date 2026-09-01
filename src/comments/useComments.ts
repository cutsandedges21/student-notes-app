import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import * as Y from 'yjs'
import {
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
  ySyncPluginKey,
} from '@tiptap/y-tiptap'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { describeDataError } from '../lib/dataErrors'
import {
  createThread,
  deleteComment as deleteCommentRemote,
  deleteThread as deleteThreadRemote,
  fetchComments,
  replyToThread,
  setThreadResolved,
  type Comment,
  type CommentThread,
} from '../services/comments'
import { captureAnchor, resolveAnchor, type CommentAnchor, type YContext } from './anchor'
import type { ThreadView } from './CommentsSidebar'
import type { CommentRange } from '../editor/commentHighlight'

/**
 * Owns the comment state for one document.
 *
 * Three jobs, kept together because they are one loop: fetch the threads,
 * resolve each anchor against the document as it currently stands, and push
 * the resulting ranges into the editor so the commented passages light up.
 *
 * Re-resolving is not incidental. An anchor describes a passage, not a
 * position, so the answer changes whenever the note does -- which with
 * collaboration is whenever anybody types. The plugin maps highlights through
 * edits between refreshes so they track typing smoothly; this hook is what
 * corrects them afterwards.
 */

/** Debounce on re-resolving after edits: long enough not to run per keystroke. */
const RESOLVE_DELAY_MS = 400

export interface UseCommentsOptions {
  /**
   * Empty while the note is still loading.
   *
   * This hook is called before the page knows which note it is showing,
   * because hooks cannot be called conditionally -- so it has to be a no-op
   * until an id arrives rather than assume one.
   */
  documentId: string
  userId: string | null
  editor: Editor | null
  /** Present when the document is collaborating; improves anchor accuracy. */
  ydoc?: Y.Doc | null
}

export interface CommentsController {
  threads: ThreadView[]
  activeThreadId: string | null
  loading: boolean
  error: string | null
  /** True when there is a selection worth commenting on. */
  canComment: boolean
  /**
   * The passage a new comment is being written against, if one is being
   * written. Captured when the composer opens rather than when it is
   * submitted: the selection is lost the moment focus moves to the text box.
   */
  draft: CommentAnchor | null
  startDraft: () => void
  cancelDraft: () => void
  submitDraft: (body: string) => Promise<void>
  setActiveThreadId: (threadId: string | null) => void
  reply: (threadId: string, body: string) => Promise<void>
  resolve: (threadId: string, resolved: boolean) => Promise<void>
  removeThread: (threadId: string) => Promise<void>
  removeComment: (commentId: string) => Promise<void>
}

/**
 * Builds the Yjs half of an anchor, when there is one to build.
 *
 * The ProseMirror↔Yjs mapping lives in the ySync plugin's state and nowhere
 * else, so this reaches in for it. Everything is best-effort and wrapped:
 * without it an anchor still carries its quote and surrounding context, which
 * is what already resolves comments on documents that are not collaborating at
 * all. A comment panel is not worth taking the editor down for.
 */
function yContext(editor: Editor | null, ydoc: Y.Doc | null | undefined): YContext | undefined {
  if (!editor || !ydoc) return undefined

  try {
    const sync = ySyncPluginKey.getState(editor.state) as {
      binding?: { type?: Y.XmlFragment; mapping?: Map<unknown, unknown> }
    } | null

    const fragment = sync?.binding?.type
    const mapping = sync?.binding?.mapping
    if (!fragment || !mapping) return undefined

    return {
      ydoc,
      fragment,
      mapping,
      toRelative: (pos, frag, map) =>
        absolutePositionToRelativePosition(pos, frag, map as never),
      toAbsolute: (doc, frag, relative, map) =>
        relativePositionToAbsolutePosition(doc, frag, relative, map as never),
    }
  } catch {
    return undefined
  }
}

export function useComments({
  documentId,
  userId,
  editor,
  ydoc,
}: UseCommentsOptions): CommentsController {
  const [threads, setThreads] = useState<CommentThread[]>([])
  const [comments, setComments] = useState<Comment[]>([])
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Bumped by editor changes so anchors are recomputed against the new doc. */
  const [docRevision, setDocRevision] = useState(0)
  const [draft, setDraft] = useState<CommentAnchor | null>(null)

  const enabled = Boolean(userId) && Boolean(documentId) && isSupabaseConfigured

  const load = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    try {
      const result = await fetchComments(documentId)
      setThreads(result.threads)
      setComments(result.comments)
      setError(null)
    } catch (caught) {
      console.error('[useComments] failed to load comments:', caught)
      setError(describeDataError(caught))
    } finally {
      setLoading(false)
    }
  }, [documentId, enabled])

  // Reload when the document changes. Threads never carry over: an anchor from
  // one note means nothing in another.
  useEffect(() => {
    setThreads([])
    setComments([])
    setActiveThreadId(null)
    setDraft(null)
    void load()
  }, [load])

  /*
   * Live updates.
   *
   * The document itself syncs in real time, so a comment that only showed up
   * on reload would be conspicuous -- two people writing together, one of them
   * talking into a panel the other cannot see. Refetches rather than applying
   * the payload: the list functions attach author names, which the raw
   * replicated row does not carry.
   */
  useEffect(() => {
    if (!enabled) return

    const channel = supabase
      .channel(`comments:${documentId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'comment_threads', filter: `document_id=eq.${documentId}` },
        () => void load(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'comments' },
        () => void load(),
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [documentId, enabled, load])

  // Re-resolve anchors after the document settles, debounced so this does not
  // run per keystroke.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!editor) return

    const onUpdate = () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setDocRevision((n) => n + 1), RESOLVE_DELAY_MS)
    }

    editor.on('update', onUpdate)
    return () => {
      editor.off('update', onUpdate)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [editor])

  const views = useMemo<ThreadView[]>(() => {
    if (!editor) {
      return threads.map((thread) => ({
        thread,
        comments: comments.filter((entry) => entry.threadId === thread.id),
        resolution: { status: 'orphaned', reason: 'not-found' } as const,
      }))
    }

    const y = yContext(editor, ydoc)
    return threads.map((thread) => ({
      thread,
      comments: comments.filter((entry) => entry.threadId === thread.id),
      resolution: resolveAnchor(editor.state.doc, thread.anchor, y),
    }))
    // `docRevision` is the dependency that matters: it is what says the
    // document changed underneath these anchors.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads, comments, editor, ydoc, docRevision])

  // Push the resolved ranges into the editor so the passages light up.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return

    const ranges: CommentRange[] = views
      .filter((view) => view.resolution.status === 'resolved')
      .map((view) => {
        const resolved = view.resolution as Extract<
          typeof view.resolution,
          { status: 'resolved' }
        >
        return { threadId: view.thread.id, from: resolved.from, to: resolved.to }
      })

    editor.commands.setCommentRanges(ranges, activeThreadId)
  }, [views, activeThreadId, editor])

  // Selecting a thread scrolls its passage into view, which is the point of
  // the list being clickable at all.
  const selectThread = useCallback(
    (threadId: string | null) => {
      setActiveThreadId(threadId)
      if (!threadId || !editor) return

      const view = views.find((entry) => entry.thread.id === threadId)
      if (view?.resolution.status !== 'resolved') return

      editor.commands.setTextSelection({
        from: view.resolution.from,
        to: view.resolution.to,
      })
      editor.commands.scrollIntoView()
    },
    [editor, views],
  )

  const guard = useCallback(
    async (action: () => Promise<void>) => {
      try {
        await action()
        setError(null)
        await load()
      } catch (caught) {
        console.error('[useComments] action failed:', caught)
        setError(describeDataError(caught))
      }
    },
    [load],
  )

  const selection = editor?.state.selection
  const canComment = Boolean(
    enabled && editor && selection && !selection.empty && editor.isEditable,
  )

  /*
   * The anchor is taken here, when the composer opens, and not when it is
   * submitted. Clicking into the text box collapses the document selection, so
   * reading it at submit time would find nothing to anchor to -- and the
   * fallback would be a comment attached to wherever the caret happened to
   * land, which is worse than refusing.
   */
  const startDraft = useCallback(() => {
    if (!editor || !userId) return
    const { from, to } = editor.state.selection
    if (from === to) return
    setDraft(captureAnchor(editor.state.doc, from, to, yContext(editor, ydoc)))
  }, [editor, userId, ydoc])

  const submitDraft = useCallback(
    async (body: string) => {
      const anchor = draft
      if (!anchor || !userId || !body.trim()) return

      await guard(async () => {
        const threadId = await createThread({
          documentId,
          userId,
          anchor,
          body: body.trim(),
        })
        setDraft(null)
        setActiveThreadId(threadId)
      })
    },
    [documentId, draft, guard, userId],
  )

  return {
    threads: views,
    activeThreadId,
    loading,
    error,
    canComment,
    draft,
    startDraft,
    cancelDraft: () => setDraft(null),
    submitDraft,
    setActiveThreadId: selectThread,
    reply: (threadId, body) =>
      guard(() => replyToThread({ threadId, userId: userId!, body })),
    resolve: (threadId, resolved) =>
      guard(() => setThreadResolved({ threadId, userId: userId!, resolved })),
    removeThread: (threadId) =>
      guard(async () => {
        await deleteThreadRemote(threadId)
        setActiveThreadId((current) => (current === threadId ? null : current))
      }),
    removeComment: (commentId) => guard(() => deleteCommentRemote(commentId)),
  }
}
