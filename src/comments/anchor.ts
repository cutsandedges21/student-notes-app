import * as Y from 'yjs'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { toBase64, fromBase64 } from '../collab/encoding'

/**
 * Where a comment is attached.
 *
 * A comment outlives the text around it. People reply to it days later, resolve
 * it, reopen it -- and in the meantime the note is edited, by them and by
 * whoever else has the link. So the hard part of comments is not storing them,
 * it is still knowing what they were about afterwards.
 *
 * Raw ProseMirror positions cannot do that on their own. A position is an
 * offset into a document that no longer exists the moment anyone types above
 * it, and with collaboration two people are typing above it at once. An anchor
 * that is only `{from, to}` points somewhere arbitrary within seconds.
 *
 * So an anchor carries three things, and resolution tries them in order:
 *
 *   1. A Yjs relative position. Yjs relative positions are defined against the
 *      CRDT's own item identifiers rather than an offset, so concurrent edits
 *      move them correctly by construction -- this is the whole reason to do
 *      collaboration before comments rather than after.
 *   2. The quoted text, with a little of the text either side of it. When the
 *      relative position is gone -- the document was replaced wholesale, the
 *      comment predates collaboration, the Y.Doc is not loaded -- the words
 *      themselves are still the best description of what was meant.
 *   3. Nothing. The passage was deleted or rewritten past recognition, and the
 *      honest answer is that the thread is orphaned. It is still shown, still
 *      readable, still resolvable -- it just no longer highlights anything.
 *      Silently dropping it would delete somebody's writing.
 *
 * Anchors are never marks in the document. Nothing here reaches `getJSON()`, so
 * a comment cannot be saved into the note's content, cannot corrupt it, and
 * cannot travel to someone who is not allowed to see it.
 */

/** How much text either side is kept to tell two identical quotes apart. */
const CONTEXT_CHARS = 32

/** Matches DocumentEditor's `textBetween(from, to, ' ')`. */
const BLOCK_SEPARATOR = ' '

export interface CommentAnchor {
  /**
   * Yjs relative positions, base64-encoded. Absent for a comment made without
   * a live Y.Doc, which is why the textual fallback is not optional.
   */
  relativeFrom?: string
  relativeTo?: string
  /** The words the comment is about. Always present. */
  quote: string
  /** Up to CONTEXT_CHARS either side, to disambiguate a repeated quote. */
  prefix: string
  suffix: string
}

export type AnchorResolution =
  | { status: 'resolved'; from: number; to: number; via: 'relative' | 'quote' | 'context' }
  | { status: 'orphaned'; reason: 'not-found' | 'ambiguous' | 'empty-quote' }

/**
 * The ProseMirror ↔ Yjs node mapping, owned by the ySync plugin.
 *
 * Opaque on purpose: this module never needs to look inside it, only to hand
 * it back to the converters that do. Typing it structurally would couple
 * comments to a y-tiptap internal that is free to change.
 */
export type YMapping = Map<unknown, unknown>

export interface YContext {
  ydoc: Y.Doc
  fragment: Y.XmlFragment
  mapping: YMapping
  /** y-tiptap's converters, injected so this module never imports the editor. */
  toRelative: (pos: number, fragment: Y.XmlFragment, mapping: YMapping) => unknown
  toAbsolute: (
    ydoc: Y.Doc,
    fragment: Y.XmlFragment,
    relative: unknown,
    mapping: YMapping,
  ) => number | null
}

// ---------------------------------------------------------------------------
// capture
// ---------------------------------------------------------------------------

/**
 * Describes the selection well enough to find it again later.
 *
 * `y` is optional on purpose: a comment made while the document is not
 * collaborating is still a valid comment, it just has one fewer way home.
 */
export function captureAnchor(
  doc: ProseMirrorNode,
  from: number,
  to: number,
  y?: YContext,
): CommentAnchor {
  const quote = doc.textBetween(from, to, BLOCK_SEPARATOR)
  const before = doc.textBetween(Math.max(0, from - CONTEXT_CHARS), from, BLOCK_SEPARATOR)
  const after = doc.textBetween(
    to,
    Math.min(doc.content.size, to + CONTEXT_CHARS),
    BLOCK_SEPARATOR,
  )

  const anchor: CommentAnchor = { quote, prefix: before, suffix: after }

  if (y) {
    try {
      anchor.relativeFrom = toBase64(
        Y.encodeRelativePosition(y.toRelative(from, y.fragment, y.mapping) as Y.RelativePosition),
      )
      anchor.relativeTo = toBase64(
        Y.encodeRelativePosition(y.toRelative(to, y.fragment, y.mapping) as Y.RelativePosition),
      )
    } catch {
      // A missing relative position costs precision, not correctness -- the
      // quote still resolves. Failing the whole comment over it would not.
      delete anchor.relativeFrom
      delete anchor.relativeTo
    }
  }

  return anchor
}

// ---------------------------------------------------------------------------
// resolve
// ---------------------------------------------------------------------------

interface TextIndex {
  text: string
  /** Document position of each character; -1 for a synthesised separator. */
  positions: number[]
}

/**
 * Flattens the document to text, remembering where each character came from.
 *
 * Positions are recorded per character rather than derived from block offsets,
 * so a quote running across bold, italic or link marks -- separate text nodes
 * in one paragraph -- still resolves to a single contiguous range.
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
      if (firstBlock) firstBlock = false
      else {
        characters.push(BLOCK_SEPARATOR)
        positions.push(-1)
      }
    }

    return true
  })

  return { text: characters.join(''), positions }
}

function occurrences(index: TextIndex, needle: string): { from: number; to: number; at: number }[] {
  const found: { from: number; to: number; at: number }[] = []
  if (!needle) return found

  let at = index.text.indexOf(needle)
  while (at !== -1) {
    const start = index.positions[at]
    const end = index.positions[at + needle.length - 1]
    if (start >= 0 && end >= 0) found.push({ from: start, to: end + 1, at })
    at = index.text.indexOf(needle, at + 1)
  }
  return found
}

/** How many characters of `a`'s tail match `b`'s tail. Used on the prefix. */
function commonSuffixLength(a: string, b: string): number {
  let n = 0
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n += 1
  return n
}

/** How many characters of `a`'s head match `b`'s head. Used on the suffix. */
function commonPrefixLength(a: string, b: string): number {
  let n = 0
  while (n < a.length && n < b.length && a[n] === b[n]) n += 1
  return n
}

/**
 * Finds what a comment is about in the document as it now stands.
 *
 * Never throws and never guesses. An anchor it cannot place comes back
 * `orphaned` with a reason, and the thread is shown as detached rather than
 * quietly attached to the wrong sentence -- a comment pointing at text nobody
 * wrote is worse than one pointing at nothing.
 */
export function resolveAnchor(
  doc: ProseMirrorNode,
  anchor: CommentAnchor,
  y?: YContext,
): AnchorResolution {
  const quote = anchor.quote ?? ''
  if (!quote.trim()) return { status: 'orphaned', reason: 'empty-quote' }

  // (1) The CRDT's own answer. Trusted only if the text there still matches:
  // a relative position survives edits *around* it, not edits *through* it.
  if (y && anchor.relativeFrom && anchor.relativeTo) {
    try {
      const from = y.toAbsolute(
        y.ydoc,
        y.fragment,
        Y.decodeRelativePosition(fromBase64(anchor.relativeFrom)),
        y.mapping,
      )
      const to = y.toAbsolute(
        y.ydoc,
        y.fragment,
        Y.decodeRelativePosition(fromBase64(anchor.relativeTo)),
        y.mapping,
      )

      if (
        from !== null &&
        to !== null &&
        from < to &&
        to <= doc.content.size &&
        doc.textBetween(from, to, BLOCK_SEPARATOR) === quote
      ) {
        return { status: 'resolved', from, to, via: 'relative' }
      }
    } catch {
      // Fall through to the text search; a corrupt or foreign relative
      // position is a reason to try the other route, not to give up.
    }
  }

  const index = buildTextIndex(doc)
  const hits = occurrences(index, quote)

  if (hits.length === 0) return { status: 'orphaned', reason: 'not-found' }
  if (hits.length === 1) {
    return { status: 'resolved', from: hits[0].from, to: hits[0].to, via: 'quote' }
  }

  /*
   * (2) The quote appears more than once, so the words either side decide it.
   * This is what makes commenting on "the mitochondrion" in a note that says
   * it four times land on the one that was actually selected.
   */
  const scored = hits.map((hit) => {
    const before = index.text.slice(Math.max(0, hit.at - CONTEXT_CHARS), hit.at)
    const after = index.text.slice(hit.at + quote.length, hit.at + quote.length + CONTEXT_CHARS)
    return {
      hit,
      score:
        commonSuffixLength(anchor.prefix ?? '', before) +
        commonPrefixLength(anchor.suffix ?? '', after),
    }
  })

  const best = Math.max(...scored.map((entry) => entry.score))
  const winners = scored.filter((entry) => entry.score === best)

  // A tie means the context genuinely does not distinguish them. Picking the
  // first would be a coin toss dressed up as an answer.
  if (best === 0 || winners.length > 1) return { status: 'orphaned', reason: 'ambiguous' }

  return {
    status: 'resolved',
    from: winners[0].hit.from,
    to: winners[0].hit.to,
    via: 'context',
  }
}

export type OrphanReason = Extract<AnchorResolution, { status: 'orphaned' }>['reason']

/** What the sidebar says about a thread it cannot place. */
export function describeOrphan(reason: OrphanReason): string {
  switch (reason) {
    case 'ambiguous':
      return 'The text this refers to now appears more than once, so it is no longer highlighted.'
    case 'empty-quote':
      return 'This comment was made without selecting any text.'
    default:
      return 'The text this refers to has been changed or deleted.'
  }
}
