import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowUp } from 'lucide-react'
import { SuggestionCard } from './SuggestionCard'
import { AIService, AI_ACTIONS } from '../services/aiClient'
import {
  AI_MODE_LABELS,
  AiRequestError,
  describeAiError,
  type AiIssue,
  type AiMode,
  type AiResponse,
} from '../types/ai'
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
  /** Set by the editor page when a selection action is triggered from the document. */
  pendingMode: { mode: AiMode; selection: AiSelection } | null
  onPendingHandled: () => void
}

const newId = () => crypto.randomUUID()

export function AiSidebar({
  documentId,
  classId,
  selection,
  onApply,
  pendingMode,
  onPendingHandled,
}: AiSidebarProps) {
  const { session } = useAuth()
  const [turns, setTurns] = useState<Turn[]>([])
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const transcriptRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight })
  }, [turns, busy])

  async function run(
    label: string,
    call: () => Promise<AiResponse>,
    original?: string,
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
    } catch (caught) {
      const code = caught instanceof AiRequestError ? caught.code : 'UPSTREAM_ERROR'
      setError(describeAiError(code))
      // Drop the orphaned prompt so the transcript doesn't imply an answer came.
      setTurns((current) => current.slice(0, -1))
    } finally {
      setBusy(false)
    }
  }

  // A selection action fired from the floating toolbar in the document.
  useEffect(() => {
    if (!pendingMode || busy) return

    const { mode, selection: target } = pendingMode
    const action = AI_ACTIONS.find((entry) => entry.mode === mode)
    onPendingHandled()

    if (!action) return
    void run(
      `${AI_MODE_LABELS[action.mode]} — “${target.text.slice(0, 60)}${target.text.length > 60 ? '…' : ''}”`,
      () => action.run({ documentId, classId, selectedText: target.text }),
      target.text,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingMode])

  function handleAction(mode: Exclude<AiMode, 'CHAT'>) {
    const action = AI_ACTIONS.find((entry) => entry.mode === mode)!
    const selectedText = selection?.text
    void run(
      AI_MODE_LABELS[mode],
      () => action.run({ documentId, classId, selectedText }),
      selectedText,
    )
  }

  function handleAsk(event: FormEvent) {
    event.preventDefault()
    const asked = question.trim()
    if (!asked || busy) return

    setQuestion('')
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
              {AI_ACTIONS.map((action) => (
                <button
                  key={action.mode}
                  type="button"
                  onClick={() => handleAction(action.mode)}
                  className="rounded border border-line px-3 py-2 text-left text-sm text-ink transition-colors hover:border-line-strong hover:bg-surface-hover"
                >
                  {AI_MODE_LABELS[action.mode]}
                </button>
              ))}
            </div>
            {selection && (
              <p className="mt-3 text-xs text-ink-faint">
                Actions will use your selected text.
              </p>
            )}
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
            placeholder="Ask anything…"
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
