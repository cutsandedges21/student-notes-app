import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowUp } from 'lucide-react'
import { SuggestionCard } from './SuggestionCard'
import { AIService, AI_ACTIONS } from '../services/aiClient'
import {
  AI_MODE_LABELS,
  AiRequestError,
  describeAiError,
  type AiActionMode,
  type AiIssue,
  type AiMode,
  type AiResponse,
} from '../types/ai'
import {
  AI_SHORTCUT_KEYS,
  AI_SHORTCUT_ORDER,
  describeSelectionNeeded,
} from '../lib/shortcuts'
import { cn } from '../lib/cn'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export interface AiSelection {
  text: string
  from: number
  to: number
}

interface Turn {
  id: string
  role: 'user' | 'assistant'
  /** Prose shown in the transcript. */
  content: string
  /** Present when the assistant proposed an edit. */
  result?: AiResponse
  /** The text the suggestion would replace. */
  original?: string
}

interface AiSidebarProps {
  documentId: string
  classId: string
  selection: AiSelection | null
  /** Runs when the student accepts a suggestion. */
  onApply: (content: string, selection: AiSelection | null) => void
  /**
   * Offers a rewrite in the document itself, against the range it was asked
   * about. The range travels with the suggestion rather than being read from
   * the live selection at accept time: the student is free to click elsewhere
   * while the model is thinking, and the offer has to keep meaning the words
   * it was made about.
   */
  onPreview: (
    content: string,
    target: AiSelection,
    outcome: { onAccept: () => void; onDecline: () => void },
  ) => void
  /**
   * Set by the editor page when an action is triggered from the document --
   * the floating toolbar over a selection, or a Ctrl+Alt shortcut. The
   * selection is nullable because a shortcut can fire with nothing highlighted,
   * which is the case the assistant has to ask about rather than guess at.
   */
  pendingMode: { mode: AiMode; selection: AiSelection | null } | null
  onPendingHandled: () => void
  /**
   * False for the copy of this panel that is currently hidden by a breakpoint.
   * Both copies are always mounted, so without this every pending action would
   * be sent twice -- two API calls, two entries in the transcript.
   */
  active?: boolean
}

const newId = () => crypto.randomUUID()

export function AiSidebar({
  documentId,
  classId,
  selection,
  onApply,
  onPreview,
  pendingMode,
  onPendingHandled,
  active = true,
}: AiSidebarProps) {
  const { session } = useAuth()
  const [turns, setTurns] = useState<Turn[]>([])
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /*
   * Set when a suggestion was declined in the document. The next thing typed
   * into the question box is then treated as "what was wrong with it" and
   * re-runs that same action on that same text, rather than starting an
   * unrelated chat.
   */
  const [revising, setRevising] = useState<{
    mode: AiActionMode
    target: AiSelection
  } | null>(null)
  const transcriptRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight })
  }, [turns, busy])

  async function run(
    label: string,
    call: () => Promise<AiResponse>,
    original?: string,
    target?: AiSelection | null,
    mode?: AiActionMode,
  ) {
    setError(null)
    setBusy(true)
    setTurns((current) => [...current, { id: newId(), role: 'user', content: label }])

    try {
      const result = await call()
      setTurns((current) => [
        ...current,
        { id: newId(), role: 'assistant', content: result.response, result, original },
      ])

      // A rewrite is shown in the note, next to the words it would replace.
      // Modes that only explain or answer have nothing to put there.
      if (result.proposed_content && target) {
        onPreview(result.proposed_content, target, {
          // Accepting settles the question, so the transcript that led here
          // has served its purpose and would otherwise sit there stale,
          // offering an edit the note has already taken.
          onAccept: () => {
            setTurns([])
            setError(null)
            setRevising(null)
          },
          // Declining is rarely "no" outright -- it is usually "not like
          // that". Asking what to change turns a dead end into the next
          // attempt, with the answer steering a re-run.
          onDecline: () => {
            if (!mode) return
            setRevising({ mode, target })
            setTurns((current) => [
              ...current,
              {
                id: newId(),
                role: 'assistant',
                content: 'What should I change about that suggestion?',
              },
            ])
          },
        })
      }
    } catch (caught) {
      const code = caught instanceof AiRequestError ? caught.code : 'UPSTREAM_ERROR'
      setError(describeAiError(code))
      // Drop the orphaned prompt so the transcript doesn't imply an answer came.
      setTurns((current) => current.slice(0, -1))
    } finally {
      setBusy(false)
    }
  }

  /**
   * The one path every suggested action takes, whether it came from a button
   * here, the floating toolbar, or a keyboard shortcut.
   *
   * With nothing highlighted it asks which part of the notes to work on
   * instead of running. These modes rewrite the student's own words, so acting
   * on a guess -- the whole document, or wherever the caret happens to sit --
   * produces an edit nobody asked for.
   */
  function startAction(mode: AiActionMode, target: AiSelection | null) {
    const action = AI_ACTIONS.find((entry) => entry.mode === mode)
    if (!action) return

    if (!target?.text.trim()) {
      setError(null)
      setTurns((current) => [
        ...current,
        { id: newId(), role: 'user', content: AI_MODE_LABELS[mode] },
        { id: newId(), role: 'assistant', content: describeSelectionNeeded(mode) },
      ])
      return
    }

    const excerpt = `${target.text.slice(0, 60)}${target.text.length > 60 ? '…' : ''}`
    void run(
      `${AI_MODE_LABELS[mode]} — “${excerpt}”`,
      () => action.run({ documentId, classId, selectedText: target.text }),
      target.text,
      target,
      mode,
    )
  }

  // An action fired from the document: the floating selection toolbar, or a
  // Ctrl+Alt shortcut.
  useEffect(() => {
    if (!active || !pendingMode || busy) return

    const { mode, selection: target } = pendingMode
    onPendingHandled()

    // CHAT has no suggested-action button; it just opens the panel so the
    // question box can be used against the selection.
    if (mode === 'CHAT') return
    startAction(mode, target)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingMode, active])

  function handleAsk(event: FormEvent) {
    event.preventDefault()
    const asked = question.trim()
    if (!asked || busy) return

    setQuestion('')

    /*
     * A declined suggestion turns the next message into a revision: the same
     * action, on the same words, with what the student disliked passed along.
     * Routing it to CHAT instead would answer the complaint in prose and
     * leave the note untouched, which is not what "decline and say why" asks
     * for.
     */
    if (revising) {
      const { mode, target } = revising
      const action = AI_ACTIONS.find((entry) => entry.mode === mode)
      setRevising(null)
      if (action) {
        void run(
          asked,
          () => action.run({ documentId, classId, selectedText: target.text }, asked),
          target.text,
          target,
          mode,
        )
        return
      }
    }

    const history = turns.slice(-6).map((turn) => ({ role: turn.role, content: turn.content }))
    void run(asked, () =>
      AIService.chat({ documentId, classId, selectedText: selection?.text }, asked, history),
    )
  }

  function applyIssueFix(issue: AiIssue) {
    // The issue quotes the student's own wording, so it can be replaced in place
    // without needing an active selection.
    onApply(issue.correction, null)
  }

  return (
    <div className="flex h-full flex-col">
      {/*
        The assistant reads your class notes from the database, so it needs an
        account. Saying so up front beats letting a guest press the actions and
        collect a generic failure they can only respond to by trying again.
      */}
      {!session ? (
        <div className="flex-1 p-4">
          <p className="text-sm text-ink">Sign in to use the AI assistant.</p>
          <p className="mt-2 text-sm text-ink-muted">
            It works from your class notes, which live in your account. Your
            notes on this device come with you when you sign up.
          </p>
          <div className="mt-4 flex gap-2">
            <Link
              to="/signup"
              className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
            >
              Create account
            </Link>
            <Link
              to="/login"
              className="rounded border border-line-strong px-3 py-1.5 text-sm text-ink transition-colors hover:bg-surface-hover"
            >
              Sign in
            </Link>
          </div>
        </div>
      ) : (
      <div ref={transcriptRef} className="flex-1 overflow-y-auto p-4">
        {turns.length === 0 && !busy && (
          <>
            <p className="text-sm text-ink-muted">What would you like help with?</p>
            <div className="mt-3 flex flex-col gap-1.5">
              {AI_SHORTCUT_ORDER.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => startAction(mode, selection)}
                  className="flex items-center justify-between gap-3 rounded border border-line px-3 py-2 text-left text-sm text-ink transition-colors hover:border-line-strong hover:bg-surface-hover"
                >
                  {AI_MODE_LABELS[mode]}
                  {/* The shortcut lives on the button so it is learned in
                      passing, rather than only in the Tools dialog. */}
                  <kbd className="shrink-0 rounded border border-line bg-surface-backdrop px-1.5 py-0.5 font-ui text-[11px] text-ink-faint">
                    {AI_SHORTCUT_KEYS[mode]}
                  </kbd>
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-ink-faint">
              {selection
                ? 'Actions will use your selected text.'
                : 'Highlight part of your notes first — these actions work on what you select.'}
            </p>
          </>
        )}

        <div className="flex flex-col gap-4">
          {turns.map((turn) =>
            turn.role === 'user' ? (
              <p key={turn.id} className="text-sm font-medium text-ink">
                {turn.content}
              </p>
            ) : turn.result &&
              (turn.result.proposed_content ||
                turn.result.issues.length > 0 ||
                turn.result.added_information.length > 0) ? (
              <SuggestionCard
                key={turn.id}
                result={turn.result}
                original={turn.original}
                onApply={(content) => onApply(content, selection)}
                onReject={() =>
                  setTurns((current) => current.filter((entry) => entry.id !== turn.id))
                }
                onFixIssue={applyIssueFix}
                onDismissIssue={() => undefined}
              />
            ) : (
              <p key={turn.id} className="whitespace-pre-wrap text-sm text-ink-muted">
                {turn.content}
              </p>
            ),
          )}
        </div>

        {busy && (
          <p className="mt-4 text-sm text-ink-faint" aria-live="polite">
            <span className="inline-flex gap-1">
              Thinking
              <span className="animate-pulse">…</span>
            </span>
          </p>
        )}

        {error && (
          <p role="alert" className="mt-4 text-sm text-red-600">
            {error}
          </p>
        )}
      </div>
      )}

      {session && (
      <form onSubmit={handleAsk} className="shrink-0 border-t border-line p-3">
        <div className="flex items-end gap-2">
          <label htmlFor="ai-question" className="sr-only">
            Ask the AI assistant
          </label>
          <textarea
            id="ai-question"
            rows={2}
            value={question}
            // The box does something different while a decline is pending, so
            // it says so rather than leaving the student to discover it.
            placeholder={revising ? 'What should I change?' : 'Ask anything…'}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends; Shift+Enter is a newline, matching chat conventions.
              if (event.key === 'Enter' && !event.shiftKey) handleAsk(event)
            }}
            className="min-h-[38px] flex-1 resize-none rounded border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink placeholder:text-ink-faint"
          />
          <button
            type="submit"
            disabled={!question.trim() || busy}
            aria-label="Send"
            title="Send"
            className={cn(
              'grid h-8 w-8 shrink-0 place-items-center rounded transition-colors',
              'bg-accent text-white hover:bg-accent-hover',
              'disabled:cursor-not-allowed disabled:opacity-40',
            )}
          >
            <ArrowUp size={16} />
          </button>
        </div>
      </form>
      )}
    </div>
  )
}
