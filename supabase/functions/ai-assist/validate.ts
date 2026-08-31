/**
 * Validation of everything crossing a trust boundary.
 *
 * Two boundaries, both untrusted for different reasons: the request comes from
 * a browser we do not control, and the response comes from a language model,
 * which is not adversarial but is not reliable either. `responseSchema` makes
 * malformed output unlikely, not impossible.
 *
 * The previous hand-written check let plenty through. It never looked at
 * `confidence` at all, so `confidence: "banana"` reached the UI and fell
 * through the card's lookup table to a generic label -- a wrong confidence
 * shown as if it were a real one. It also had no size limits, so a model that
 * decided to emit a megabyte of prose would have had it stored and rendered.
 *
 * Zod rather than more hand-written guards: the shapes here have nested arrays
 * and enums, and the failure mode of hand-written validation is exactly what
 * happened -- a field quietly not checked.
 */

// Bare specifier: Deno resolves it via ./deno.json, Vitest via node_modules.
// See deno.json for why this is not an inline npm: specifier.
import { z } from 'zod'

/** Caps. Generous for real use, small enough to bound memory and cost. */
export const LIMITS = {
  /** Whole request body. A note's text is loaded server-side, not sent. */
  requestBytes: 64 * 1024,
  selectedText: 20_000,
  userRequest: 4_000,
  conversationTurns: 12,
  turnContent: 4_000,
  /** Model output, after generation. Anything larger is a runaway. */
  responseChars: 40_000,
  proposedContentChars: 40_000,
  issues: 50,
  addedInformation: 50,
} as const

export const AI_MODES = [
  'IMPROVE_NOTES',
  'CHECK_NOTES',
  'EXPLAIN',
  'MAKE_CLEARER',
  'EXAM_READY',
  'CHAT',
] as const

export const requestSchema = z.object({
  mode: z.enum(AI_MODES),
  documentId: z.string().uuid(),
  classId: z.string().uuid(),
  selectedText: z.string().max(LIMITS.selectedText).optional(),
  userRequest: z.string().max(LIMITS.userRequest).optional(),
  conversation: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(LIMITS.turnContent),
      }),
    )
    .max(LIMITS.conversationTurns)
    .optional()
    .default([]),
})

export type ParsedRequest = z.infer<typeof requestSchema>

/**
 * An issue the model flagged.
 *
 * `confidence` is a real enum here. It drives which wording the card shows, so
 * a value outside the three it knows about is not a cosmetic problem -- it is
 * the UI asserting a confidence the model did not express.
 */
export const issueSchema = z.object({
  original: z.string().min(1).max(LIMITS.proposedContentChars),
  problem: z.string().min(1).max(LIMITS.responseChars),
  correction: z.string().max(LIMITS.proposedContentChars),
  confidence: z.enum(['high', 'medium', 'low']),
})

export const responseSchema = z.object({
  response: z.string().max(LIMITS.responseChars),
  proposed_content: z
    .string()
    .max(LIMITS.proposedContentChars)
    .nullish()
    // Whitespace-only is not a proposal; normalising it to null here means the
    // UI's `if (proposed_content)` check cannot be fooled by " ".
    .transform((value) => (value && value.trim() ? value : null)),
  issues: z.array(issueSchema).max(LIMITS.issues).default([]),
  added_information: z
    .array(z.string().max(LIMITS.responseChars))
    .max(LIMITS.addedInformation)
    .default([]),
})

export type ValidatedResponse = z.infer<typeof responseSchema> & { mode: string }

/**
 * Parses and validates the model's JSON.
 *
 * Returns null rather than throwing or repairing. A response that does not fit
 * the contract is an upstream failure, and the honest thing to show for it is
 * an error the student can retry -- not a half-populated card assembled from
 * whichever fields happened to survive.
 */
export function parseAiResponse(raw: string, mode: string): ValidatedResponse | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  const result = responseSchema.safeParse(parsed)
  if (!result.success) return null

  return { ...result.data, mode }
}
