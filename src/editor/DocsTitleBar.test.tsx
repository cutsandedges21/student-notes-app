import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { DocsTitleBar } from './DocsTitleBar'

/**
 * The comment button in the chrome.
 *
 * It exists because the panel is closed by default: a note could hold an
 * entire discussion and say nothing about it anywhere on screen. The count is
 * the point of the button -- without it, finding out whether anyone had
 * commented meant opening a panel to look.
 */

vi.mock('../lib/supabase', () => ({ supabase: {}, isSupabaseConfigured: true }))

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    session: null,
    profile: { display_name: 'Ada' },
    signOut: vi.fn(),
  }),
}))

// The share menu makes its own network calls on mount and is not what is
// under test here.
vi.mock('./ShareMenu', () => ({ ShareMenu: () => null }))

function setup(props: Partial<Parameters<typeof DocsTitleBar>[0]> = {}) {
  const onOpenComments = vi.fn()
  render(
    <MemoryRouter>
      <DocsTitleBar
        documentId="doc-1"
        title="Cell biology"
        onTitleChange={vi.fn()}
        saveState="idle"
        backTo="/classes/bio"
        backLabel="Back to Biology"
        menubar={null}
        aiOpen={false}
        onToggleAi={vi.fn()}
        starred={false}
        onStarredChange={vi.fn()}
        onOpenComments={onOpenComments}
        {...props}
      />
    </MemoryRouter>,
  )
  return { onOpenComments }
}

beforeEach(() => localStorage.clear())

describe('DocsTitleBar comments', () => {
  it('shows the button with no count when nothing has been said', () => {
    setup({ commentCount: 0 })

    expect(screen.getByRole('button', { name: 'Comments' })).toBeVisible()
  })

  it('puts the number of open threads in the accessible name', () => {
    setup({ commentCount: 3 })

    expect(screen.getByRole('button', { name: 'Comments (3 open)' })).toBeVisible()
  })

  it('caps the badge so a long-running note does not deform the chrome', () => {
    setup({ commentCount: 42 })

    expect(screen.getByText('9+')).toBeVisible()
    // The real figure stays available to a screen reader.
    expect(screen.getByRole('button', { name: 'Comments (42 open)' })).toBeVisible()
  })

  it('opens the panel when pressed', async () => {
    const { onOpenComments } = setup({ commentCount: 1 })

    await userEvent.click(screen.getByRole('button', { name: 'Comments (1 open)' }))

    expect(onOpenComments).toHaveBeenCalledTimes(1)
  })

  /** Signed out with nothing to read, there is nothing for it to do. */
  it('is absent when no handler is given', () => {
    setup({ onOpenComments: undefined })

    expect(screen.queryByRole('button', { name: /comments/i })).toBeNull()
  })
})

/**
 * Starring.
 *
 * The migration that added `documents.starred` says why this matters: as a
 * localStorage flag a star was invisible on a second device, and a guest's
 * stars were dropped on the way into an account. The column, the guest store
 * and the migration all carried it; only this button did not.
 */
describe('DocsTitleBar starring', () => {
  it('shows the state it is given, not the state of this browser', () => {
    setup({ starred: true })

    expect(screen.getByRole('button', { name: 'Remove star' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('reports the new value upward rather than storing it locally', async () => {
    const onStarredChange = vi.fn()
    setup({ starred: false, onStarredChange })

    await userEvent.click(screen.getByRole('button', { name: 'Star' }))

    expect(onStarredChange).toHaveBeenCalledWith(true)
    // Nothing is written here; the note's row is the only record of it.
    expect(localStorage.getItem('margin:starred:doc-1')).toBeNull()
  })

  it('un-stars', async () => {
    const onStarredChange = vi.fn()
    setup({ starred: true, onStarredChange })

    await userEvent.click(screen.getByRole('button', { name: 'Remove star' }))

    expect(onStarredChange).toHaveBeenCalledWith(false)
  })

  /**
   * The old implementation read localStorage during render, keyed by document
   * id. A stale value left over from that era must not resurrect a star the
   * server says is gone.
   */
  it('ignores a leftover localStorage flag', () => {
    localStorage.setItem('margin:starred:doc-1', '1')

    setup({ starred: false })

    expect(screen.getByRole('button', { name: 'Star' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })
})
