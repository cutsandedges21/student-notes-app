import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUp, Check, Copy, PanelRight, Plus, SlidersHorizontal } from 'lucide-react'
import { SparkIcon } from '../editor/DocsIcons'
import { useAiConversation } from './AiConversation'
import { cn } from '../lib/cn'

/**
 * The assistant, docked under the page.
 *
 * Collapsed it is a small pill that never leaves, so the assistant is always
 * one glance away without a column of chrome standing between the writer and
 * the paper. Hovering opens it into a question box; moving away closes it
 * again. Clicking is what makes it stay -- a pointer crossing the pill on its
 * way somewhere else should not leave a bar open behind it, and a bar that
 * vanished mid-sentence because the pointer drifted would be worse.
 *
 * The last answer is shown above the box rather than only in the panel: a
 * reply with nowhere to go reads as nothing having happened. Anything longer
 * than a reply belongs in the column, which is what the side-panel button is
 * for.
 */

/**
 * Grace period before an un-pinned bar closes.
 *
 * The pointer leaves the bar constantly on its way between the two ends of it,
 * and closing on the first `mouseleave` made the control feel like it was
 * fleeing the cursor.
 */
const CLOSE_DELAY_MS = 260

/**
 * How long the copy button stays acknowledged before returning to its resting
 * label.
 *
 * Copying to the clipboard produces no visible effect anywhere on screen, so
 * without an acknowledgement the only way to find out whether the click landed
 * is to go and paste it somewhere. Long enough to be read, short enough that
 * the button is honest about its state again before the next answer arrives.
 */
const COPIED_FEEDBACK_MS = 2_000

interface AiDockProps {
  /** Moves the assistant into the side panel and takes this away. */
  onMoveToPanel: () => void
}

export function AiDock({ onMoveToPanel }: AiDockProps) {
  const { turns, busy, error, revising, ask } = useAiConversation()
  const [open, setOpen] = useState(false)
  /** Open because it was asked for, rather than because a pointer is over it. */
  const [pinned, setPinned] = useState(false)
  const [question, setQuestion] = useState('')
  /** The outcome of the last copy, and which answer it was about. */
  const [copied, setCopied] = useState<{ id: string; state: 'copied' | 'failed' } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const closeTimer = useRef<number | null>(null)
  const copyTimer = useRef<number | null>(null)
  /*
   * Centred on the sheet rather than on the window.
   *
   * The page is not in the middle of the screen -- the side panel takes a
   * column off one edge, and the sheet slides over to make room. Centring on
   * the viewport therefore puts the bar visibly off-centre from the thing it
   * is about, and moves it every time the panel opens.
   */
  const [centre, setCentre] = useState<number | null>(null)

  useEffect(() => {
    const measure = () => {
      // Re-queried each time: the sheet is remounted by pagination, so a node
      // captured once goes stale.
      const sheet =
        document.querySelector('[data-page-backdrop]') ?? document.querySelector('.doc-content')
      if (!sheet) return
      const rect = sheet.getBoundingClientRect()
      if (rect.width > 0) setCentre(rect.left + rect.width / 2)
    }

    measure()

    // The body covers the panel opening and the window resizing at once: both
    // reflow the sheet, and neither fires a scroll or resize on it directly.
    const observer = new ResizeObserver(measure)
    observer.observe(document.body)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }

  useEffect(() => cancelClose, [])

  // A question in flight, or an answer to read, holds the bar open however the
  // pointer moves -- the reply is the whole reason it was opened.
  const held = pinned || busy || revising

  function handleEnter() {
    cancelClose()
    setOpen(true)
  }

  function handleLeave() {
    if (held) return
    cancelClose()
    closeTimer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY_MS)
  }

  function pin() {
    cancelClose()
    setOpen(true)
    setPinned(true)
    // After the input exists, or there is nothing to focus yet.
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  // Clicking away or pressing Escape releases it, the same contract every other
  // transient surface in the app follows.
  useEffect(() => {
    if (!pinned) return

    function onPointerDown(event: MouseEvent) {
      const root = document.getElementById('ai-dock')
      if (!root?.contains(event.target as Node)) {
        setPinned(false)
        setOpen(false)
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setPinned(false)
      setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [pinned])

  function submit(event: FormEvent) {
    event.preventDefault()
    const asked = question.trim()
    if (!asked || busy) return
    setQuestion('')
    setPinned(true)
    ask(asked)
  }

  const lastAnswer = [...turns].reverse().find((turn) => turn.role === 'assistant')

  /*
   * The acknowledgement is tied to the message it is about, and read back by
   * comparing ids rather than cleared when the message changes.
   *
   * "Copied" is a claim about the text under the button, and that text changes
   * without the button being touched -- a reply landing inside the
   * acknowledgement window would otherwise inherit a tick for something that is
   * not on the clipboard. Deriving it here means the stale state cannot be
   * rendered even for the one frame an effect would take to clear it.
   */
  const copyState = copied && lastAnswer && copied.id === lastAnswer.id ? copied.state : 'idle'

  useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current)
    },
    [],
  )

  /**
   * Puts the whole answer on the clipboard.
   *
   * The whole answer, not the selection: the card scrolls, so dragging across
   * a long reply means dragging against an auto-scrolling box, and the point of
   * the button is to make that unnecessary.
   */
  async function copyAnswer() {
    const answer = lastAnswer
    if (!answer?.content) return

    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current)
    try {
      await navigator.clipboard.writeText(answer.content)
      setCopied({ id: answer.id, state: 'copied' })
    } catch (caught) {
      // Denied permission, or an insecure origin. Either way the clipboard was
      // not written, and saying so beats a tick that lies about it.
      console.error('[AiDock] could not copy the answer:', caught)
      setCopied({ id: answer.id, state: 'failed' })
    }
    copyTimer.current = window.setTimeout(() => setCopied(null), COPIED_FEEDBACK_MS)
  }

  return createPortal(
    <div
      id="ai-dock"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      // Falls back to the middle of the window until the sheet has been
      // measured, so the bar is never rendered somewhere arbitrary first.
      style={centre === null ? undefined : { left: `${Math.round(centre)}px` }}
      className={cn(
        'pointer-events-none fixed bottom-6 z-40 flex -translate-x-1/2 flex-col items-center gap-2',
        centre === null && 'left-1/2',
      )}
    >
      {/*
        The reply, and only while the bar is open. Left up after the bar closed
        it would be a card floating over the page with nothing holding it there.
      */}
      {open && (lastAnswer || error) && (
        <div className="motion-rise pointer-events-auto max-h-56 w-[min(90vw,640px)] overflow-y-auto rounded-2xl border border-line bg-surface p-4 shadow-sheet">
          {error ? (
            <p className="text-sm text-danger">{error}</p>
          ) : (
            <div className="flex gap-3">
              <SparkIcon size={16} className="mt-0.5 shrink-0 text-accent" />
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
                {lastAnswer?.content}
              </p>
            </div>
          )}
          <div className="mt-3 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onMoveToPanel}
              className="text-xs font-medium text-accent hover:underline"
            >
              Open in side panel
            </button>
            {/* Nothing to copy when the card is showing an error rather than
                an answer. */}
            {!error && lastAnswer && (
              <button
                type="button"
                onClick={copyAnswer}
                title="Copy the whole answer"
                // The label carries the outcome, so a screen reader hears the
                // same acknowledgement the tick gives everyone else.
                aria-label={
                  copyState === 'copied'
                    ? 'Answer copied'
                    : copyState === 'failed'
                      ? 'Could not copy the answer'
                      : 'Copy the whole answer'
                }
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
                  'transition-colors hover:bg-docs-chrome-hover',
                  copyState === 'failed' ? 'text-danger' : 'text-docs-icon',
                )}
              >
                {copyState === 'copied' ? <Check size={14} /> : <Copy size={14} />}
                {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy'}
              </button>
            )}
          </div>
        </div>
      )}

      {open ? (
        <form
          onSubmit={submit}
          className={cn(
            'ai-dock-bar motion-pop pointer-events-auto flex w-[min(90vw,640px)] items-center gap-2',
            // No focus ring: this is a bar the writer is meant to talk into,
            // and outlining it on click made it read as a form field with a
            // validation state.
            'rounded-full border border-line bg-surface py-2 pl-3 pr-2 shadow-sheet',
          )}
        >
          <button
            type="button"
            title="Attach"
            aria-label="Attach"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-docs-icon transition-colors hover:bg-docs-chrome-hover"
          >
            <Plus size={18} />
          </button>
          {/* Present because the bar is shaped around it, but deliberately
              inert until there is something for it to open. */}
          <button
            type="button"
            title="Suggestions"
            aria-label="Suggestions"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-docs-icon transition-colors hover:bg-docs-chrome-hover"
          >
            <SlidersHorizontal size={17} />
          </button>

          <input
            ref={inputRef}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onFocus={pin}
            aria-label="Ask the assistant"
            placeholder={
              revising ? 'What should I change?' : 'Describe any changes that you want to make…'
            }
            className="ai-dock-field min-w-0 flex-1 bg-transparent px-1 text-sm text-ink outline-none placeholder:text-ink-faint"
          />

          <button
            type="button"
            onClick={onMoveToPanel}
            title="Switch to side panel"
            aria-label="Switch to side panel"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-docs-icon transition-colors hover:bg-docs-chrome-hover"
          >
            <PanelRight size={17} className="rotate-180" />
          </button>
          <button
            type="submit"
            disabled={!question.trim() || busy}
            title="Send"
            aria-label="Send"
            className={cn(
              'grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors',
              question.trim() && !busy
                ? 'bg-accent text-accent-on hover:bg-accent-hover'
                : 'bg-surface-hover text-ink-faint',
            )}
          >
            <ArrowUp size={17} />
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={pin}
          title="AI assistant"
          aria-label="AI assistant"
          aria-expanded={false}
          className={cn(
            'motion-pop motion-press pointer-events-auto grid h-9 w-28 place-items-center',
            'rounded-full bg-accent-subtle shadow-pill transition-[background-color,box-shadow,transform]',
            'hover:bg-docs-active hover:shadow-sheet',
          )}
        >
          <SparkIcon size={18} />
        </button>
      )}
    </div>,
    document.body,
  )
}
