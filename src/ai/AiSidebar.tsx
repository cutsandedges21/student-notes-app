import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowUp, ChevronLeft, Menu, PanelBottom, Plus, SlidersHorizontal, SquarePen } from 'lucide-react'
import { SuggestionCard } from './SuggestionCard'
import { SparkIcon } from '../editor/DocsIcons'
import { useAiConversation } from './AiConversation'
import { AI_MODE_LABELS } from '../types/ai'
import { AI_SHORTCUT_KEYS, AI_SHORTCUT_ORDER } from '../lib/shortcuts'
import { cn } from '../lib/cn'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useOpenSource } from './useOpenSource'
import { useProposedActions } from './useProposedActions'

export type { AiSelection } from './AiConversation'

/**
 * The assistant as a column beside the page.
 *
 * A view over the shared conversation rather than an owner of one: the same
 * transcript is shown by the docked bar, and moving between them mid-thought
 * has to keep the thread.
 *
 * The menu behind the hamburger is a second view of this same panel rather than
 * a popover, because on a 360px column a popover covering the conversation is
 * indistinguishable from a page anyway -- and a back arrow explains itself
 * where a dismissible layer does not.
 */

interface AiSidebarProps {
  /** Sends the assistant back to the bar under the page. */
  onMoveToDock?: () => void
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="grid h-8 w-8 place-items-center rounded-full text-docs-icon transition-colors hover:bg-docs-chrome-hover"
    >
      {children}
    </button>
  )
}

/** History, suggestions and settings -- the page behind the hamburger. */
function MenuView({
  onBack,
  onPick,
}: {
  onBack: () => void
  onPick: (mode: (typeof AI_SHORTCUT_ORDER)[number]) => void
}) {
  const { turns, clear } = useAiConversation()
  const asked = turns.filter((turn) => turn.role === 'user')

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 px-2 py-2">
        <IconButton label="Back" onClick={onBack}>
          <ChevronLeft size={18} />
        </IconButton>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <section>
          <h3 className="text-sm font-medium text-ink">History</h3>
          {asked.length === 0 ? (
            <p className="mt-2 text-sm text-ink-faint">Nothing asked yet.</p>
          ) : (
            <ul className="mt-2 flex flex-col">
              {asked
                .slice()
                .reverse()
                .map((turn) => (
                  <li key={turn.id}>
                    <button
                      type="button"
                      onClick={onBack}
                      className="flex w-full items-center gap-2 rounded px-1 py-2 text-left text-sm text-ink transition-colors hover:bg-surface-hover"
                    >
                      <Menu size={14} className="shrink-0 text-ink-faint" />
                      <span className="truncate">{turn.content}</span>
                    </button>
                  </li>
                ))}
            </ul>
          )}
          {asked.length > 0 && (
            <button
              type="button"
              onClick={() => {
                clear()
                onBack()
              }}
              className="mt-2 text-xs font-medium text-accent hover:underline"
            >
              Clear history
            </button>
          )}
        </section>

        <hr className="my-4 border-line" />

        <section>
          <h3 className="text-sm font-medium text-ink">Suggestions</h3>
          <ul className="mt-2 flex flex-col">
            {AI_SHORTCUT_ORDER.map((mode) => (
              <li key={mode}>
                <button
                  type="button"
                  onClick={() => onPick(mode)}
                  className="flex w-full items-center justify-between gap-2 rounded px-1 py-2 text-left text-sm text-ink transition-colors hover:bg-surface-hover"
                >
                  <span className="flex items-center gap-2">
                    <SparkIcon size={14} className="shrink-0 text-accent" />
                    {AI_MODE_LABELS[mode]}
                  </span>
                  <kbd className="shrink-0 rounded border border-line bg-surface-backdrop px-1.5 py-0.5 font-ui text-[11px] text-ink-faint">
                    {AI_SHORTCUT_KEYS[mode]}
                  </kbd>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <hr className="my-4 border-line" />

        <p className="text-xs text-ink-faint">
          The assistant works from your class notes. It can make mistakes —
          check anything important.
        </p>
      </div>
    </div>
  )
}

export function AiSidebar({ onMoveToDock }: AiSidebarProps) {
  const { session } = useAuth()
  const { openSource, sourceError, clearSourceError } = useOpenSource()
  const actions = useProposedActions()
  const {
    turns,
    busy,
    error,
    revising,
    selection,
    ask,
    startAction,
    clear,
    dismissTurn,
    apply,
    applyIssueFix,
    classId,
  } = useAiConversation()

  const [question, setQuestion] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const transcriptRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight })
  }, [turns, busy])

  function handleAsk(event: FormEvent) {
    event.preventDefault()
    const asked = question.trim()
    if (!asked || busy) return
    setQuestion('')
    ask(asked)
  }

  /*
   * The assistant reads your class notes from the database, so it needs an
   * account. Saying so up front beats letting a guest press the actions and
   * collect a generic failure they can only respond to by trying again.
   */
  if (!session) {
    return (
      <div className="p-4">
        <p className="text-sm text-ink">Sign in to use the AI assistant.</p>
        <p className="mt-2 text-sm text-ink-muted">
          It works from your class notes, which live in your account. Your notes
          on this device come with you when you sign up.
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
    )
  }

  if (menuOpen) {
    return (
      <MenuView
        onBack={() => setMenuOpen(false)}
        onPick={(mode) => {
          setMenuOpen(false)
          startAction(mode, selection)
        }}
      />
    )
  }

  return (
    // Marked so the move between here and the docked bar animates this
    // surface rather than the whole panel column. An attribute, not an id:
    // the panel is mounted twice -- docked and in the drawer -- and only one
    // of them is on screen.
    <div data-ai-surface="panel" className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 px-2 py-2">
        <IconButton label="Menu" onClick={() => setMenuOpen(true)}>
          <Menu size={18} />
        </IconButton>
        <span className="ml-1 flex-1 text-sm font-medium text-ink">Assistant</span>
        <IconButton label="New conversation" onClick={clear}>
          <SquarePen size={17} />
        </IconButton>
        {onMoveToDock && (
          <IconButton label="Switch to bar under the page" onClick={onMoveToDock}>
            <PanelBottom size={17} />
          </IconButton>
        )}
      </div>

      <div ref={transcriptRef} className="flex-1 overflow-y-auto px-4 pb-4">
        {turns.length === 0 && !busy && (
          <>
            <p className="text-sm text-ink-muted">What would you like help with?</p>
            <div className="mt-3 flex flex-col gap-1.5">
              {AI_SHORTCUT_ORDER.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => startAction(mode, selection)}
                  className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2 text-left text-sm text-ink transition-colors hover:border-line-strong hover:bg-surface-hover"
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
              // Set as a chip on the right, so a glance down the column reads
              // as a conversation rather than as undifferentiated prose.
              <p
                key={turn.id}
                className="ml-auto max-w-[85%] rounded-2xl bg-accent-subtle px-3 py-2 text-sm text-ink"
              >
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
                // The target this suggestion was generated against, not the
                // live selection. Between the model answering and this button
                // being pressed the student may have clicked anywhere at all,
                // and the suggestion still means the words it was made about.
                onApply={(content) =>
                  void apply(content, turn.target ?? { text: turn.original ?? '' })
                }
                onReject={() => dismissTurn(turn.id)}
                onFixIssue={(issue) => applyIssueFix(issue, turn.target)}
                onDismissIssue={() => undefined}
                onOpenSource={openSource}
                historical={turn.historical}
                onRunAction={(action) => actions.run(action, classId)}
                runningAction={actions.running}
              />
            ) : (
              <div key={turn.id} className="flex gap-2">
                <SparkIcon size={15} className="mt-0.5 shrink-0 text-accent" />
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
                  {turn.content}
                </p>
              </div>
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

        {/* The note the assistant just made, offered as somewhere to go
            rather than navigated to. Being moved out of a conversation you
            were in the middle of is worse than a link. */}
        {actions.created && (
          <div
            role="status"
            className="mt-4 rounded border border-accent/40 bg-accent/5 p-3 text-sm"
          >
            <p className="text-ink">
              Created <span className="font-medium">{actions.created.title}</span>.
            </p>
            <div className="mt-2 flex items-center gap-3">
              <Link
                to={actions.created.href}
                onClick={actions.dismissCreated}
                className="font-medium text-accent hover:underline"
              >
                Open it
              </Link>
              <button
                type="button"
                onClick={actions.dismissCreated}
                className="text-ink-muted hover:underline"
              >
                Stay here
              </button>
            </div>
          </div>
        )}

        {actions.error && (
          <p role="alert" className="mt-4 flex items-start gap-2 text-sm text-red-600">
            <span className="flex-1">{actions.error}</span>
            <button
              type="button"
              onClick={actions.dismissError}
              className="shrink-0 underline underline-offset-2"
            >
              Dismiss
            </button>
          </p>
        )}

        {/* A citation that resolves to nothing. Shown rather than swallowed:
            the whole value of citing a note is that it can be checked, so
            "that note is not there" is the one answer worth interrupting for. */}
        {sourceError && (
          <p role="alert" className="mt-4 flex items-start gap-2 text-sm text-red-600">
            <span className="flex-1">{sourceError}</span>
            <button
              type="button"
              onClick={clearSourceError}
              className="shrink-0 underline underline-offset-2"
            >
              Dismiss
            </button>
          </p>
        )}
      </div>

      <form onSubmit={handleAsk} className="shrink-0 p-3">
        <div className="rounded-2xl border border-line-strong bg-surface px-3 py-2 focus-within:border-accent">
          <label htmlFor="ai-question" className="sr-only">
            Ask the AI assistant
          </label>
          <textarea
            id="ai-question"
            rows={1}
            value={question}
            // The box does something different while a decline is pending, so
            // it says so rather than leaving the student to discover it.
            placeholder={revising ? 'What should I change?' : 'Ask the assistant'}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends; Shift+Enter is a newline, matching chat conventions.
              if (event.key === 'Enter' && !event.shiftKey) handleAsk(event)
            }}
            className="min-h-[30px] w-full resize-none bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
          />
          <div className="flex items-center gap-1">
            <button
              type="button"
              title="Attach"
              aria-label="Attach"
              className="grid h-7 w-7 place-items-center rounded-full text-docs-icon transition-colors hover:bg-docs-chrome-hover"
            >
              <Plus size={16} />
            </button>
            <button
              type="button"
              title="Suggestions"
              aria-label="Suggestions"
              onClick={() => setMenuOpen(true)}
              className="grid h-7 w-7 place-items-center rounded-full text-docs-icon transition-colors hover:bg-docs-chrome-hover"
            >
              <SlidersHorizontal size={15} />
            </button>
            <button
              type="submit"
              disabled={!question.trim() || busy}
              aria-label="Send"
              title="Send"
              className={cn(
                'ml-auto grid h-7 w-7 place-items-center rounded-full transition-colors',
                question.trim() && !busy
                  ? 'bg-accent text-white hover:bg-accent-hover'
                  : 'bg-surface-hover text-ink-faint',
              )}
            >
              <ArrowUp size={15} />
            </button>
          </div>
        </div>
        <p className="mt-2 text-center text-[11px] text-ink-faint">
          The assistant can make mistakes — check anything important.
        </p>
      </form>
    </div>
  )
}
