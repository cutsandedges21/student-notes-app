import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/supabase', () => ({ supabase: {}, isSupabaseConfigured: true }))

vi.mock('./documents', () => ({
  fetchDocument: vi.fn(),
  createDocument: vi.fn(),
  saveDocument: vi.fn(),
}))

import { createDocument, fetchDocument, saveDocument } from './documents'
import { duplicateDocument, moveDocument } from './documentActions'
import type { DocumentRow } from '../types/database'

const fetchDocumentMock = vi.mocked(fetchDocument)
const createDocumentMock = vi.mocked(createDocument)
const saveDocumentMock = vi.mocked(saveDocument)

/**
 * Copying a note, and filing it somewhere else.
 *
 * The interesting parts are what a copy deliberately does *not* carry, and
 * that a move keeps the note's id -- a move implemented as copy-and-delete
 * would break every link to it and orphan its comments.
 */

const source = {
  id: 'doc-1',
  class_id: 'class-1',
  user_id: 'user-1',
  title: 'Lecture 5',
  slug: 'lecture-5',
  content: { type: 'doc', content: [{ type: 'paragraph' }] },
  content_text: 'Body',
  header: { type: 'doc', content: [] },
  footer: { type: 'doc', content: [] },
  page_numbers: 'right',
  page_setup: { paper: 'a4', landscape: false, margins: { top: 96, right: 96, bottom: 96, left: 96 } },
  starred: true,
  version: 7,
  created_at: '',
  updated_at: '',
} as unknown as DocumentRow

beforeEach(() => {
  vi.clearAllMocks()
  fetchDocumentMock.mockResolvedValue(source)
  createDocumentMock.mockResolvedValue({ ...source, id: 'doc-2', slug: 'copy-of-lecture-5', version: 1 })
  saveDocumentMock.mockResolvedValue({ status: 'saved', version: 2 })
})

describe('duplicateDocument', () => {
  it('names the copy after the original', async () => {
    await duplicateDocument('user-1', 'doc-1')

    expect(createDocumentMock).toHaveBeenCalledWith('user-1', 'class-1', 'Copy of Lecture 5')
  })

  it('names an untitled copy something', async () => {
    fetchDocumentMock.mockResolvedValue({ ...source, title: '' })
    await duplicateDocument('user-1', 'doc-1')

    expect(createDocumentMock).toHaveBeenCalledWith('user-1', 'class-1', 'Untitled copy')
  })

  it('carries the writing, the furniture and the page setup', async () => {
    await duplicateDocument('user-1', 'doc-1')

    expect(saveDocumentMock.mock.calls[0][1]).toMatchObject({
      content: source.content,
      header: source.header,
      footer: source.footer,
      pageNumbers: 'right',
      pageSetup: source.page_setup,
    })
  })

  it('lands in the same class as the original', async () => {
    await duplicateDocument('user-1', 'doc-1')

    expect(createDocumentMock.mock.calls[0][1]).toBe('class-1')
  })

  /**
   * A copy is the writing and the settings. Version history, comments,
   * conversations and share tokens all hang off the note's id, and carrying
   * any of them would mean a copy that shares a conversation with its
   * original, or arrives with a share link the student never created.
   */
  it('goes through the ordinary create path rather than cloning the row', async () => {
    await duplicateDocument('user-1', 'doc-1')

    // A row insert would have skipped both of these, and with them the slug
    // and the denormalised text that search and the assistant read.
    expect(createDocumentMock).toHaveBeenCalled()
    expect(saveDocumentMock).toHaveBeenCalled()
  })

  it('refuses when the original is gone', async () => {
    fetchDocumentMock.mockResolvedValue(null)

    await expect(duplicateDocument('user-1', 'doc-1')).rejects.toThrow(/no longer exists/)
    expect(createDocumentMock).not.toHaveBeenCalled()
  })

  /** An empty copy the student has to notice is worse than a retryable error. */
  it('fails loudly when the body did not save', async () => {
    saveDocumentMock.mockResolvedValue({ status: 'stale' })

    await expect(duplicateDocument('user-1', 'doc-1')).rejects.toThrow(/did not save/)
  })
})

describe('moveDocument', () => {
  it('keeps the note’s id, so every link to it still works', async () => {
    await moveDocument('user-1', 'doc-1', 'class-2')

    expect(saveDocumentMock.mock.calls[0][1]).toMatchObject({ documentId: 'doc-1' })
    // Not a copy-and-delete: nothing new was made.
    expect(createDocumentMock).not.toHaveBeenCalled()
  })

  it('files it under the destination', async () => {
    await moveDocument('user-1', 'doc-1', 'class-2')

    expect(saveDocumentMock.mock.calls[0][1]).toMatchObject({ classId: 'class-2' })
  })

  /** Slugs are unique per class, and the destination has its own. */
  it('re-derives the slug for its new class', async () => {
    await moveDocument('user-1', 'doc-1', 'class-2')

    expect(saveDocumentMock.mock.calls[0][1]).toMatchObject({ reslug: true })
  })

  it('does nothing when it is already there', async () => {
    await moveDocument('user-1', 'doc-1', 'class-1')

    expect(saveDocumentMock).not.toHaveBeenCalled()
  })

  it('refuses when somebody else changed the note first', async () => {
    saveDocumentMock.mockResolvedValue({ status: 'stale' })

    await expect(moveDocument('user-1', 'doc-1', 'class-2')).rejects.toThrow(/Reopen it/)
  })

  it('refuses when the note is gone', async () => {
    fetchDocumentMock.mockResolvedValue(null)

    await expect(moveDocument('user-1', 'doc-1', 'class-2')).rejects.toThrow(/no longer exists/)
  })
})
