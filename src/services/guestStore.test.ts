import { describe, it, expect, beforeEach } from 'vitest'
import {
  guestCreateClass,
  guestFetchClasses,
  guestFetchClass,
  guestUpdateClass,
  guestDeleteClass,
  guestCreateDocument,
  guestFetchDocuments,
  guestFetchDocument,
  guestSaveDocument,
  guestDeleteDocument,
  guestHasData,
  guestSnapshot,
  guestClear,
} from './guestStore'

const input = {
  name: 'Biology 101',
  course_code: 'BIO 101',
  professor: 'Dr. Chen',
  semester: 'Fall 2026',
  course_level: 'College' as const,
}

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

describe('guestStore', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('starts empty', () => {
    expect(guestFetchClasses()).toEqual([])
    expect(guestHasData()).toBe(false)
  })

  it('creates and lists a class', () => {
    const created = guestCreateClass(input)

    expect(created.name).toBe('Biology 101')
    expect(created.id).toBeTruthy()

    const listed = guestFetchClasses()
    expect(listed).toHaveLength(1)
    expect(listed[0].name).toBe('Biology 101')
  })

  it('persists across a reload, since data lives in localStorage', () => {
    const created = guestCreateClass(input)

    // Simulates a page refresh: nothing cached in module memory is reused,
    // the value is re-read from localStorage.
    expect(guestFetchClass(created.id)?.name).toBe('Biology 101')
  })

  it('reports a note count per class', () => {
    const klass = guestCreateClass(input)
    guestCreateDocument(klass.id, 'Lecture 1')
    guestCreateDocument(klass.id, 'Lecture 2')

    expect(guestFetchClasses()[0].note_count).toBe(2)
  })

  it('renames a class', () => {
    const klass = guestCreateClass(input)
    guestUpdateClass(klass.id, { name: 'Biology 102' })

    expect(guestFetchClass(klass.id)?.name).toBe('Biology 102')
  })

  it('cascade-deletes a class and its documents, mirroring the Postgres FK', () => {
    const klass = guestCreateClass(input)
    guestCreateDocument(klass.id, 'Lecture 1')

    guestDeleteClass(klass.id)

    expect(guestFetchClasses()).toEqual([])
    expect(guestFetchDocuments(klass.id)).toEqual([])
  })

  it('saves document content and advances the version', () => {
    const klass = guestCreateClass(input)
    const created = guestCreateDocument(klass.id, 'Lecture 1')
    expect(created.version).toBe(1)

    const result = guestSaveDocument({
      documentId: created.id,
      title: 'Lecture 1 — Cells',
      content: doc('Cells are the basic unit of life.'),
      expectedVersion: created.version,
    })

    expect(result).toEqual({ status: 'saved', version: 2 })

    const saved = guestFetchDocument(created.id)
    expect(saved?.title).toBe('Lecture 1 — Cells')
    expect(saved?.content_text).toBe('Cells are the basic unit of life.')
  })

  it('rejects a stale save, matching the Supabase optimistic-concurrency contract', () => {
    const klass = guestCreateClass(input)
    const created = guestCreateDocument(klass.id, 'Lecture 1')

    guestSaveDocument({
      documentId: created.id,
      title: 'first',
      content: doc('first'),
      expectedVersion: 1,
    })

    // Second writer still believes the document is at version 1.
    const stale = guestSaveDocument({
      documentId: created.id,
      title: 'second',
      content: doc('second'),
      expectedVersion: 1,
    })

    expect(stale).toEqual({ status: 'stale' })
    expect(guestFetchDocument(created.id)?.title).toBe('first')
  })

  it('deletes a single document without touching its class', () => {
    const klass = guestCreateClass(input)
    const created = guestCreateDocument(klass.id, 'Lecture 1')

    guestDeleteDocument(created.id)

    expect(guestFetchDocuments(klass.id)).toEqual([])
    expect(guestFetchClass(klass.id)).not.toBeNull()
  })

  it('snapshots everything for migration, then clears', () => {
    const klass = guestCreateClass(input)
    guestCreateDocument(klass.id, 'Lecture 1')

    const snapshot = guestSnapshot()
    expect(snapshot.classes).toHaveLength(1)
    expect(snapshot.documents).toHaveLength(1)
    expect(guestHasData()).toBe(true)

    guestClear()

    expect(guestHasData()).toBe(false)
    expect(guestFetchClasses()).toEqual([])
  })

  it('survives corrupted localStorage rather than crashing the app', () => {
    localStorage.setItem('margin.guest.classes', 'not json{{{')

    expect(guestFetchClasses()).toEqual([])
  })
})
