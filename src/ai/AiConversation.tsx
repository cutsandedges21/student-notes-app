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
import { appendTurn, clearConversation, loadConversation } from '../services/conversations'
import { useAuth } from '../contexts/AuthContext'

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
  /**
   * Read back from a previous session rather than produced in this one.
   *
   * A historical turn is readable and inert: it shows what was said, what the
   * model added beyond the notes, and which notes it cited, and it offers to
   * apply nothing. A suggestion is anchored to the document as it stood when
   * it was made, that anchor cannot survive a reload, and an Apply button
   * without one is an offer to paste old text at a guessed location -- the
   * exact failure `editor/applySuggestion.ts` exists to prevent.
   */
  historical?: boolean
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
  /** Stops a request in flight. Nothing to stop when not busy. */
  cancel: () => void
  /** Empties the transcript, for "new conversation". Forgets it on the server too. */
  clear: () => void
  /** True while a stored transcript is being read back. */
  loadingHistory: boolean
  /** Set when the transcript could not be kept, so the panel can say so. */
  historyError: string | null
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
  /** The class the open note belongs to, so an offered note is filed with it. */
  classId: string
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
  /**
   * Something is about to be asked, so the assistant should be visible.
   *
   * Carries why. A named action produces a suggestion with a transcript and
   * buttons behind it, which wants the column; a question typed into the
   * docked bar was a deliberate choice to stay in the bar, and moving the
   * assistant out from under the pointer mid-sentence would be its own bug.
   */
  onActivity?: (reason: 'action' | 'chat') => void
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
  const { user } = useAuth()
  const userId = user?.id ?? null

  const [turns, setTurns] = useState<Turn[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /*
   * The stored transcript for this note, keyed to the note it belongs to.
   *
   * Keyed rather than cleared by an effect for the reason version history and
   * search both landed on: held apart, there is a render where the previous
   * note's conversation sits under the new note's title, and here that is a
   * transcript about a document the student is no longer looking at.
   */
  const [history, setHistory] = useState<{ documentId: string; turns: Turn[] } | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  /** The conversation rows belong to, once known, so it is looked up once. */
  const conversationRef = useRef<string | null>(null)
  /*
   * The request in flight, so it can be stopped.
   *
   * A real abort rather than ignoring the answer: an abandoned request is
   * still generating, still costing, and still counted against the student's
   * quota. Waiting thirty seconds with no way out is bad; paying for the wait
   * you cancelled is worse.
   */
  const inFlightRef = useRef<AbortController | null>(null)

  const restored = history?.documentId === documentId ? history.turns : null
  const loadingHistory = Boolean(userId) && restored === null

  /*
   * Read the stored transcript when the note changes.
   *
   * Restored turns are marked historical, which is what makes them inert: a
   * suggestion's anchor into the document cannot survive a reload, so the
   * answer is readable and offers to apply nothing.
   */
  useEffect(() => {
    if (!userId) {
      setHistory({ documentId, turns: [] })
      return
    }

    let cancelled = false
    conversationRef.current = null

    loadConversation(userId, documentId)
      .then((stored) => {
        if (cancelled) return
        setHistory({
          documentId,
          turns: stored.map((turn) => ({
            id: turn.id,
            role: turn.role,
            content: turn.content,
            result: turn.payload ?? undefined,
            historical: true,
          })),
        })
      })
      .catch((caught) => {
        if (cancelled) return
        console.error('[AiConversation] could not read the transcript:', caught)
        // Not fatal: the assistant still works, it just starts empty. Saying
        // so beats a silently blank panel that looks like nothing was said.
        setHistoryError('Earlier messages could not be loaded.')
        setHistory({ documentId, turns: [] })
      })

    return () => {
      cancelled = true
    }
  }, [userId, documentId])

  /**
   * Writes a turn, without letting a failure to store it break the answer.
   *
   * The transcript on screen is the live one; this is a copy for next time.
   * A student mid-conversation does not need an error about a durability
   * concern they have not thought about, so it is logged and surfaced quietly
   * rather than thrown into the panel.
   */
  const persist = useCallback(
    (turn: { role: 'user' | 'assistant'; content: string; mode: AiMode; payload?: AiResponse | null }) => {
      if (!userId) return

      void appendTurn(userId, documentId, classId, turn, conversationRef.current)
        .then((conversationId) => {
          conversationRef.current = conversationId
          setHistoryError(null)
        })
        .catch((caught) => {
          console.error('[AiConversation] could not keep a turn:', caught)
          setHistoryError('This conversation is not being saved.')
        })
    },
    [userId, documentId, classId],
  )
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
      call: (signal: AbortSignal) => Promise<AiResponse>,
      original?: string,
      target?: AiSelection | null,
      mode?: AiActionMode,
    ) => {
      setError(null)
      setBusy(true)

      // A second request replaces the first rather than racing it.
      inFlightRef.current?.abort()
      const controller = new AbortController()
      inFlightRef.current = controller

      setTurns((current) => [...current, { id: newId(), role: 'user', content: label }])
      persist({ role: 'user', content: label, mode: mode ?? 'CHAT' })

      try {
        const result = await call(controller.signal)
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
        persist({
          role: 'assistant',
          content: result.response,
          mode: mode ?? 'CHAT',
          // The whole validated response: the citations and the added-by-AI
          // list are what somebody reopens a conversation to re-read.
          payload: result,
        })

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
        // Stopping is something the student did on purpose. The prompt still
        // goes, so the transcript does not imply an answer came -- but no
        // error is shown for a thing that worked as asked.
        if (code !== 'CANCELLED') setError(describeAiError(code))
        // Drop the orphaned prompt so the transcript doesn't imply an answer came.
        setTurns((current) => current.slice(0, -1))
      } finally {
        if (inFlightRef.current === controller) inFlightRef.current = null
        setBusy(false)
      }
    },
    [onPreview, persist],
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

      onActivity?.('action')

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
        (signal) => action.run({ documentId, classId, selectedText: target.text }, undefined, signal),
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

      onActivity?.('chat')

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
            (signal) =>
              action.run(
                { documentId, classId, selectedText: pending.target.text },
                asked,
                signal,
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
        (signal) =>
          AIService.chat(
            { documentId, classId, selectedText: selection?.text },
            asked,
            history,
            signal,
          ),
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
      onActivity?.('chat')
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
      turns: restored ? [...restored, ...turns] : turns,
      busy,
      error,
      loadingHistory,
      historyError,
      revising: revising !== null,
      ask,
      startAction,
      cancel: () => {
        inFlightRef.current?.abort()
        inFlightRef.current = null
      },
      clear: () => {
        inFlightRef.current?.abort()
        setTurns([])
        setError(null)
        setRevising(null)
        setHistory({ documentId, turns: [] })
        conversationRef.current = null
        // "New conversation" means stop carrying what was said. Leaving the
        // rows would bring them back on the next reload, which is the
        // opposite of what was asked for.
        void clearConversation(userId, documentId).catch((caught) => {
          console.error('[AiConversation] could not forget the transcript:', caught)
          setHistoryError('Earlier messages could not be deleted.')
        })
      },
      dismissTurn: (id) => setTurns((current) => current.filter((turn) => turn.id !== id)),
      apply,
      applyIssueFix,
      selection,
      classId,
    }),
    [
      turns,
      restored,
      loadingHistory,
      historyError,
      busy,
      error,
      revising,
      ask,
      startAction,
      apply,
      applyIssueFix,
      selection,
      userId,
      documentId,
      classId,
    ],
  )

  return <Context.Provider value={value}>{children}</Context.Provider>
}
