import { describe, it, expect } from 'vitest'
import { getSchema } from '@tiptap/core'
import { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { editorExtensions } from './extensions'
import { findMatches, nextMatchIndex, replacementOrder } from './findReplace'

/*
 * Find and replace used to be a `window.prompt` that could only find, and that
 * searched the flattened text without mapping offsets back onto document
 * positions -- so in any document with more than one block the selection
 * landed in the wrong place. These tests pin down the mapping, the options,
 * and the ordering that makes replace-all safe.
 */

const schema = getSchema(editorExtensions)

const doc = (...paragraphs: string[]) =>
  ProseMirrorNode.fromJSON(schema, {
    type: 'doc',
    content: paragraphs.map((text) => ({
      type: 'paragraph',
      content: text ? [{ type: 'text', text }] : [],
    })),
  })

/** What the editor would show for a match, so positions are checked for real. */
const textAt = (node: ProseMirrorNode, match: { from: number; to: number }) =>
  node.textBetween(match.from, match.to, ' ')

describe('findMatches', () => {
  it('finds nothing for an empty query rather than throwing', () => {
    expect(findMatches(doc('Anything at all'), '')).toEqual([])
  })

  it('returns ranges that actually cover the match', () => {
    const node = doc('The mitochondrion makes ATP.')
    const matches = findMatches(node, 'mitochondrion')

    expect(matches).toHaveLength(1)
    expect(textAt(node, matches[0])).toBe('mitochondrion')
  })

  // The bug the old implementation had: offsets from the flattened string do
  // not map onto document positions once there is more than one block.
  it('maps positions correctly across several paragraphs', () => {
    const node = doc('First paragraph.', 'Second paragraph.', 'Third mentions ATP.')
    const matches = findMatches(node, 'ATP')

    expect(matches).toHaveLength(1)
    expect(textAt(node, matches[0])).toBe('ATP')
  })

  it('finds every occurrence, in document order', () => {
    const node = doc('one two one', 'one again')
    const matches = findMatches(node, 'one')

    expect(matches).toHaveLength(3)
    expect(matches.map((match) => match.from)).toEqual(
      [...matches.map((match) => match.from)].sort((a, b) => a - b),
    )
    for (const match of matches) expect(textAt(node, match)).toBe('one')
  })

  it('is case-insensitive by default and exact on request', () => {
    const node = doc('ATP and atp and Atp')

    expect(findMatches(node, 'atp')).toHaveLength(3)
    expect(findMatches(node, 'atp', { caseSensitive: true })).toHaveLength(1)
  })

  describe('whole word', () => {
    it('excludes matches inside a longer word', () => {
      const node = doc('cat concatenate cats')

      expect(findMatches(node, 'cat')).toHaveLength(3)
      const whole = findMatches(node, 'cat', { wholeWord: true })
      expect(whole).toHaveLength(1)
      expect(node.textBetween(whole[0].from - 0, whole[0].to + 1, ' ')).toBe('cat ')
    })

    it('treats punctuation as a boundary', () => {
      expect(findMatches(doc('the cat, sat'), 'cat', { wholeWord: true })).toHaveLength(1)
    })

    it('handles a match at the very start and end', () => {
      expect(findMatches(doc('cat'), 'cat', { wholeWord: true })).toHaveLength(1)
    })
  })

  // A person cycling through matches expects to visit both of them.
  it('counts overlapping occurrences separately', () => {
    expect(findMatches(doc('aaa'), 'aa')).toHaveLength(2)
  })

  it('finds a match split across formatting marks', () => {
    const node = ProseMirrorNode.fromJSON(schema, {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'electron ' },
            { type: 'text', marks: [{ type: 'bold' }], text: 'transport' },
            { type: 'text', text: ' chain' },
          ],
        },
      ],
    })

    const matches = findMatches(node, 'electron transport chain')
    expect(matches).toHaveLength(1)
    expect(textAt(node, matches[0])).toBe('electron transport chain')
  })

  it('does not match across a paragraph boundary on a word', () => {
    // "First" and "Second" are separate blocks joined by one space, so a query
    // spanning them is legitimate; a query for a word that only exists by
    // straddling the join is not what anyone means.
    const node = doc('alpha', 'beta')
    expect(findMatches(node, 'alphabeta')).toHaveLength(0)
    expect(findMatches(node, 'alpha beta')).toHaveLength(1)
  })
})

describe('nextMatchIndex', () => {
  const matches = [
    { from: 10, to: 13 },
    { from: 30, to: 33 },
    { from: 50, to: 53 },
  ]

  it('returns 0 when there is nothing to visit', () => {
    expect(nextMatchIndex([], 0, 'forward')).toBe(0)
    expect(nextMatchIndex([], 0, 'backward')).toBe(0)
  })

  it('goes to the first match at or after the caret', () => {
    expect(nextMatchIndex(matches, 0, 'forward')).toBe(0)
    expect(nextMatchIndex(matches, 11, 'forward')).toBe(1)
    expect(nextMatchIndex(matches, 30, 'forward')).toBe(1)
  })

  it('wraps to the top once the caret is past the last match', () => {
    expect(nextMatchIndex(matches, 60, 'forward')).toBe(0)
  })

  it('goes to the last match ending at or before the caret', () => {
    expect(nextMatchIndex(matches, 60, 'backward')).toBe(2)
    expect(nextMatchIndex(matches, 33, 'backward')).toBe(1)
  })

  it('wraps to the bottom when the caret is above every match', () => {
    expect(nextMatchIndex(matches, 0, 'backward')).toBe(2)
  })
})

describe('replacementOrder', () => {
  /*
   * Replace-all applied left to right shifts every later position by the
   * difference in length, so the second replacement lands in the wrong place.
   * Back to front, no edit can move a range that has not been used yet.
   */
  it('orders matches back to front', () => {
    const matches = [
      { from: 10, to: 13 },
      { from: 30, to: 33 },
      { from: 50, to: 53 },
    ]
    expect(replacementOrder(matches).map((match) => match.from)).toEqual([50, 30, 10])
  })

  it('does not mutate the caller’s array', () => {
    const matches = [
      { from: 10, to: 13 },
      { from: 30, to: 33 },
    ]
    replacementOrder(matches)
    expect(matches.map((match) => match.from)).toEqual([10, 30])
  })
})
