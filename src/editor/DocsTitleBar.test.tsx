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
