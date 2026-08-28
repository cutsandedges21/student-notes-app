/**
 * Shared AI contract.
 *
 * Imported by both the browser client and the Supabase Edge Function so the
 * request and response shapes cannot drift apart. Nothing here may import
 * browser or Deno APIs.
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
  | 'TIMEOUT'
  | 'INVALID_RESPONSE'
  | 'UPSTREAM_ERROR'
  | 'UNAUTHORIZED'
  | 'NOT_CONFIGURED'
  | 'BAD_REQUEST'

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
      return 'The AI is temporarily unavailable. Please try again shortly.'
    case 'NOT_CONFIGURED':
      return 'The AI assistant is not set up for this deployment yet.'
    case 'UNAUTHORIZED':
      return 'Sign in to use the AI assistant.'
    case 'TIMEOUT':
      return 'That took too long. Try again, or select a smaller section.'
    default:
      return "The AI couldn't complete that request. Try again."
  }
}

/** Labels for the sidebar's suggested actions. */
export const AI_MODE_LABELS: Record<Exclude<AiMode, 'CHAT'>, string> = {
  IMPROVE_NOTES: 'Improve my notes',
  CHECK_NOTES: 'Check my notes',
  EXPLAIN: 'Explain a concept',
  MAKE_CLEARER: 'Make this clearer',
  EXAM_READY: 'Exam-ready notes',
}
