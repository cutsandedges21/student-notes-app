import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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
  guestExportJson,
  guestExportFilename,
  guestStorageAvailable,
  classifyStorageError,
  GuestStorageError,
  readMigrationLedger,
  writeMigrationLedger,
  type GuestExport,
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

  it('starts a note unstarred and carries a star through a save', () => {
    const klass = guestCreateClass(input)
    const created = guestCreateDocument(klass.id, 'Lecture 1')
    expect(created.starred).toBe(false)

    guestSaveDocument({
      documentId: created.id,
      title: 'Lecture 1',
      content: doc('body'),
      expectedVersion: created.version,
      starred: true,
    })

    expect(guestFetchDocument(created.id)?.starred).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// storage failure
// ---------------------------------------------------------------------------

const QUOTA = new DOMException('The quota has been exceeded.', 'QuotaExceededError')
const DENIED = new DOMException('Access is denied for this document.', 'SecurityError')

/** Real setItem, captured before any spy replaces it. */
const realSetItem = Storage.prototype.setItem

/** Makes writes to `key` fail; every other key still works. */
function failWritesTo(key: string, error: unknown) {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
    this: Storage,
    written: string,
    value: string,
  ) {
    if (written === key) throw error
    realSetItem.call(this, written, value)
  })
}

/** Makes every write fail, the way a full or disabled store behaves. */
function failAllWrites(error: unknown) {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw error
  })
}

describe('guestStore storage failures', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('classifies quota errors by name, by legacy name and by numeric code', () => {
    expect(classifyStorageError(QUOTA)).toBe('quota')
    expect(
      classifyStorageError({ name: 'NS_ERROR_DOM_QUOTA_REACHED', message: 'persistent storage' }),
    ).toBe('quota')
    expect(classifyStorageError({ name: 'Error', code: 22, message: '' })).toBe('quota')
    expect(classifyStorageError({ name: 'Error', code: 1014, message: '' })).toBe('quota')
  })

  it('separates a blocked store from an unrecognised failure', () => {
    expect(classifyStorageError(DENIED)).toBe('unavailable')
    expect(classifyStorageError(new Error('localStorage is not defined'))).toBe('unavailable')
    expect(classifyStorageError(new Error('something else entirely'))).toBe('unknown')
  })

  it('reports whether storage can be written to at all', () => {
    expect(guestStorageAvailable()).toBe(true)
    failAllWrites(DENIED)
    expect(guestStorageAvailable()).toBe(false)
  })

  // The bug this whole area exists for: write() logged the error and returned,
  // so the save reported success for a note that never left memory.
  it('returns failed rather than saved when the browser refuses the write', () => {
    const klass = guestCreateClass(input)
    const created = guestCreateDocument(klass.id, 'Lecture 1')

    failAllWrites(QUOTA)

    const result = guestSaveDocument({
      documentId: created.id,
      title: 'Lecture 1 — Cells',
      content: doc('Cells are the basic unit of life.'),
      expectedVersion: created.version,
    })

    expect(result.status).toBe('failed')
    expect(result).toMatchObject({ status: 'failed', reason: 'quota', version: 1 })
    expect('message' in result && result.message).toMatch(/storage is full/i)
  })

  it('leaves the stored note exactly as it was after a failed save', () => {
    const klass = guestCreateClass(input)
    const created = guestCreateDocument(klass.id, 'Lecture 1')

    failAllWrites(QUOTA)

    guestSaveDocument({
      documentId: created.id,
      title: 'overwritten',
      content: doc('overwritten'),
      expectedVersion: created.version,
    })

    vi.restoreAllMocks()

    const stored = guestFetchDocument(created.id)
    expect(stored?.title).toBe('Lecture 1')
    expect(stored?.version).toBe(1)
    expect(stored?.content_text).toBe('')
  })

  it('distinguishes a blocked store from a full one in the result', () => {
    const klass = guestCreateClass(input)
    const created = guestCreateDocument(klass.id, 'Lecture 1')

    failAllWrites(DENIED)

    const result = guestSaveDocument({
      documentId: created.id,
      title: 'Lecture 1',
      content: doc('body'),
      expectedVersion: created.version,
    })

    expect(result).toMatchObject({ status: 'failed', reason: 'unavailable' })
  })

  it('throws instead of pretending a class was created', () => {
    failAllWrites(QUOTA)

    expect(() => guestCreateClass(input)).toThrow(GuestStorageError)
    vi.restoreAllMocks()
    expect(guestFetchClasses()).toEqual([])
  })

  it('throws instead of pretending a class was renamed', () => {
    const klass = guestCreateClass(input)
    failAllWrites(QUOTA)

    expect(() => guestUpdateClass(klass.id, { name: 'Biology 102' })).toThrow(GuestStorageError)
    vi.restoreAllMocks()
    expect(guestFetchClass(klass.id)?.name).toBe('Biology 101')
  })

  it('throws instead of pretending a note was created or deleted', () => {
    const klass = guestCreateClass(input)
    const created = guestCreateDocument(klass.id, 'Lecture 1')

    failAllWrites(QUOTA)
    expect(() => guestCreateDocument(klass.id, 'Lecture 2')).toThrow(GuestStorageError)
    expect(() => guestDeleteDocument(created.id)).toThrow(GuestStorageError)

    vi.restoreAllMocks()
    expect(guestFetchDocuments(klass.id)).toHaveLength(1)
  })

  // A cascade delete touches two keys. Failing between them used to leave the
  // class gone and its notes stranded with no parent.
  it('rolls both keys back when a cascade delete fails halfway', () => {
    const klass = guestCreateClass(input)
    guestCreateDocument(klass.id, 'Lecture 1')

    failWritesTo('margin.guest.documents', QUOTA)

    expect(() => guestDeleteClass(klass.id)).toThrow(GuestStorageError)

    vi.restoreAllMocks()
    expect(guestFetchClass(klass.id)).not.toBeNull()
    expect(guestFetchDocuments(klass.id)).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------

describe('guestExportJson', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('contains every class and every document, and parses', () => {
    const biology = guestCreateClass(input)
    const history = guestCreateClass({ ...input, name: 'History 210' })
    const lecture = guestCreateDocument(biology.id, 'Lecture 1')
    guestSaveDocument({
      documentId: lecture.id,
      title: 'Lecture 1',
      content: doc('Mitochondria'),
      expectedVersion: lecture.version,
      starred: true,
    })
    guestCreateDocument(history.id, 'Seminar')

    const parsed = JSON.parse(guestExportJson()) as GuestExport

    expect(parsed.format).toBe('margin.guest-export')
    expect(parsed.classes.map((row) => row.name).sort()).toEqual(['Biology 101', 'History 210'])
    expect(parsed.documents).toHaveLength(2)
    expect(parsed.documents.find((row) => row.id === lecture.id)).toMatchObject({
      title: 'Lecture 1',
      content_text: 'Mitochondria',
      starred: true,
    })
  })

  it('names the file with the date, so repeated exports do not collide', () => {
    expect(guestExportFilename()).toMatch(/^margin-notes-\d{4}-\d{2}-\d{2}\.json$/)
  })
})

// ---------------------------------------------------------------------------
// migration ledger
// ---------------------------------------------------------------------------

describe('migration ledger', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('round-trips, and starts empty for a different account', () => {
    writeMigrationLedger({
      userId: 'user-1',
      classes: { 'local-1': 'remote-1' },
      documents: {},
    })

    expect(readMigrationLedger('user-1').classes).toEqual({ 'local-1': 'remote-1' })
    expect(readMigrationLedger('user-2').classes).toEqual({})
  })

  it('is best effort: a refused write does not throw', () => {
    failAllWrites(QUOTA)
    expect(() =>
      writeMigrationLedger({ userId: 'user-1', classes: {}, documents: {} }),
    ).not.toThrow()
  })

  it('is cleared along with the data it describes', () => {
    guestCreateClass(input)
    writeMigrationLedger({ userId: 'user-1', classes: { a: 'b' }, documents: {} })

    guestClear()

    expect(readMigrationLedger('user-1').classes).toEqual({})
  })
})
