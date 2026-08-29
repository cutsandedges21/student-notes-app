import { describe, it, expect } from 'vitest'
import { slugify, uniqueSlug } from './slug'

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Biology 101')).toBe('biology-101')
  })

  it('strips punctuation rather than encoding it', () => {
    expect(slugify('Lecture 5 — Cellular Respiration!')).toBe(
      'lecture-5-cellular-respiration',
    )
  })

  it('folds accents to plain letters, so URLs stay readable', () => {
    expect(slugify('Économie & Société')).toBe('economie-societe')
  })

  it('collapses runs of separators and trims the ends', () => {
    expect(slugify('  --Intro   to///Physics-- ')).toBe('intro-to-physics')
  })

  it('falls back when a name has nothing sluggable', () => {
    expect(slugify('***')).toBe('untitled')
    expect(slugify('')).toBe('untitled')
  })

  it('caps length so a long title cannot produce an unusable URL', () => {
    const slug = slugify('word '.repeat(60))
    expect(slug.length).toBeLessThanOrEqual(60)
    // Never leaves a trailing hyphen from the cut.
    expect(slug.endsWith('-')).toBe(false)
  })

  it('keeps CJK and other non-latin text rather than emptying it', () => {
    expect(slugify('生物学 101')).toBe('生物学-101')
  })
})

describe('uniqueSlug', () => {
  it('returns the base slug when nothing conflicts', () => {
    expect(uniqueSlug('Biology 101', [])).toBe('biology-101')
  })

  it('appends a counter on collision', () => {
    expect(uniqueSlug('Biology 101', ['biology-101'])).toBe('biology-101-2')
  })

  it('keeps counting past an existing suffix', () => {
    expect(uniqueSlug('Biology 101', ['biology-101', 'biology-101-2'])).toBe(
      'biology-101-3',
    )
  })

  // Renaming a note to its own current name must not bump the number every
  // save, which would walk the slug up forever.
  it('ignores the row being renamed', () => {
    expect(uniqueSlug('Biology 101', ['biology-101'], 'biology-101')).toBe('biology-101')
  })

  it('still avoids other rows when renaming', () => {
    expect(
      uniqueSlug('Biology 101', ['biology-101', 'biology-101-2'], 'biology-101-2'),
    ).toBe('biology-101-2')
  })
})
