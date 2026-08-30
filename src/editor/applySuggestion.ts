import { closeHistory } from '@tiptap/pm/history'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { Editor } from '@tiptap/core'
import { isInlineSuggestion, markdownToHtml } from '../lib/markdown'

/**
 * Anchored replacement for AI suggestions.
 *
 * Every AI-originated change to the document goes through here. The rule the
 * module exists to enforce is that a suggestion may only ever replace the words
 * it was made about -- so when those words can no longer be located
 * unambiguously it refuses, and says so, rather than falling back to something
 * broader. There is deliberately no whole-document path: replacing the note
 * with a one-sentence correction is not a degraded outcome, it is data loss.
 *
 * Resolution runs in three steps, most trustworthy first:
 *
 *   1. The ProseMirror range captured when the suggestion was generated, but
 *      only if the text sitting at that range is still the text it was
 *      generated against. Positions go stale the moment anything above them is
 *      edited, so an unvalidated range is a loaded gun.
 *   2. A search for the captured text, optionally narrowed to the region the
 *      suggestion was generated about. Exactly one hit is required.
 *   3. Refusal. Zero hits means the words are gone; more than one means we
 *      cannot tell which the student meant. Guessing either way edits text
 *      nobody pointed at.
 */

/**
 * How block boundaries read when a range is flattened to text.
 *
 * A space, matching `DocumentEditor`'s `textBetween(from, to, ' ')`. The
 * separator has to agree with the one used when the target text was captured
 * or a multi-paragraph selection would never match itself.
 */
const BLOCK_SEPARATOR = ' '

export interface SuggestionTarget {
  /** The student's own text the suggestion was generated against. */
  text: string
  /**
   * The range that text occupied when the suggestion was generated. Optional:
   * an issue quoted back by the model has no range of its own, only wording.
   */
  from?: number
  to?: number
  /**
   * Region to search before searching the whole note -- the selection the
   * suggestion was generated about. Lets a quoted fragment resolve inside the
   * paragraph it came from even when the same wording appears elsewhere.
   */
  scope?: { from: number; to: number }
}

export type RefusalReason =
  /** The captured text is nowhere in the document any more. */
  | 'not-found'
  /** It appears more than once, and nothing says which one. */
  | 'ambiguous'
  /** The suggestion arrived without anything to anchor it to. */
  | 'no-anchor'
  /** There is no live editor to write into. */
  | 'no-editor'

export interface ResolvedTarget {
  status: 'resolved'
  from: number
  to: number
  /** Which strategy found it; useful in tests and when diagnosing reports. */
  source: 'range' | 'text'
}

export interface RefusedTarget {
  status: 'refused'
  reason: RefusalReason
  /** How many times the text was found, when that is why we refused. */
  occurrences?: number
}

export type SuggestionResolution = ResolvedTarget | RefusedTarget

export type ApplyResult =
  | { status: 'applied'; from: number; to: number; source: 'range' | 'text' }
  | { status: 'refused'; reason: RefusalReason; message: string }

interface TextIndex {
  /** The document flattened to text, blocks joined by BLOCK_SEPARATOR. */
  text: string
  /** Document position of each character; -1 for an inserted separator. */
  positions: number[]
}

/**
 * Flattens the document to text while remembering where every character came
 * from, so a string match can be turned back into a range.
 *
 * Mirrors ProseMirror's own `textBetween`: a separator is emitted before every
 * textblock except the first, text nodes contribute their characters, and
 * inline leaves (hard breaks, images) contribute nothing while still occupying
 * positions. Because positions are recorded per character rather than derived
 * from block offsets, a match that runs across bold, italic or link marks --
 * separate text nodes in the same paragraph -- resolves to one contiguous
 * range, which is what makes "fix this sentence" work on a formatted sentence.
 */
function buildTextIndex(doc: ProseMirrorNode): TextIndex {
  const characters: string[] = []
  const positions: number[] = []
  let firstBlock = true

  doc.descendants((node, pos) => {
    if (node.isText) {
      const text = node.text ?? ''
      for (let offset = 0; offset < text.length; offset += 1) {
        characters.push(text[offset])
        positions.push(pos + offset)
      }
      return false
    }

    if (node.isTextblock) {
      if (firstBlock) {
        firstBlock = false
      } else {
        characters.push(BLOCK_SEPARATOR)
        positions.push(-1)
      }
    }

    return true
  })

  return { text: characters.join(''), positions }
}

/** The text currently occupying a range, derived exactly as it was captured. */
function textAt(doc: ProseMirrorNode, from: number, to: number): string | null {
  if (!Number.isInteger(from) || !Number.isInteger(to)) return null
  if (from < 0 || to > doc.content.size || from >= to) return null
  return doc.textBetween(from, to, BLOCK_SEPARATOR).trim()
}

function clamp(doc: ProseMirrorNode, range: { from: number; to: number }) {
  return {
    from: Math.max(0, Math.min(range.from, doc.content.size)),
    to: Math.max(0, Math.min(range.to, doc.content.size)),
  }
}

/** Every place `needle` occurs, as document ranges. */
function findOccurrences(
  index: TextIndex,
  needle: string,
  within?: { from: number; to: number },
): { from: number; to: number }[] {
  const found: { from: number; to: number }[] = []
  if (!needle) return found

  let at = index.text.indexOf(needle)
  while (at !== -1) {
    const start = index.positions[at]
    const end = index.positions[at + needle.length - 1]

    // A match whose first or last character is a synthesised block separator
    // has no real position to anchor to. Trimmed targets never start or end
    // with one, so this only guards against a malformed target.
    if (start >= 0 && end >= 0) {
      const range = { from: start, to: end + 1 }
      if (!within || (range.from >= within.from && range.to <= within.to)) found.push(range)
    }

    // Step by one rather than by the needle's length so overlapping
    // occurrences are still counted as two -- they are still ambiguous.
    at = index.text.indexOf(needle, at + 1)
  }

  return found
}

/**
 * Works out which range a suggestion should replace, or why it cannot.
 *
 * Pure: it reads a document and returns a decision, touching nothing.
 */
export function resolveSuggestionTarget(
  doc: ProseMirrorNode,
  target: SuggestionTarget,
): SuggestionResolution {
  const wanted = (target.text ?? '').trim()

  // (a) The captured range, validated. Only trusted while it still covers the
  // very words the model was shown.
  if (wanted && target.from !== undefined && target.to !== undefined) {
    if (textAt(doc, target.from, target.to) === wanted) {
      return { status: 'resolved', from: target.from, to: target.to, source: 'range' }
    }
  }

  if (!wanted) return { status: 'refused', reason: 'no-anchor' }

  const index = buildTextIndex(doc)

  // (b) Inside the region the suggestion was generated about, when we know it.
  // A miss here falls through to the whole note: the scope's positions age the
  // same way any others do, and a stale scope must not hide a good match.
  if (target.scope) {
    const scoped = findOccurrences(index, wanted, clamp(doc, target.scope))
    if (scoped.length === 1) {
      return { status: 'resolved', from: scoped[0].from, to: scoped[0].to, source: 'text' }
    }
    if (scoped.length > 1) {
      return { status: 'refused', reason: 'ambiguous', occurrences: scoped.length }
    }
  }

  const matches = findOccurrences(index, wanted)
  if (matches.length === 0) return { status: 'refused', reason: 'not-found' }
  if (matches.length > 1) {
    return { status: 'refused', reason: 'ambiguous', occurrences: matches.length }
  }

  return { status: 'resolved', from: matches[0].from, to: matches[0].to, source: 'text' }
}

/**
 * What the student is told when a suggestion cannot be placed.
 *
 * Every one of these names the cause and gives the student the one action that
 * resolves it, because "nothing happened" is indistinguishable from a bug.
 */
export function describeRefusal(refusal: RefusedTarget): string {
  switch (refusal.reason) {
    case 'ambiguous':
      return `That text appears ${refusal.occurrences ?? 'more than once'} times in your notes, so I can't tell which one you meant. Highlight the one you want changed and try again.`
    case 'no-anchor':
      return "I've lost track of which part of your notes that suggestion was for. Highlight the text you want changed and run it again."
    case 'no-editor':
      return "Your notes aren't ready yet. Try that again in a moment."
    default:
      return "I couldn't find that text in your notes any more — it may have been edited since. Highlight the text you want changed and try again."
  }
}

/**
 * Writes the suggestion over a range that has already been resolved.
 *
 * One chain, so one transaction, so one Ctrl+Z takes the whole AI edit back
 * out. `closeHistory` opens a fresh undo step first: without it ProseMirror
 * groups transactions that land within half a second of each other, and an
 * edit accepted right after typing would be undone together with the typing.
 */
export function applyResolvedSuggestion(
  editor: Editor,
  content: string,
  range: { from: number; to: number },
): void {
  // A single run of prose replaces exactly the range and inherits the
  // surrounding formatting; anything with block structure has to become nodes.
  const body = isInlineSuggestion(content) ? content : markdownToHtml(content)

  editor
    .chain()
    .command(({ tr }) => {
      closeHistory(tr)
      return true
    })
    .focus()
    .insertContentAt({ from: range.from, to: range.to }, body)
    .run()
}

export interface ApplyOptions {
  /**
   * Runs after the target has been resolved but before anything is written --
   * where the caller snapshots the note. Skipped entirely when the suggestion
   * is going to be refused, so a refusal never leaves a history entry behind.
   */
  beforeApply?: () => Promise<void> | void
}

/**
 * Resolves a suggestion against the live document and applies it, or refuses.
 */
export async function applySuggestion(
  editor: Editor | null,
  content: string,
  target: SuggestionTarget,
  options: ApplyOptions = {},
): Promise<ApplyResult> {
  if (!editor || editor.isDestroyed) {
    return { status: 'refused', reason: 'no-editor', message: describeRefusal({ status: 'refused', reason: 'no-editor' }) }
  }

  const decision = resolveSuggestionTarget(editor.state.doc, target)
  if (decision.status === 'refused') {
    return { status: 'refused', reason: decision.reason, message: describeRefusal(decision) }
  }

  if (options.beforeApply) await options.beforeApply()

  // Resolved a second time on purpose. `beforeApply` can be a round trip to the
  // server, and the student is free to keep typing while it is in flight, so
  // the positions decided a moment ago may no longer point at their words.
  const resolved = resolveSuggestionTarget(editor.state.doc, target)
  if (resolved.status === 'refused') {
    return { status: 'refused', reason: resolved.reason, message: describeRefusal(resolved) }
  }

  applyResolvedSuggestion(editor, content, resolved)

  return { status: 'applied', from: resolved.from, to: resolved.to, source: resolved.source }
}
