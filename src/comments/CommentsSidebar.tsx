import { useMemo, useState, type FormEvent } from 'react'
import { Check, MessageSquare, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { formatRelativeTime } from '../lib/formatDate'
import { describeOrphan, type AnchorResolution, type CommentAnchor } from './anchor'
import type { Comment, CommentThread } from '../services/comments'
import { cn } from '../lib/cn'

/**
 * The comment panel.
 *
 * Threads are grouped into open and resolved rather than filtered, because
 * "what did we decide about this?" is asked as often as "what is outstanding?"
 * -- and a resolved thread that vanishes reads as a deleted one.
 *
 * A thread whose anchor no longer resolves is shown too, marked as detached.
 * The alternative is hiding it, which silently loses somebody's writing the
 * moment the sentence it referred to is rewritten.
 */

export interface ThreadView {
  thread: CommentThread
  comments: Comment[]
  resolution: AnchorResolution
}

interface CommentsSidebarProps {
  threads: ThreadView[]
  activeThreadId: string | null
  /** Null while signed out; the panel then explains rather than offering a box. */
  currentUserId: string | null
  /**
   * The passage a new comment is being written against.
   *
   * Held by the controller rather than here because it is captured from the
   * editor selection at the moment the composer opens -- by the time this
   * component has focus, the selection is gone.
   */
  draft?: CommentAnchor | null
  onSubmitDraft?: (body: string) => void
  onCancelDraft?: () => void
  busy?: boolean
  error?: string | null
  onSelect: (threadId: string | null) => void
  onReply: (threadId: string, body: string) => void
  onResolve: (threadId: string, resolved: boolean) => void
  onDeleteThread: (threadId: string) => void
  onDeleteComment: (commentId: string) => void
}

function Replies({
  comments,
  currentUserId,
  onDeleteComment,
}: {
  comments: Comment[]
  currentUserId: string | null
  onDeleteComment: (commentId: string) => void
}) {
  return (
    <ul className="space-y-3">
      {comments.map((comment) => (
        <li key={comment.id}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium text-ink">{comment.authorName}</span>
            <span className="shrink-0 text-xs text-ink-faint">
              {formatRelativeTime(comment.createdAt)}
            </span>
          </div>
          <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink-muted">{comment.body}</p>
          {comment.authorId === currentUserId && (
            <button
              type="button"
              onClick={() => onDeleteComment(comment.id)}
              className="mt-1 inline-flex items-center gap-1 text-xs text-ink-faint transition-colors hover:text-danger"
            >
              <Trash2 size={12} aria-hidden="true" />
              Delete
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

function Thread({
  view,
  active,
  currentUserId,
  onSelect,
  onReply,
  onResolve,
  onDeleteThread,
  onDeleteComment,
}: {
  view: ThreadView
  active: boolean
  currentUserId: string | null
  onSelect: (threadId: string | null) => void
  onReply: (threadId: string, body: string) => void
  onResolve: (threadId: string, resolved: boolean) => void
  onDeleteThread: (threadId: string) => void
  onDeleteComment: (commentId: string) => void
}) {
  const [draft, setDraft] = useState('')
  const { thread, comments, resolution } = view
  const resolved = thread.resolvedAt !== null
  const orphaned = resolution.status === 'orphaned'

  function submit(event: FormEvent) {
    event.preventDefault()
    const body = draft.trim()
    if (!body) return
    setDraft('')
    onReply(thread.id, body)
  }

  return (
    <li>
      {/*
        The whole card selects the thread, which is what scrolls the document
        to it. A button rather than a div with a click handler: it has to be
        reachable and operable from the keyboard, and this is the element that
        already is.
      */}
      <button
        type="button"
        aria-expanded={active}
        aria-label={`Comment by ${thread.authorName} on “${thread.anchor.quote}”`}
        onClick={() => onSelect(active ? null : thread.id)}
        className={cn(
          'w-full rounded border px-3 py-2 text-left transition-colors',
          active ? 'border-accent bg-accent-subtle' : 'border-line hover:bg-surface-hover',
          resolved && !active && 'opacity-70',
        )}
      >
        <span
          className={cn(
            'block truncate border-l-2 pl-2 text-xs',
            orphaned ? 'border-line text-ink-faint line-through' : 'border-accent text-ink-muted',
          )}
        >
          {thread.anchor.quote || '(no text selected)'}
        </span>

        {orphaned && (
          <span className="mt-1 block text-xs text-ink-faint">
            {describeOrphan(resolution.reason)}
          </span>
        )}
      </button>

      {active && (
        <div className="mt-2 rounded border border-line bg-surface px-3 py-2">
          <Replies
            comments={comments}
            currentUserId={currentUserId}
            onDeleteComment={onDeleteComment}
          />

          <form onSubmit={submit} className="mt-3">
            <label htmlFor={`reply-${thread.id}`} className="sr-only">
              Reply to this comment
            </label>
            <textarea
              id={`reply-${thread.id}`}
              rows={2}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Reply…"
              className="w-full resize-none rounded border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink placeholder:text-ink-faint"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button type="submit" size="sm" variant="primary" disabled={!draft.trim()}>
                Reply
              </Button>
              <Button
                size="sm"
                onClick={() => onResolve(thread.id, !resolved)}
                aria-label={resolved ? 'Reopen this comment' : 'Resolve this comment'}
              >
                {resolved ? (
                  <>
                    <RotateCcw size={13} aria-hidden="true" /> Reopen
                  </>
                ) : (
                  <>
                    <Check size={13} aria-hidden="true" /> Resolve
                  </>
                )}
              </Button>
              {thread.authorId === currentUserId && (
                <Button
                  size="sm"
                  onClick={() => onDeleteThread(thread.id)}
                  aria-label="Delete this comment thread"
                >
                  <Trash2 size={13} aria-hidden="true" />
                </Button>
              )}
            </div>
          </form>
        </div>
      )}
    </li>
  )
}

/** The composer for a comment that does not exist yet. */
function DraftComposer({
  anchor,
  onSubmit,
  onCancel,
}: {
  anchor: CommentAnchor
  onSubmit: (body: string) => void
  onCancel: () => void
}) {
  const [body, setBody] = useState('')

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        const text = body.trim()
        if (!text) return
        setBody('')
        onSubmit(text)
      }}
      className="mb-3 rounded border border-accent bg-accent-subtle px-3 py-2"
    >
      <p className="truncate border-l-2 border-accent pl-2 text-xs text-ink-muted">
        {anchor.quote}
      </p>
      <label htmlFor="comment-draft" className="sr-only">
        Your comment
      </label>
      <textarea
        id="comment-draft"
        rows={3}
        autoFocus
        value={body}
        onChange={(event) => setBody(event.target.value)}
        // Escape abandons the draft, which is what every other composer in the
        // app does and what the key is for.
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
        }}
        placeholder="Comment…"
        className="mt-2 w-full resize-none rounded border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink placeholder:text-ink-faint"
      />
      <div className="mt-2 flex gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={!body.trim()}>
          Comment
        </Button>
        <Button size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

export function CommentsSidebar({
  threads,
  activeThreadId,
  currentUserId,
  draft = null,
  onSubmitDraft,
  onCancelDraft,
  busy = false,
  error = null,
  onSelect,
  onReply,
  onResolve,
  onDeleteThread,
  onDeleteComment,
}: CommentsSidebarProps) {
  const { open, resolved } = useMemo(
    () => ({
      open: threads.filter((view) => view.thread.resolvedAt === null),
      resolved: threads.filter((view) => view.thread.resolvedAt !== null),
    }),
    [threads],
  )

  if (!currentUserId) {
    return (
      <div className="p-4">
        <p className="text-sm text-ink">Sign in to comment.</p>
        <p className="mt-2 text-sm text-ink-muted">
          Comments are addressed to someone. Notes on this device are only yours,
          so there is nobody to address them to yet.
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto p-3">
        {error && (
          <p role="alert" className="mb-3 text-sm text-danger">
            {error}
          </p>
        )}

        {draft && onSubmitDraft && onCancelDraft && (
          <DraftComposer anchor={draft} onSubmit={onSubmitDraft} onCancel={onCancelDraft} />
        )}

        {threads.length === 0 && !draft && !busy && (
          <div className="px-1 py-6 text-center">
            <MessageSquare
              size={20}
              aria-hidden="true"
              className="mx-auto text-ink-faint"
            />
            <p className="mt-2 text-sm text-ink-muted">No comments yet.</p>
            <p className="mt-1 text-xs text-ink-faint">
              Select some text and choose Comment to start one.
            </p>
          </div>
        )}

        {open.length > 0 && (
          <ul className="space-y-2">
            {open.map((view) => (
              <Thread
                key={view.thread.id}
                view={view}
                active={view.thread.id === activeThreadId}
                currentUserId={currentUserId}
                onSelect={onSelect}
                onReply={onReply}
                onResolve={onResolve}
                onDeleteThread={onDeleteThread}
                onDeleteComment={onDeleteComment}
              />
            ))}
          </ul>
        )}

        {resolved.length > 0 && (
          <>
            <h3 className="mb-2 mt-5 font-ui text-xs font-medium uppercase tracking-wide text-ink-faint">
              Resolved ({resolved.length})
            </h3>
            <ul className="space-y-2">
              {resolved.map((view) => (
                <Thread
                  key={view.thread.id}
                  view={view}
                  active={view.thread.id === activeThreadId}
                  currentUserId={currentUserId}
                  onSelect={onSelect}
                  onReply={onReply}
                  onResolve={onResolve}
                  onDeleteThread={onDeleteThread}
                  onDeleteComment={onDeleteComment}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
