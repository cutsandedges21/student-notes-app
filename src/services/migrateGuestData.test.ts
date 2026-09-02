import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  DOCUMENT_FIELD_PLAN,
  migrateGuestData,
  toMigrationDocument,
} from './migrateGuestData'
import {
  guestCreateClass,
  guestCreateDocument,
  guestHasData,
  guestSaveDocument,
} from './guestStore'

vi.mock('../lib/supabase', () => ({ supabase: {} }))

const input = {
  name: 'Biology 101',
  course_code: 'BIO 101',
  professor: 'Dr. Chen',
  semester: 'Fall 2026',
  course_level: 'College' as const,
}

describe('migrateGuestData', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('does nothing when there is no guest data', async () => {
    const createClass = vi.fn()
    const createDocument = vi.fn()

    const result = await migrateGuestData('user-1', { createClass, createDocument })

    expect(result).toEqual({ migrated: false, classes: 0, documents: 0 })
    expect(createClass).not.toHaveBeenCalled()
  })

  it('copies classes and their notes into the account, then clears local data', async () => {
    const klass = guestCreateClass(input)
    guestCreateDocument(klass.id, 'Lecture 1')
    guestCreateDocument(klass.id, 'Lecture 2')

    const createClass = vi.fn().mockResolvedValue({ id: 'remote-class-1' })
    const createDocument = vi.fn().mockResolvedValue({ id: 'remote-doc' })

    const result = await migrateGuestData('user-1', { createClass, createDocument })

    expect(result).toEqual({ migrated: true, classes: 1, documents: 2 })
    expect(createClass).toHaveBeenCalledOnce()
    expect(createDocument).toHaveBeenCalledTimes(2)

    // Notes must land under the NEW remote class id, not the local one.
    expect(createDocument.mock.calls[0][0]).toBe('remote-class-1')

    expect(guestHasData()).toBe(false)
  })

  it('carries note content across, not just the title', async () => {
    const klass = guestCreateClass(input)
    const doc = guestCreateDocument(klass.id, 'Lecture 1')

    const createClass = vi.fn().mockResolvedValue({ id: 'remote-class-1' })
    const createDocument = vi.fn().mockResolvedValue({ id: 'remote-doc' })

    await migrateGuestData('user-1', { createClass, createDocument })

    const [, payload] = createDocument.mock.calls[0]
    expect(payload.title).toBe('Lecture 1')
    expect(payload.content).toEqual(doc.content)
  })

  /*
   * The bug this guards: the migration carried a hand-written subset of columns
   * and the subset fell behind the row. header, footer and page_numbers all
   * shipped after it was written, and all three were silently dropped on the
   * way into an account -- a student signed up and their page furniture was
   * gone, with nothing reporting a failure.
   */
  it('carries every field the row plan marks as migrated', async () => {
    const klass = guestCreateClass(input)
    const doc = guestCreateDocument(klass.id, 'Lecture 1')

    const header = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'BIO 101' }] }] }
    const footer = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Sam' }] }] }
    const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Mitochondria' }] }] }

    const saved = guestSaveDocument({
      documentId: doc.id,
      title: 'Lecture 1 — revised',
      content,
      expectedVersion: doc.version,
      header,
      footer,
      pageNumbers: 'right',
      starred: true,
      pageSetup: { paper: 'a4', landscape: true, margins: { top: 48, right: 48, bottom: 48, left: 48 } },
    })
    expect(saved.status).toBe('saved')

    const createClass = vi.fn().mockResolvedValue({ id: 'remote-class-1' })
    const createDocument = vi.fn().mockResolvedValue({ id: 'remote-doc' })

    await migrateGuestData('user-1', { createClass, createDocument })

    const [, payload] = createDocument.mock.calls[0]
    expect(payload).toEqual({
      title: 'Lecture 1 — revised',
      content,
      header,
      footer,
      pageNumbers: 'right',
      starred: true,
      // Carried opaquely: the destination validates it when the note opens,
      // and a paper size chosen as a guest should survive signing in.
      pageSetup: { paper: 'a4', landscape: true, margins: { top: 48, right: 48, bottom: 48, left: 48 } },
    })

    // The class carries its own metadata, not just its name.
    expect(createClass.mock.calls[0][1]).toEqual(input)
  })

  /*
   * Every 'migrate' verdict in the plan must be represented in the payload
   * builder, and every other verdict must be justified rather than forgotten.
   * The Record type already forces a decision per column at compile time; this
   * checks the runtime payload actually honours it.
   */
  it('builds a payload containing exactly the fields planned as migrated', () => {
    const klass = guestCreateClass(input)
    const doc = guestCreateDocument(klass.id, 'Lecture 1')

    const planned = Object.entries(DOCUMENT_FIELD_PLAN)
      .filter(([, verdict]) => verdict === 'migrate')
      .map(([field]) => field)
      .sort()

    // page_numbers/starred are camelCased at the service boundary; compare on
    // the set of concepts rather than on the destination's spelling.
    const rename: Record<string, string> = {
      page_numbers: 'pageNumbers',
      page_setup: 'pageSetup',
    }
    const expected = planned.map((field) => rename[field] ?? field).sort()

    expect(Object.keys(toMigrationDocument(doc)).sort()).toEqual(expected)
  })

  // The critical safety property: if the network dies halfway, the user's only
  // copy of their notes is still in localStorage. Clearing regardless would
  // destroy work that never reached the server.
  it('keeps local data when migration fails partway', async () => {
    const klass = guestCreateClass(input)
    guestCreateDocument(klass.id, 'Lecture 1')

    const createClass = vi.fn().mockResolvedValue({ id: 'remote-class-1' })
    const createDocument = vi.fn().mockRejectedValue(new Error('network down'))

    const result = await migrateGuestData('user-1', { createClass, createDocument })

    expect(result.migrated).toBe(false)
    expect('error' in result && result.error).toBeTruthy()
    expect(guestHasData()).toBe(true)
  })

  /*
   * A retry after a partial failure used to run the whole migration again, so
   * everything the first attempt managed to write arrived a second time. The
   * ledger records each successful remote write against its local id; this is
   * what proves the ledger is actually consulted.
   */
  it('resumes rather than duplicating when a failed migration is retried', async () => {
    const klass = guestCreateClass(input)
    guestCreateDocument(klass.id, 'Lecture 1')
    guestCreateDocument(klass.id, 'Lecture 2')

    const createClass = vi.fn().mockResolvedValue({ id: 'remote-class-1' })
    // The first note lands; the second dies. The class and note one are now
    // across, and the local copy is deliberately still there.
    const failing = vi
      .fn()
      .mockResolvedValueOnce({ id: 'remote-doc-1' })
      .mockRejectedValueOnce(new Error('network down'))

    const first = await migrateGuestData('user-1', {
      createClass,
      createDocument: failing,
    })
    expect(first.migrated).toBe(false)
    expect(guestHasData()).toBe(true)
    expect(failing).toHaveBeenCalledTimes(2)

    const retry = vi.fn().mockResolvedValue({ id: 'remote-doc-2' })
    const second = await migrateGuestData('user-1', {
      createClass,
      createDocument: retry,
    })

    expect(second).toEqual({ migrated: true, classes: 1, documents: 2 })
    // The class was created once, on the first attempt, and reused on the second.
    expect(createClass).toHaveBeenCalledOnce()
    // Only the note that never made it is written again.
    expect(retry).toHaveBeenCalledOnce()
    expect(retry.mock.calls[0][1].title).toBe('Lecture 2')
    expect(guestHasData()).toBe(false)
  })

  // The ledger is keyed per account: migrating into a different account must
  // not skip rows because a previous account already took them.
  it('does not let one account’s ledger suppress another’s migration', async () => {
    const klass = guestCreateClass(input)
    guestCreateDocument(klass.id, 'Lecture 1')

    const createClass = vi.fn().mockResolvedValue({ id: 'remote-class-1' })
    const failing = vi.fn().mockRejectedValue(new Error('network down'))
    await migrateGuestData('user-1', { createClass, createDocument: failing })

    const other = vi.fn().mockResolvedValue({ id: 'remote-doc' })
    const otherClass = vi.fn().mockResolvedValue({ id: 'remote-class-2' })
    const result = await migrateGuestData('user-2', {
      createClass: otherClass,
      createDocument: other,
    })

    expect(result).toEqual({ migrated: true, classes: 1, documents: 1 })
    expect(otherClass).toHaveBeenCalledOnce()
    expect(other).toHaveBeenCalledOnce()
  })
})
