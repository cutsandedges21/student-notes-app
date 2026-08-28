import { describe, it, expect, vi, beforeEach } from 'vitest'
import { migrateGuestData } from './migrateGuestData'
import { guestCreateClass, guestCreateDocument, guestHasData } from './guestStore'

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

    const [, title, content] = createDocument.mock.calls[0]
    expect(title).toBe('Lecture 1')
    expect(content).toEqual(doc.content)
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
})
