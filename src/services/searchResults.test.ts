import { describe, it, expect } from 'vitest'
import {
  buildSnippet,
  escapeLikePattern,
  rankHits,
  type SearchHit,
} from './searchResults'

/**
 * The parts of search that are the same wherever the notes are stored.
 *
 * These are pure on purpose: the Postgres path and the localStorage path both
 * run them, so a difference here would mean guests and signed-in students got
 * different answers to the same question.
 */

const hit = (over: Partial<SearchHit> = {}): SearchHit => ({
  documentId: 'd1',
  title: 'Cells',
  classId: 'c1',
  className: 'Biology',
  classSlug: 'biology',
  slug: 'cells',
  snippet: '',
  inTitle: false,
  ...over,
})

describe('escapeLikePattern', () => {
  /**
   * `%` is a LIKE wildcard, so an unescaped "50%" matches every note that
   * contains "50" followed by anything -- which is every note containing 50.
   */
  it('escapes the wildcards a student can type', () => {
    expect(escapeLikePattern('50%')).toBe('50\\%')
    expect(escapeLikePattern('a_b')).toBe('a\\_b')
  })

  it('escapes the escape character itself', () => {
    expect(escapeLikePattern('a\\b')).toBe('a\\\\b')
  })

  it('leaves ordinary text alone', () => {
    expect(escapeLikePattern('osmosis')).toBe('osmosis')
    expect(escapeLikePattern('H2O and ATP')).toBe('H2O and ATP')
  })
})

describe('buildSnippet', () => {
  it('is empty for an empty note', () => {
    expect(buildSnippet('', 'x')).toBe('')
    expect(buildSnippet('   \n  ', 'x')).toBe('')
  })

  it('centres on the match', () => {
    const text = `${'a'.repeat(200)} osmosis ${'b'.repeat(200)}`
    const snippet = buildSnippet(text, 'osmosis')

    expect(snippet).toContain('osmosis')
    expect(snippet.startsWith('…')).toBe(true)
    expect(snippet.endsWith('…')).toBe(true)
    expect(snippet.length).toBeLessThan(text.length)
  })

  it('does not mark an ellipsis where the text simply begins', () => {
    expect(buildSnippet('osmosis is a thing', 'osmosis').startsWith('…')).toBe(false)
  })

  it('matches case-insensitively, and keeps the original casing', () => {
    expect(buildSnippet('Osmosis is a thing', 'osmosis')).toContain('Osmosis')
  })

  it('flattens newlines so a snippet is one line', () => {
    expect(buildSnippet('one\n\ntwo\tthree', 'two')).toBe('one two three')
  })

  /** Happens when the query matched the title and not the body. */
  it('falls back to the opening of the note when nothing matches', () => {
    expect(buildSnippet('nothing relevant here', 'osmosis')).toBe('nothing relevant here')
  })
})

describe('rankHits', () => {
  it('puts a title match above a body match', () => {
    const ranked = rankHits([
      hit({ documentId: 'body', inTitle: false }),
      hit({ documentId: 'title', inTitle: true }),
    ])

    expect(ranked.map((h) => h.documentId)).toEqual(['title', 'body'])
  })

  /** The callers already ordered by recency; ranking must not undo that. */
  it('keeps the incoming order within a group', () => {
    const ranked = rankHits([
      hit({ documentId: 'newer', inTitle: false }),
      hit({ documentId: 'older', inTitle: false }),
    ])

    expect(ranked.map((h) => h.documentId)).toEqual(['newer', 'older'])
  })

  it('does not mutate what it was given', () => {
    const input = [hit({ documentId: 'a' }), hit({ documentId: 'b', inTitle: true })]
    rankHits(input)

    expect(input.map((h) => h.documentId)).toEqual(['a', 'b'])
  })
})
