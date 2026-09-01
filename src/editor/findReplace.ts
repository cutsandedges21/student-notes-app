import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

/**
 * Searching a ProseMirror document.
 *
 * Pure, and separated from the panel that drives it, because this is where all
 * the ways it can be wrong live: offsets that do not map back onto document
 * positions, matches that span two text nodes because a word is half bold, and
 * replacements applied left-to-right that invalidate every position after the
 * first one.
 *
 * The document is flattened to a string once, remembering where each character
 * came from, so a match can always be turned back into a range. Searching the
 * flattened text without that mapping -- which the previous prompt-based find
 * did -- lands the selection in the wrong place in any document with more than
 * one block.
 */

export interface SearchOptions {
  caseSensitive?: boolean
  /** Matches only where the hit is bounded by non-word characters. */
  wholeWord?: boolean
}

export interface Match {
  from: number
  to: number
}

/** Block boundary, matching the editor's own `textBetween(from, to, ' ')`. */
const BLOCK_SEPARATOR = ' '

interface TextIndex {
  text: string
  /** Document position of each character; -1 for a synthesised separator. */
  positions: number[]
}

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

const isWordChar = (character: string | undefined) =>
  character !== undefined && /[\p{L}\p{N}_]/u.test(character)

/**
 * Every match of `query`, as document ranges, in document order.
 *
 * Returns an empty list rather than throwing for an empty query, so a panel
 * can call it on every keystroke without guarding first.
 */
export function findMatches(
  doc: ProseMirrorNode,
  query: string,
  options: SearchOptions = {},
): Match[] {
  if (!query) return []

  const index = buildTextIndex(doc)
  const haystack = options.caseSensitive ? index.text : index.text.toLowerCase()
  const needle = options.caseSensitive ? query : query.toLowerCase()

  const matches: Match[] = []
  let at = haystack.indexOf(needle)

  while (at !== -1) {
    const end = at + needle.length

    const bounded =
      !options.wholeWord ||
      (!isWordChar(haystack[at - 1]) && !isWordChar(haystack[end]))

    const start = index.positions[at]
    const last = index.positions[end - 1]

    // A match whose first or last character is a synthesised block separator
    // has no real position to anchor to.
    if (bounded && start >= 0 && last >= 0) matches.push({ from: start, to: last + 1 })

    // Step by one, not by the needle's length: overlapping occurrences of a
    // repeating string ("aa" in "aaa") are two matches, and a person cycling
    // through them expects to visit both.
    at = haystack.indexOf(needle, at + 1)
  }

  return matches
}

/**
 * Which match to visit next, given where the caret is.
 *
 * Wraps in both directions, and returns 0 for an empty list so callers can
 * treat "no matches" and "first match" without a special case.
 */
export function nextMatchIndex(
  matches: Match[],
  caret: number,
  direction: 'forward' | 'backward',
): number {
  if (matches.length === 0) return 0

  if (direction === 'forward') {
    const found = matches.findIndex((match) => match.from >= caret)
    return found === -1 ? 0 : found
  }

  for (let index = matches.length - 1; index >= 0; index -= 1) {
    if (matches[index].to <= caret) return index
  }
  return matches.length - 1
}

/**
 * Match ranges ordered so they can be replaced one after another safely.
 *
 * Replacing left to right shifts every position after the first edit, so the
 * second replacement lands in the wrong place -- and increasingly so as the
 * replacement's length differs from the match's. Applying from the end
 * backwards means no edit can move a range that has not been used yet, which
 * is why replace-all can be a plain loop rather than a mapping exercise.
 */
export function replacementOrder(matches: Match[]): Match[] {
  return [...matches].sort((a, b) => b.from - a.from)
}
