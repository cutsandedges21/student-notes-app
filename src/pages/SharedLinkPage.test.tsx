import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Session, User } from '@supabase/supabase-js'
import SharedLinkPage from './SharedLinkPage'

/*
 * A share link is now the only way into a shared note, so every way it can
 * fail is a way somebody is locked out of a document they were invited to.
 *
 * The three outcomes are deliberately different. An unknown, revoked or
 * switched-off link is one indistinguishable answer, because telling them
 * apart tells a stranger which notes exist. A failure to record the grant is
 * not that: the link is real, the fault is ours, and reporting it as "this
 * link isn't available" blames the link and leaves the person nothing to do.
 */

const TOKEN = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const DOC = '11111111-2222-4333-8444-555555555555'

const auth = vi.hoisted(() => ({ user: null as User | null, loading: false }))
const api = vi.hoisted(() => ({
  fetchSharedDocument: vi.fn(),
  redeemShareToken: vi.fn(),
}))

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: auth.user, loading: auth.loading, session: auth.user ? ({} as Session) : null }),
}))

vi.mock('../services/sharing', () => ({
  fetchSharedDocument: api.fetchSharedDocument,
  redeemShareToken: api.redeemShareToken,
}))

const signedInAs = (id: string) => ({ id }) as User

const sharedNote = (ownerId: string) => ({
  id: DOC,
  class_id: 'class-1',
  class_name: 'Biology 101',
  class_slug: 'biology-101',
  slug: 'lecture-1',
  title: 'Lecture 1',
  content: { type: 'doc', content: [] },
  version: 1,
  share_mode: 'edit' as const,
  owner_id: ownerId,
})

/** Renders the page and reports wherever it navigated to. */
function open() {
  render(
    <MemoryRouter initialEntries={[`/shared/${TOKEN}`]}>
      <Routes>
        <Route path="/shared/:token" element={<SharedLinkPage />} />
        <Route path="/notes/:noteRef" element={<div>EDITOR /notes</div>} />
        <Route
          path="/classes/:classSlug/:noteRef"
          element={<div>EDITOR /classes</div>}
        />
        <Route path="/classes" element={<div>MY NOTES</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  auth.user = null
  auth.loading = false
  api.fetchSharedDocument.mockReset()
  api.redeemShareToken.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('SharedLinkPage', () => {
  it('asks a signed-out visitor to sign in, and comes back here afterwards', async () => {
    api.fetchSharedDocument.mockResolvedValue(sharedNote('owner-1'))
    open()

    expect(await screen.findByText(/was shared with you/)).toBeInTheDocument()
    const signIn = screen.getByRole('link', { name: 'Sign in' })
    expect(signIn).toHaveAttribute('href', `/login?next=%2Fshared%2F${TOKEN}`)
    // Nothing is granted to somebody with no account to grant it to.
    expect(api.redeemShareToken).not.toHaveBeenCalled()
  })

  /*
   * The point of the whole change: a collaborator lands in the real editor, at
   * the note's own address, rather than in a read-only imitation of one.
   */
  it('redeems the link and sends a collaborator into the editor', async () => {
    auth.user = signedInAs('visitor-1')
    api.fetchSharedDocument.mockResolvedValue(sharedNote('owner-1'))
    api.redeemShareToken.mockResolvedValue({ documentId: DOC, mode: 'edit' })

    open()

    expect(await screen.findByText('EDITOR /notes')).toBeInTheDocument()
    expect(api.redeemShareToken).toHaveBeenCalledWith(TOKEN)
  })

  it('sends the owner to their own note, without granting them anything', async () => {
    auth.user = signedInAs('owner-1')
    api.fetchSharedDocument.mockResolvedValue(sharedNote('owner-1'))

    open()

    expect(await screen.findByText('EDITOR /classes')).toBeInTheDocument()
    expect(api.redeemShareToken).not.toHaveBeenCalled()
  })

  it('gives one answer for an unknown, revoked or switched-off link', async () => {
    auth.user = signedInAs('visitor-1')
    api.fetchSharedDocument.mockResolvedValue(null)

    open()

    expect(await screen.findByText(/isn’t available/)).toBeInTheDocument()
  })

  /*
   * The regression this file was written for. Turning a failed redemption into
   * "this link isn't available" blames the link for a fault on our side, and
   * hides the reason from the only person who can report it.
   */
  describe('when the grant cannot be recorded', () => {
    beforeEach(() => {
      auth.user = signedInAs('visitor-1')
      api.fetchSharedDocument.mockResolvedValue(sharedNote('owner-1'))
    })

    it('says the fault is ours, and shows what went wrong', async () => {
      api.redeemShareToken.mockRejectedValue(new Error('permission denied for table'))

      open()

      expect(await screen.findByText(/Couldn’t open this note/)).toBeInTheDocument()
      expect(screen.getByText(/permission denied for table/)).toBeInTheDocument()
      expect(screen.queryByText(/isn’t available/)).not.toBeInTheDocument()
    })

    it('offers a retry that actually retries', async () => {
      api.redeemShareToken.mockRejectedValueOnce(new Error('network down'))
      open()
      await screen.findByText(/Couldn’t open this note/)

      api.redeemShareToken.mockResolvedValue({ documentId: DOC, mode: 'edit' })
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

      expect(await screen.findByText('EDITOR /notes')).toBeInTheDocument()
    })

    // A null grant with no error is the owner revoking mid-open, which is the
    // "not available" case rather than a fault.
    it('treats a silent refusal as the link being gone', async () => {
      api.redeemShareToken.mockResolvedValue(null)

      open()

      expect(await screen.findByText(/isn’t available/)).toBeInTheDocument()
    })
  })

  it('waits for the session before deciding anything', async () => {
    auth.loading = true
    api.fetchSharedDocument.mockResolvedValue(sharedNote('owner-1'))

    open()

    // Deciding while the session is still restoring would show a signed-in
    // visitor the sign-in prompt.
    await waitFor(() => expect(api.fetchSharedDocument).not.toHaveBeenCalled())
    expect(screen.queryByText(/was shared with you/)).not.toBeInTheDocument()
  })
})
