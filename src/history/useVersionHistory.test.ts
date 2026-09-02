import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { editorExtensions } from '../editor/extensions'

vi.mock('../lib/supabase', () => ({ supabase: {}, isSupabaseConfigured: true }))

vi.mock('../services/versions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/versions')>()
  return {
    ...actual,
    listVersions: vi.fn(),
    fetchVersion: vi.fn(),
    createVersion: vi.fn(),
  }
})

import { createVersion, fetchVersion, listVersions } from '../services/versions'
import { useVersionHistory } from './useVersionHistory'

const listVersionsMock = vi.mocked(listVersions)
const fetchVersionMock = vi.mocked(fetchVersion)
const createVersionMock = vi.mocked(createVersion)

/**
 * The version-history controller.
 *
 * The tests that matter here are about restore: that the note as it stands is
 * captured before it is replaced, and -- more importantly -- that a failure to
 * capture it stops the restore. Losing the current draft in order to bring
 * back an older one is the single worst thing this feature could do.
 */

const VERSION = {
  id: 'v1',
  documentId: 'doc-1',
  createdBy: 'ai' as const,
  createdAt: '2026-08-01T10:00:00.000Z',
}

const OLDER = {
  id: 'v2',
  documentId: 'doc-1',
  createdBy: 'user' as const,
  createdAt: '2026-07-01T10:00:00.000Z',
}

let editor: Editor

function setup(overrides: Record<string, unknown> = {}) {
  editor = new Editor({ extensions: editorExtensions, content: '<p>Current draft</p>' })
  const onRestored = vi.fn()

  const hook = renderHook(() =>
    useVersionHistory({
      documentId: 'doc-1',
      userId: 'user-1',
      editor,
      active: true,
      currentContent: () => editor.getJSON(),
      onRestored,
      ...overrides,
    }),
  )
  return { ...hook, onRestored }
}

beforeEach(() => {
  vi.clearAllMocks()
  listVersionsMock.mockResolvedValue([VERSION, OLDER])
  createVersionMock.mockResolvedValue(undefined)
})

describe('useVersionHistory', () => {
  it('lists versions once the panel is looked at', async () => {
    const { result } = setup()

    await waitFor(() => expect(result.current.versions).toHaveLength(2))
    expect(listVersionsMock).toHaveBeenCalledWith('doc-1')
  })

  /** Every note has history; almost no session reads it. */
  it('fetches nothing while the panel is closed', async () => {
    setup({ active: false })

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(listVersionsMock).not.toHaveBeenCalled()
  })

  it('fetches nothing when signed out', async () => {
    setup({ userId: null })

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(listVersionsMock).not.toHaveBeenCalled()
  })

  it('reports a failure to list rather than showing an empty history', async () => {
    listVersionsMock.mockRejectedValue(new Error('network down'))
    const { result } = setup()

    await waitFor(() => expect(result.current.error).not.toBeNull())
  })

  describe('restore', () => {
    beforeEach(() => {
      fetchVersionMock.mockResolvedValue({
        ...VERSION,
        content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The old version' }] }] },
      })
    })

    it('puts the stored version into the editor', async () => {
      const { result } = setup()
      await waitFor(() => expect(result.current.versions).toHaveLength(2))

      act(() => result.current.restore('v1'))

      await waitFor(() => expect(editor.state.doc.textContent).toBe('The old version'))
    })

    /**
     * History is insert-only by policy, and restoring adds to it rather than
     * rewinding it -- so restoring the wrong version is itself recoverable.
     */
    it('keeps the current note as a version first', async () => {
      const { result } = setup()
      await waitFor(() => expect(result.current.versions).toHaveLength(2))

      act(() => result.current.restore('v1'))

      await waitFor(() => expect(createVersionMock).toHaveBeenCalled())
      const [, documentId, content, origin] = createVersionMock.mock.calls[0]
      expect(documentId).toBe('doc-1')
      expect(origin).toBe('user')
      expect(JSON.stringify(content)).toContain('Current draft')
    })

    it('snapshots before it replaces, not after', async () => {
      const order: string[] = []
      createVersionMock.mockImplementation(async () => {
        order.push(`snapshot:${editor.state.doc.textContent}`)
      })

      const { result } = setup()
      await waitFor(() => expect(result.current.versions).toHaveLength(2))

      act(() => result.current.restore('v1'))
      await waitFor(() => expect(editor.state.doc.textContent).toBe('The old version'))

      // The snapshot has to have captured the draft, not the restored version.
      expect(order[0]).toBe('snapshot:Current draft')
    })

    /** The worst outcome available: losing the draft to recover an old one. */
    it('does not replace the note when the snapshot fails', async () => {
      createVersionMock.mockRejectedValue(new Error('network down'))
      const { result } = setup()
      await waitFor(() => expect(result.current.versions).toHaveLength(2))

      act(() => result.current.restore('v1'))

      await waitFor(() => expect(result.current.error).not.toBeNull())
      expect(editor.state.doc.textContent).toBe('Current draft')
    })

    it('leaves the note alone when the version cannot be read', async () => {
      fetchVersionMock.mockRejectedValue(new Error('gone'))
      const { result } = setup()
      await waitFor(() => expect(result.current.versions).toHaveLength(2))

      act(() => result.current.restore('v1'))

      await waitFor(() => expect(result.current.error).not.toBeNull())
      expect(editor.state.doc.textContent).toBe('Current draft')
      expect(createVersionMock).not.toHaveBeenCalled()
    })

    it('refuses a version this editor has no schema for', async () => {
      fetchVersionMock.mockResolvedValue({
        ...VERSION,
        content: { type: 'doc', content: [{ type: 'nodeFromTheFuture' }] },
      })
      const { result } = setup()
      await waitFor(() => expect(result.current.versions).toHaveLength(2))

      act(() => result.current.restore('v1'))

      await waitFor(() => expect(result.current.error).toContain('older version'))
      expect(editor.state.doc.textContent).toBe('Current draft')
    })
  })

  describe('saving a version by hand', () => {
    it('writes the note as it stands, marked as the writer’s', async () => {
      const { result } = setup()
      await waitFor(() => expect(result.current.versions).toHaveLength(2))

      act(() => result.current.saveVersion())

      await waitFor(() => expect(createVersionMock).toHaveBeenCalled())
      expect(createVersionMock.mock.calls[0][3]).toBe('user')
    })

    it('reports a failure instead of implying it was kept', async () => {
      createVersionMock.mockRejectedValue(new Error('network down'))
      const { result } = setup()
      await waitFor(() => expect(result.current.versions).toHaveLength(2))

      act(() => result.current.saveVersion())

      await waitFor(() => expect(result.current.error).not.toBeNull())
    })
  })
})
