import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
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
import { describeSelectionNeeded } from '../lib/shortcuts'
import type { ApplyResult, SuggestionTarget } from '../editor/applySuggestion'

/**
 * One conversation, wherever it is being shown.
 *
 * The assistant now has two homes -- a bar docked under the page and a column
 * beside it -- and the student moves between them mid-thought. Holding the
 * transcript in whichever component happens to be mounted would mean a
 * conversation that resets when it is moved, and two half-conversations when
 * both surfaces exist at once. It lives here instead, and the surfaces are
 * views onto it.
 *
 * That also retires the `active` flag the panels used to carry. Two copies of
 * the panel were mounted at all times -- one per breakpoint -- and each ran the
 * pending-action effect, so every shortcut fired twice unless exactly one copy
 * was told it was the real one. The effect runs once here, so there is nothing
 * left to deduplicate.
 */

export interface AiSelection {
  text: string
  from: number
  to: number
}

export interface Turn {
  id: string
  role: 'user' | 'assistant'
  /** Prose shown in the transcript. */
  content: string
  /** Present when the assistant proposed an edit. */
  result?: AiResponse
  /** The text the suggestion would replace. */
  original?: string
  /**
   * Where in the note this suggestion belongs, captured the moment it was
   * generated and kept for as long as the suggestion is on offer.
   *
   * This is the whole point of holding a transcript rather than a single live
   * answer: the student can click away, scroll, or keep typing while the model
   * thinks, so the live selection at the moment Apply is pressed says nothing
   * about what the suggestion was for.
   */
  target?: SuggestionTarget
}

export interface AiConversation {
  turns: Turn[]
  busy: boolean
  error: string | null
  /** True while the panel is waiting to hear what was wrong with a rewrite. */
  revising: boolean
  /** Sends a message: a revision if one is pending, an ordinary question if not. */
  ask: (text: string) => void
  /** Runs one of the suggested actions against a selection. */
  startAction: (mode: AiActionMode, target: AiSelection | null) => void
  /** Empties the transcript, for "new conversation". */
  clear: () => void
  dismissTurn: (id: string) => void
  /**
   * Sends a suggestion to the document, surfacing why if it could not be
   * placed. Every apply goes through here, so a refusal becomes something the
   * student can see rather than a dead button.
   */
  apply: (content: string, target: SuggestionTarget) => Promise<void>
  applyIssueFix: (issue: AiIssue, scope?: SuggestionTarget) => void
  /** The live selection, so a surface can say whether actions have something to work on. */
  selection: AiSelection | null
}

const Context = createContext<AiConversation | null>(null)

export function useAiConversation(): AiConversation {
  const value = useContext(Context)
  if (!value) {
    throw new Error('useAiConversation must be used inside an AiConversationProvider')
  }
  return value
}

const newId = () => crypto.randomUUID()

interface ProviderProps {
  documentId: string
  classId: string
  selection: AiSelection | null
  onApply: (
    content: string,
    target: SuggestionTarget,
  ) => Promise<ApplyResult | void> | ApplyResult | void
  onPreview: (
    content: string,
    target: AiSelection,
    outcome: {
      onAccept: () => void
      onDecline: () => void
      onRefused: (message: string) => void
    },
  ) => void
  pendingMode: { mode: AiMode; selection: AiSelection | null } | null
  onPendingHandled: () => void
  /** Opens whichever surface is showing the assistant, so an answer is not sent into the void. */
  onActivity?: () => void
  children: ReactNode
}

export function AiConversationProvider({
  documentId,
  classId,
  selection,
  onApply,
  onPreview,
  pendingMode,
  onPendingHandled,
  onActivity,
  children,
}: ProviderProps) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /*
   * Set when a suggestion was declined in the document. The next thing typed
   * is then treated as "what was wrong with it" and re-runs that same action on
   * that same text, rather than starting an unrelated chat.
   */
  const [revising, setRevising] = useState<{
    mode: AiActionMode
    target: AiSelection
  } | null>(null)

  // Read through refs by the callbacks below, which are stable so that a
  // surface re-rendering on every keystroke does not rebuild them.
  const turnsRef = useRef(turns)
  turnsRef.current = turns
  const busyRef = useRef(busy)
  busyRef.current = busy
  const revisingRef = useRef(revising)
  revisingRef.current = revising

  const run = useCallback(
    async (
      label: string,
      call: () => Promise<AiResponse>,
      original?: string,
      target?: AiSelection | null,
      mode?: AiActionMode,
    ) => {
      setError(null)
      setBusy(true)
      setTurns((current) => [...current, { id: newId(), role: 'user', content: label }])

      try {
        const result = await call()
        setTurns((current) => [
          ...current,
          {
            id: newId(),
            role: 'assistant',
            content: result.response,
            result,
            original,
            target: target ?? undefined,
          },
        ])

        // A rewrite is shown in the note, next to the words it would replace.
        // Modes that only explain or answer have nothing to put there.
        if (result.proposed_content && target && mode) {
          onPreview(result.proposed_content, target, {
            onAccept: () => {
              setTurns([])
              setError(null)
              setRevising(null)
            },
            onDecline: () => {
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
            onRefused: (message) => setError(message),
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
    },
    [onPreview],
  )

  /**
   * The one path every suggested action takes, whether it came from a button in
   * a panel, the floating toolbar, or a keyboard shortcut.
   *
   * With nothing highlighted it asks which part of the notes to work on instead
   * of running. These modes rewrite the student's own words, so acting on a
   * guess -- the whole document, or wherever the caret happens to sit --
   * produces an edit nobody asked for.
   */
  const startAction = useCallback(
    (mode: AiActionMode, target: AiSelection | null) => {
      const action = AI_ACTIONS.find((entry) => entry.mode === mode)
      if (!action) return

      onActivity?.()

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
    },
    [classId, documentId, onActivity, run],
  )

  const ask = useCallback(
    (text: string) => {
      const asked = text.trim()
      if (!asked || busyRef.current) return

      onActivity?.()

      /*
       * A declined suggestion turns the next message into a revision: the same
       * action, on the same words, with what the student disliked passed along.
       * Routing it to CHAT instead would answer the complaint in prose and
       * leave the note untouched, which is not what "decline and say why" asks
       * for.
       */
      const pending = revisingRef.current
      if (pending) {
        const action = AI_ACTIONS.find((entry) => entry.mode === pending.mode)
        setRevising(null)
        if (action) {
          void run(
            asked,
            () =>
              action.run(
                { documentId, classId, selectedText: pending.target.text },
                asked,
              ),
            pending.target.text,
            pending.target,
            pending.mode,
          )
          return
        }
      }

      const history = turnsRef.current
        .slice(-6)
        .map((turn) => ({ role: turn.role, content: turn.content }))
      /*
       * The selection travels with the answer. A chat reply can propose an
       * edit too, and it means the words highlighted when the question was
       * asked -- not whatever is highlighted by the time the reply lands.
       */
      void run(
        asked,
        () =>
          AIService.chat({ documentId, classId, selectedText: selection?.text }, asked, history),
        undefined,
        selection,
      )
    },
    [classId, documentId, onActivity, run, selection],
  )

  // An action fired from the document: the floating selection toolbar, or a
  // Ctrl+Alt shortcut.
  useEffect(() => {
    if (!pendingMode || busy) return

    const { mode, selection: target } = pendingMode
    onPendingHandled()

    // CHAT has no suggested-action button; it just opens the assistant so the
    // question box can be used against the selection.
    if (mode === 'CHAT') {
      onActivity?.()
      return
    }
    startAction(mode, target)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingMode])

  const apply = useCallback(
    async (content: string, target: SuggestionTarget) => {
      setError(null)
      const result = await onApply(content, target)
      if (result && result.status === 'refused') setError(result.message)
    },
    [onApply],
  )

  /**
   * Replaces the wording an issue quoted with its correction.
   *
   * The issue quotes the student's own words, so those words are the anchor --
   * it does not need, and must not use, whatever happens to be selected.
   *
   * `scope` is the selection the check was run against, so a phrase that also
   * appears elsewhere in the note still resolves inside the passage it was
   * flagged in rather than being refused as ambiguous.
   */
  const applyIssueFix = useCallback(
    (issue: AiIssue, scope?: SuggestionTarget) => {
      void apply(issue.correction, {
        text: issue.original,
        scope:
          scope?.from !== undefined && scope.to !== undefined
            ? { from: scope.from, to: scope.to }
            : undefined,
      })
    },
    [apply],
  )

  const value = useMemo<AiConversation>(
    () => ({
      turns,
      busy,
      error,
      revising: revising !== null,
      ask,
      startAction,
      clear: () => {
        setTurns([])
        setError(null)
        setRevising(null)
      },
      dismissTurn: (id) => setTurns((current) => current.filter((turn) => turn.id !== id)),
      apply,
      applyIssueFix,
      selection,
    }),
    [turns, busy, error, revising, ask, startAction, apply, applyIssueFix, selection],
  )

  return <Context.Provider value={value}>{children}</Context.Provider>
}
