import { describe, it, expect, beforeEach } from 'vitest'
import {
  guestCreateClass,
  guestCreateDocument,
  guestFetchDocument,
  guestSaveDocument,
} from './guestStore'

/*
 * Slug churn.
 *
 * Every save used to regenerate the slug from the title. On the Supabase path
 * that cost two extra round trips per save (read the row, list the class's
 * slugs); on both paths it changed the note's address while the writer was
 * still typing its name, and the editor page then navigated to follow it --
 * reloading the document, resetting the caret, and racing the next keystroke.
 *
 * A note is addressed by its id now, so the slug is free to lag behind the
 * title until something explicitly asks it to catch up. These tests pin down
 * that it does lag, and that it still catches up when asked.
 */

const klassInput = {
  name: 'Biology 101',
  course_code: 'BIO 101',
  professor: 'Dr. Chen',
  semester: 'Fall 2026',
  course_level: 'College' as const,
}

const body = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

describe('slug stability on save', () => {
  beforeEach(() => localStorage.clear())

  it('leaves the slug alone when a save is not asked to re-slug', () => {
    const klass = guestCreateClass(klassInput)
    const doc = guestCreateDocument(klass.id, 'Lecture 1')
    const original = doc.slug

    const result = guestSaveDocument({
      documentId: doc.id,
      title: 'Something completely different',
      content: body('notes'),
      expectedVersion: doc.version,
    })

    expect(result.status).toBe('saved')
    const saved = guestFetchDocument(doc.id)
    expect(saved?.title).toBe('Something completely different')
    expect(saved?.slug).toBe(original)
  })

  // Typing a title is a burst of saves. None of them may move the address.
  it('holds the slug still across a burst of title edits', () => {
    const klass = guestCreateClass(klassInput)
    const doc = guestCreateDocument(klass.id, 'L')
    const original = doc.slug

    let version = doc.version
    for (const title of ['Le', 'Lec', 'Lect', 'Lectu', 'Lecture 5']) {
      const result = guestSaveDocument({
        documentId: doc.id,
        title,
        content: body('notes'),
        expectedVersion: version,
      })
      expect(result.status).toBe('saved')
      if (result.status === 'saved') version = result.version
    }

    expect(guestFetchDocument(doc.id)?.slug).toBe(original)
    expect(guestFetchDocument(doc.id)?.title).toBe('Lecture 5')
  })

  it('re-slugs when a caller explicitly asks', () => {
    const klass = guestCreateClass(klassInput)
    const doc = guestCreateDocument(klass.id, 'Lecture 1')

    guestSaveDocument({
      documentId: doc.id,
      title: 'Photosynthesis',
      content: body('notes'),
      expectedVersion: doc.version,
      reslug: true,
    })

    expect(guestFetchDocument(doc.id)?.slug).toBe('photosynthesis')
  })

  /*
   * The note's own slug must not be treated as taken when re-slugging it, or
   * saving a note under its existing title walks it to `photosynthesis-2`,
   * then `-3`, on every explicit re-slug.
   */
  it('does not collide a note with itself when re-slugging', () => {
    const klass = guestCreateClass(klassInput)
    const doc = guestCreateDocument(klass.id, 'Photosynthesis')

    let version = doc.version
    for (let i = 0; i < 3; i += 1) {
      const result = guestSaveDocument({
        documentId: doc.id,
        title: 'Photosynthesis',
        content: body('notes'),
        expectedVersion: version,
        reslug: true,
      })
      if (result.status === 'saved') version = result.version
    }

    expect(guestFetchDocument(doc.id)?.slug).toBe('photosynthesis')
  })

  it('still avoids a slug another note in the class already holds', () => {
    const klass = guestCreateClass(klassInput)
    guestCreateDocument(klass.id, 'Photosynthesis')
    const second = guestCreateDocument(klass.id, 'Respiration')

    guestSaveDocument({
      documentId: second.id,
      title: 'Photosynthesis',
      content: body('notes'),
      expectedVersion: second.version,
      reslug: true,
    })

    expect(guestFetchDocument(second.id)?.slug).not.toBe('photosynthesis')
  })
})
