import { describe, it, expect } from 'vitest'
import { formatNoteRef, noteHref, parseNoteRef } from './noteRef'

const ID = '0f7c2a1e-4b3d-4c8a-9f21-5d6e7a8b9c0d'
const OTHER = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

describe('formatNoteRef', () => {
  it('puts the readable part in front of the id', () => {
    expect(formatNoteRef('lecture-5', ID)).toBe(`lecture-5--${ID}`)
  })

  // 'untitled--<uuid>' says nothing the uuid does not, and reads worse.
  it('uses the bare id when there is no slug to show', () => {
    expect(formatNoteRef('', ID)).toBe(ID)
  })
})

describe('parseNoteRef', () => {
  it('splits a canonical reference', () => {
    expect(parseNoteRef(`lecture-5--${ID}`)).toEqual({
      slug: 'lecture-5',
      documentId: ID,
    })
  })

  it('reads a bare id as an untitled note', () => {
    expect(parseNoteRef(ID)).toEqual({ slug: '', documentId: ID })
  })

  it('is case-insensitive about the id', () => {
    expect(parseNoteRef(`lecture-5--${ID.toUpperCase()}`).documentId).toBe(ID.toUpperCase())
  })

  /*
   * The link-preservation contract. Addresses written before ids were in the
   * URL carry only a slug, and they have to keep resolving -- by slug, then a
   * redirect to the canonical form.
   */
  it('reads a legacy slug-only address as having no id', () => {
    expect(parseNoteRef('lecture-5')).toEqual({ slug: 'lecture-5', documentId: null })
  })

  // A title like "Week 3 -- Enzymes" slugifies with a doubled separator.
  it('does not mistake a doubled hyphen inside a slug for an id', () => {
    expect(parseNoteRef('week-3--enzymes')).toEqual({
      slug: 'week-3--enzymes',
      documentId: null,
    })
  })

  it('takes the id from the last separator, so a slug may contain one', () => {
    expect(parseNoteRef(`week-3--enzymes--${ID}`)).toEqual({
      slug: 'week-3--enzymes',
      documentId: ID,
    })
  })

  it('rejects a trailing fragment that only looks like an id', () => {
    expect(parseNoteRef('lecture-5--not-a-uuid')).toEqual({
      slug: 'lecture-5--not-a-uuid',
      documentId: null,
    })
  })

  it('is total: empty and whitespace resolve to nothing rather than throwing', () => {
    expect(parseNoteRef('')).toEqual({ slug: '', documentId: null })
    expect(parseNoteRef('   ')).toEqual({ slug: '', documentId: null })
  })

  it('round-trips whatever formatNoteRef produces', () => {
    for (const slug of ['lecture-5', '', 'week-3--enzymes', 'a']) {
      const parsed = parseNoteRef(formatNoteRef(slug, OTHER))
      expect(parsed.documentId).toBe(OTHER)
      expect(parsed.slug).toBe(slug)
    }
  })
})

describe('noteHref', () => {
  it('builds the full path', () => {
    expect(noteHref('biology-101', 'lecture-5', ID)).toBe(
      `/classes/biology-101/lecture-5--${ID}`,
    )
  })
})
