/**
 * The AI contract, as the browser sees it.
 *
 * This file used to claim it was "imported by both the browser client and the
 * Supabase Edge Function so the shapes cannot drift apart". It was not: the
 * function has always declared its own modes and its own validation, and
 * nothing in supabase/functions imports this file. The comment described an
 * intention, and reading it as fact is how the two sides came to disagree
 * about `confidence` -- typed as a three-value union here, unchecked there.
 *
 * They are separate on purpose. The function runs on Deno and validates model
 * output with Zod (supabase/functions/ai-assist/validate.ts); that is the
 * security boundary and the authority on the wire format. What lives here is
 * the browser's view of the same contract, and the two are kept in step by
 * tests on both sides rather than by a shared import that does not exist.
 *
 * Nothing here may import browser or Deno APIs.
 */

export const AI_MODES = [
  'IMPROVE_NOTES',
  'CHECK_NOTES',
  'EXPLAIN',
  'MAKE_CLEARER',
  'EXAM_READY',
  'CHAT',
] as const

export type AiMode = (typeof AI_MODES)[number]

/** Confidence the model attaches to a flagged issue. */
export type IssueConfidence = 'high' | 'medium' | 'low'

export interface AiIssue {
  /** The student's own wording, quoted back so the card can show it. */
  original: string
  problem: string
  correction: string
  confidence: IssueConfidence
}

/**
 * The structured response every mode returns.
 *
 * Not every field is populated for every mode -- CHECK_NOTES fills `issues`
 * and leaves `proposed_content` null; IMPROVE_NOTES does the reverse. The UI
 * branches on the mode rather than sniffing which fields happen to be present.
 */
export interface AiResponse {
  mode: AiMode
  /** Prose addressed to the student. Never the note replacement itself. */
  response: string
  /** Suggested note text, when the mode proposes an edit. */
  proposed_content: string | null
  issues: AiIssue[]
  /** Claims the model contributed beyond what the notes contained. */
  added_information: string[]
  /**
   * The student's own notes the answer drew on.
   *
   * Populated only when the assistant actually read them, which means only
   * when it called a tool. The card turns each into a link, so an answer can
   * be checked against the note it came from.
   */
  sources: AiSource[]
}

export interface AiSource {
  documentId: string
  title: string
  className: string
}

export interface AiConversationTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface AiRequest {
  mode: AiMode
  documentId: string
  classId: string
  /** Text the student highlighted, when the action came from a selection. */
  selectedText?: string
  /** Free-text question, used by CHAT and to steer the other modes. */
  userRequest?: string
  conversation?: AiConversationTurn[]
}

/** Error codes the function returns; the UI maps these to friendly copy. */
export type AiErrorCode =
  | 'RATE_LIMIT'
  /** The daily allowance is spent; unlike RATE_LIMIT, waiting a minute won't help. */
  | 'QUOTA_EXCEEDED'
  | 'TIMEOUT'
  | 'INVALID_RESPONSE'
  | 'UPSTREAM_ERROR'
  | 'UNAUTHORIZED'
  | 'NOT_CONFIGURED'
  | 'BAD_REQUEST'
  /** The note or class no longer exists, or is not the caller's. */
  | 'NOT_FOUND'
  /** The request body exceeded the endpoint's cap. */
  | 'PAYLOAD_TOO_LARGE'
  /**
   * The calling origin is not on the endpoint's allowlist.
   *
   * A deployment problem rather than anything the student did, so the copy
   * says so instead of implying they can retry their way out of it.
   */
  | 'FORBIDDEN_ORIGIN'

export interface AiErrorBody {
  error: AiErrorCode
}

export class AiRequestError extends Error {
  // Declared explicitly rather than as a constructor parameter property:
  // the project builds with `erasableSyntaxOnly`, which disallows the shorthand.
  readonly code: AiErrorCode

  constructor(code: AiErrorCode) {
    super(code)
    this.name = 'AiRequestError'
    this.code = code
  }
}

/**
 * User-facing copy. Raw upstream errors are never surfaced -- they leak
 * implementation detail and mean nothing to a student mid-lecture.
 */
export function describeAiError(code: AiErrorCode): string {
  switch (code) {
    case 'RATE_LIMIT':
      return "That's a lot of requests in a short time. Give it a minute and try again."
    case 'QUOTA_EXCEEDED':
      return "You've used up today's AI requests. They reset tomorrow."
    case 'NOT_CONFIGURED':
      return 'The AI assistant is not set up for this deployment yet.'
    case 'UNAUTHORIZED':
      return 'Sign in to use the AI assistant.'
    case 'TIMEOUT':
      return 'That took too long. Try again, or select a smaller section.'
    case 'NOT_FOUND':
      return "That note isn't available any more. Try reopening it."
    case 'PAYLOAD_TOO_LARGE':
      return 'That selection is too large. Try a smaller section.'
    case 'FORBIDDEN_ORIGIN':
      return 'The AI assistant is not available from this address.'
    default:
      return "The AI couldn't complete that request. Try again."
  }
}

/** Every mode the sidebar offers as a button. CHAT is the free-text box. */
export type AiActionMode = Exclude<AiMode, 'CHAT'>

/**
 * Labels for the sidebar's suggested actions.
 *
 * Phrased as "my notes" throughout: these actions run on the student's own
 * highlighted text, never on the model's general knowledge, and the wording is
 * what sets that expectation before the first click.
 */
export const AI_MODE_LABELS: Record<AiActionMode, string> = {
  IMPROVE_NOTES: 'Improve my notes',
  CHECK_NOTES: 'Check my notes',
  EXPLAIN: 'Explain my notes',
  MAKE_CLEARER: 'Simplify my notes',
  EXAM_READY: 'Examify my notes',
}

/**
 * The verb each mode performs, used to ask for a selection in the mode's own
 * words -- "Which part should I simplify?" beats one generic prompt repeated
 * five times.
 */
export const AI_MODE_VERBS: Record<AiActionMode, string> = {
  IMPROVE_NOTES: 'improve',
  CHECK_NOTES: 'check',
  EXPLAIN: 'explain',
  MAKE_CLEARER: 'simplify',
  EXAM_READY: 'turn into exam-ready notes',
}
