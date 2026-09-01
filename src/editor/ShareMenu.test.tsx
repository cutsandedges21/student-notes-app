import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'

/*
 * Two things are under test here, and they are different kinds of thing.
 *
 * "Reset link" is destructive and outward-facing: it invalidates a URL other
 * people are holding, and there is no undo, so the tests care that it cannot
 * happen from a single click and that cancelling really does nothing. The
 * access list is other people's names, so the tests care that it is not shown
 * to anyone but the owner.
 *
 * The last test is about copy rather than behaviour, which is unusual but
 * deliberate. The edit hint used to promise "best one person at a time"; the
 * risk in changing it is swapping one inaccurate promise for another, so the
 * claims it must NOT make are asserted alongside the ones it must.
 */

const OWNER = 'owner-1'

vi.mock('../lib/supabase', () => ({ supabase: {}, isSupabaseConfigured: true }))

const auth = vi.hoisted(() => ({
  session: null as Session | null,
}))

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ session: auth.session }),
}))

vi.mock('../services/sharing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/sharing')>()
  return {
    ...actual,
    fetchShareState: vi.fn(),
    setShareMode: vi.fn(),
    rotateShareToken: vi.fn(),
    listDocumentAccess: vi.fn(),
    revokeDocumentAccess: vi.fn(),
  }
})

import { ShareMenu } from './ShareMenu'
import {
  SHARE_MODE_HINTS,
  fetchShareState,
  listDocumentAccess,
  revokeDocumentAccess,
  rotateShareToken,
  type DocumentAccessEntry,
  setShareMode,
} from '../services/sharing'

const fetchShareStateMock = vi.mocked(fetchShareState)
const listDocumentAccessMock = vi.mocked(listDocumentAccess)
const revokeDocumentAccessMock = vi.mocked(revokeDocumentAccess)
const rotateShareTokenMock = vi.mocked(rotateShareToken)
const setShareModeMock = vi.mocked(setShareMode)

const signedInAs = (id: string) => ({ user: { id } }) as unknown as Session

const grant = (overrides: Partial<DocumentAccessEntry>): DocumentAccessEntry => ({
  userId: 'visitor-1',
  displayName: 'Sam Okafor',
  mode: 'edit',
  grantedAt: '2026-09-01T10:00:00.000Z',
  ...overrides,
})

async function openMenu(onModeChange?: (mode: 'private' | 'view' | 'edit') => void) {
  render(
    <MemoryRouter>
      <ShareMenu documentId="doc-1" onModeChange={onModeChange} />
    </MemoryRouter>,
  )
  await userEvent.click(screen.getByRole('button', { name: /share/i }))
  await screen.findByRole('menu', { name: 'Share' })
}

describe('ShareMenu', () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})

  beforeEach(() => {
    auth.session = signedInAs(OWNER)
    fetchShareStateMock.mockResolvedValue({
      mode: 'edit',
      token: 'token-original',
      ownerId: OWNER,
    })
    listDocumentAccessMock.mockResolvedValue([])
    rotateShareTokenMock.mockResolvedValue('token-fresh')
    revokeDocumentAccessMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.clearAllMocks()
    errors.mockClear()
  })

  it('shows the current link so there is something to compare against', async () => {
    await openMenu()

    expect(await screen.findByLabelText('Share link')).toHaveValue(
      'http://localhost:3000/shared/token-original',
    )
  })

  /* ----------------------------------------------------------------------
   * Resetting the link
   * -------------------------------------------------------------------- */

  it('asks before resetting the link rather than doing it on the click', async () => {
    await openMenu()
    await userEvent.click(await screen.findByRole('button', { name: 'Reset link' }))

    const dialog = await screen.findByRole('dialog')
    expect(rotateShareTokenMock).not.toHaveBeenCalled()
    expect(dialog).toHaveTextContent(/loses access straight away/i)
    // The cost has to be stated, not implied by the word "reset".
    expect(dialog).toHaveTextContent(/old address stops working/i)
  })

  it('does nothing at all when the confirmation is declined', async () => {
    await openMenu()
    await userEvent.click(await screen.findByRole('button', { name: 'Reset link' }))
    await userEvent.click(
      await screen.findByRole('button', { name: 'Keep the current link' }),
    )

    expect(rotateShareTokenMock).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByLabelText('Share link')).toHaveValue(
      'http://localhost:3000/shared/token-original',
    )
  })

  it('rotates once confirmed, and shows the new link rather than the dead one', async () => {
    await openMenu()
    await userEvent.click(await screen.findByRole('button', { name: 'Reset link' }))
    await userEvent.click(
      await screen.findByRole('button', { name: 'Reset link and remove everyone' }),
    )

    await waitFor(() =>
      expect(rotateShareTokenMock).toHaveBeenCalledExactlyOnceWith('doc-1'),
    )
    await waitFor(() =>
      expect(screen.getByLabelText('Share link')).toHaveValue(
        'http://localhost:3000/shared/token-fresh',
      ),
    )
  })

  it('re-reads who has access after rotating, rather than assuming', async () => {
    listDocumentAccessMock.mockResolvedValue([grant({})])
    await openMenu()
    await screen.findByText('Sam Okafor')

    listDocumentAccessMock.mockResolvedValue([])
    await userEvent.click(screen.getByRole('button', { name: 'Reset link' }))
    await userEvent.click(
      await screen.findByRole('button', { name: 'Reset link and remove everyone' }),
    )

    await waitFor(() => expect(screen.queryByText('Sam Okafor')).toBeNull())
  })

  it('keeps the old link on screen when the reset fails', async () => {
    rotateShareTokenMock.mockRejectedValue(new Error('network'))
    await openMenu()
    await userEvent.click(await screen.findByRole('button', { name: 'Reset link' }))
    await userEvent.click(
      await screen.findByRole('button', { name: 'Reset link and remove everyone' }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /the current link still works/i,
    )
    expect(screen.getByLabelText('Share link')).toHaveValue(
      'http://localhost:3000/shared/token-original',
    )
  })

  /* ----------------------------------------------------------------------
   * Who has access
   * -------------------------------------------------------------------- */

  it('lists who was let in, and on what terms', async () => {
    listDocumentAccessMock.mockResolvedValue([
      grant({ userId: 'visitor-1', displayName: 'Sam Okafor', mode: 'edit' }),
      grant({ userId: 'visitor-2', displayName: 'Rae Lindqvist', mode: 'view' }),
    ])

    await openMenu()

    const list = await screen.findByRole('list')
    const entries = within(list).getAllByRole('listitem')
    expect(entries).toHaveLength(2)
    expect(entries[0]).toHaveTextContent('Sam Okafor')
    expect(entries[0]).toHaveTextContent('Can edit')
    expect(entries[1]).toHaveTextContent('Rae Lindqvist')
    expect(entries[1]).toHaveTextContent('Can view')
  })

  it('removes one person on request, and re-reads the list', async () => {
    listDocumentAccessMock.mockResolvedValue([grant({})])
    await openMenu()
    await screen.findByText('Sam Okafor')

    listDocumentAccessMock.mockResolvedValue([])
    await userEvent.click(screen.getByRole('button', { name: 'Remove Sam Okafor' }))

    await waitFor(() =>
      expect(revokeDocumentAccessMock).toHaveBeenCalledExactlyOnceWith('doc-1', 'visitor-1'),
    )
    await waitFor(() => expect(screen.queryByText('Sam Okafor')).toBeNull())
  })

  // Other people's names, and a button that takes their access away. Someone
  // reading a note they were shared has no business with either.
  it('shows the list to nobody but the owner', async () => {
    auth.session = signedInAs('somebody-else')
    listDocumentAccessMock.mockResolvedValue([grant({})])

    await openMenu()
    await screen.findByLabelText('Share link')

    expect(screen.queryByText('People with access')).toBeNull()
    expect(screen.queryByText('Sam Okafor')).toBeNull()
    expect(listDocumentAccessMock).not.toHaveBeenCalled()
  })

  // "Nobody has access" and "we could not find out" are different answers, and
  // only one of them means the reset button is unnecessary.
  it('does not report an empty list when it failed to load one', async () => {
    listDocumentAccessMock.mockRejectedValue(new Error('network'))

    await openMenu()

    expect(await screen.findByText(/couldn’t load who has access/i)).toBeInTheDocument()
    expect(screen.queryByText(/nobody has opened the link yet/i)).toBeNull()
  })

  /*
   * Live editing is gated on the page knowing the note is shared for editing.
   *
   * This menu used to keep the mode entirely to itself, so turning sharing on
   * changed nothing until a reload: the switch flipped, the link worked, and
   * the owner's own editor stayed single-writer. Reporting the mode upward is
   * the whole fix, so it is what these assert.
   */
  describe('reporting the mode to the page', () => {
    it('reports the mode it read, so an already-shared note collaborates', async () => {
      const onModeChange = vi.fn()
      await openMenu(onModeChange)

      await waitFor(() => expect(onModeChange).toHaveBeenCalledWith('edit'))
    })

    it('reports a change the moment it is made, not on the next reload', async () => {
      fetchShareStateMock.mockResolvedValue({
        mode: 'private',
        token: 'token-original',
        ownerId: OWNER,
      })
      const onModeChange = vi.fn()
      await openMenu(onModeChange)
      await waitFor(() => expect(onModeChange).toHaveBeenCalledWith('private'))

      setShareModeMock.mockResolvedValue(undefined)
      await userEvent.click(
        screen.getByRole('menuitemradio', { name: /can edit/i }),
      )

      await waitFor(() => expect(onModeChange).toHaveBeenLastCalledWith('edit'))
    })

    it('does not claim a change that failed to save', async () => {
      const onModeChange = vi.fn()
      await openMenu(onModeChange)
      await waitFor(() => expect(onModeChange).toHaveBeenCalled())
      onModeChange.mockClear()

      setShareModeMock.mockRejectedValue(new Error('network down'))
      await userEvent.click(
        screen.getByRole('menuitemradio', { name: /restricted/i }),
      )

      await waitFor(() => expect(screen.getByText(/could not update sharing/i)).toBeVisible())
      expect(onModeChange).not.toHaveBeenCalled()
    })
  })

  it('says plainly that an unused link has let nobody in', async () => {
    await openMenu()
    expect(await screen.findByText(/nobody has opened the link yet/i)).toBeInTheDocument()
  })

  /* ----------------------------------------------------------------------
   * The copy
   * -------------------------------------------------------------------- */

  describe('the edit hint', () => {
    it('is shown where the mode is chosen', async () => {
      await openMenu()
      expect(screen.getByText(SHARE_MODE_HINTS.edit)).toBeInTheDocument()
    })

    // The two rules the database actually enforces, and the reason the hint
    // was rewritten at all.
    it('says that editing needs an account and that signing out means read-only', () => {
      expect(SHARE_MODE_HINTS.edit).toMatch(/needs an account/i)
      expect(SHARE_MODE_HINTS.edit).toMatch(/signs? in/i)
      expect(SHARE_MODE_HINTS.edit).toMatch(/signed out can only read/i)
    })

    it('no longer tells people to take turns', () => {
      expect(SHARE_MODE_HINTS.edit).not.toMatch(/one person at a time/i)
      expect(SHARE_MODE_HINTS.edit).not.toMatch(/which version to keep/i)
    })

    /*
     * The guard against replacing one false promise with another. Whether
     * edits merge live is decided by the editor's collaboration wiring, not by
     * this layer, so this layer must not claim it. If that wiring is verified
     * end-to-end later, this test is the thing to change first -- on purpose.
     */
    it('promises no merge behaviour it is not in a position to guarantee', () => {
      expect(SHARE_MODE_HINTS.edit).not.toMatch(/real[- ]time/i)
      expect(SHARE_MODE_HINTS.edit).not.toMatch(/\bmerges?\b/i)
      expect(SHARE_MODE_HINTS.edit).not.toMatch(/\blive\b/i)
      expect(SHARE_MODE_HINTS.edit).not.toMatch(/simultaneous/i)
    })

    it('still says a view link needs no account', () => {
      expect(SHARE_MODE_HINTS.view).toMatch(/not required/i)
    })
  })

  it('offers no sharing at all to a signed-out user, and explains why', async () => {
    auth.session = null

    render(
      <MemoryRouter>
        <ShareMenu documentId="doc-1" />
      </MemoryRouter>,
    )
    await userEvent.click(screen.getByRole('button', { name: /share/i }))

    expect(await screen.findByText(/sign in to share this note/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reset link' })).toBeNull()
    expect(fetchShareStateMock).not.toHaveBeenCalled()
  })
})
