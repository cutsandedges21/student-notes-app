import type { AiIssue, AiProposedAction, AiResponse, AiSource } from '../types/ai'

/**
 * Making an assistant response safe to render.
 *
 * The response crosses a network boundary, and the thing on the other side is
 * not guaranteed to be the version this build expects. It was cast --
 * `data as AiResponse` -- which is a promise the compiler cannot keep and did
 * not: adding `sources` and `proposed_actions` to the type made every reply
 * from an edge function that had not been redeployed a crash, because the card
 * reads `result.sources.length` and an older server does not send the field.
 *
 * A blank screen, for a deployment step. That is what a cast at a boundary
 * buys.
 *
 * So: fill what is missing, drop what is malformed, and never throw. A reply
 * that is short a field is still an answer worth showing; only a reply with no
 * prose in it is not an answer at all.
 *
 * The same function reads stored transcripts, which have the same problem for
 * the same reason -- rows written before a field existed.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback

/** Issues drive an Apply button, so a malformed one is dropped, not repaired. */
function issues(value: unknown): AiIssue[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((entry) => {
    if (!isRecord(entry)) return []
    const original = str(entry.original)
    const correction = str(entry.correction)
    if (!original) return []

    const confidence = entry.confidence
    return [
      {
        original,
        problem: str(entry.problem),
        correction,
        // Anything outside the three the card knows about becomes the most
        // cautious of them, rather than falling through to a generic label
        // that would assert a confidence the model never expressed.
        confidence:
          confidence === 'high' || confidence === 'medium' || confidence === 'low'
            ? confidence
            : 'low',
      },
    ]
  })
}

/** A citation the UI turns into a link, so an id that is not one is dropped. */
function sources(value: unknown): AiSource[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((entry) => {
    if (!isRecord(entry)) return []
    const documentId = str(entry.documentId)
    const title = str(entry.title)
    if (!documentId || !title) return []
    return [{ documentId, title, className: str(entry.className) }]
  })
}

/** An offer with no content is not an offer. */
function proposedActions(value: unknown): AiProposedAction[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((entry) => {
    if (!isRecord(entry) || entry.kind !== 'create_note') return []
    const title = str(entry.title)
    const content = str(entry.content)
    if (!title || !content) return []
    return [{ kind: 'create_note' as const, title, content, reason: str(entry.reason) }]
  })
}

/**
 * Returns a renderable response, or null when there is no answer in it.
 *
 * Null rather than a half-populated object: prose is the one field every mode
 * fills, and a reply without it is an upstream failure the student should be
 * told about rather than an empty card.
 */
export function normaliseAiResponse(value: unknown, mode: string): AiResponse | null {
  if (!isRecord(value)) return null

  const response = str(value.response)
  if (!response.trim()) return null

  const proposed = str(value.proposed_content)

  return {
    mode: (str(value.mode, mode) || mode) as AiResponse['mode'],
    response,
    // Whitespace-only is not a proposal; normalising it here means the card's
    // `if (proposed_content)` cannot be fooled by " ".
    proposed_content: proposed.trim() ? proposed : null,
    issues: issues(value.issues),
    added_information: Array.isArray(value.added_information)
      ? value.added_information.filter((entry): entry is string => typeof entry === 'string')
      : [],
    sources: sources(value.sources),
    proposed_actions: proposedActions(value.proposed_actions),
  }
}
