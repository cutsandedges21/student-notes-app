import { describe, it, expect } from 'vitest'
import { countText } from './wordCount'

describe('countText', () => {
  it('reports nothing for an empty note', () => {
    // Splitting '' on whitespace yields one empty entry, so the naive count
    // reports a word in a blank document.
    expect(countText('')).toEqual({ words: 0, characters: 0, charactersNoSpaces: 0 })
  })

  it('counts words, characters, and characters excluding spaces', () => {
    expect(countText('the mitochondria')).toEqual({
      words: 2,
      characters: 16,
      charactersNoSpaces: 15,
    })
  })

  it('is not confused by runs of whitespace or by newlines', () => {
    expect(countText('  one\n\ntwo   three \t four  ').words).toBe(4)
  })

  it('counts a hyphenated word and an abbreviation as one word each', () => {
    expect(countText('self-aware').words).toBe(1)
    expect(countText('e.g.').words).toBe(1)
  })
})
