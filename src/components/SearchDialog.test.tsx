import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../lib/supabase', () => ({ supabase: {}, isSupabaseConfigured: true }))

const navigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}))

vi.mock('../services/search', () => ({ searchNotes: vi.fn() }))

import { searchNotes } from '../services/search'
import { SearchDialog } from './SearchDialog'
import type { SearchHit } from '../services/searchResults'

const searchNotesMock = vi.mocked(searchNotes)

/**
 * Search across every note.
 *
 * The behaviour worth pinning is what happens between keystrokes: a slower
 * earlier request must not land on top of a newer answer, and the list on
 * screen must never belong to a query other than the one in the box -- someone
 * pressing Enter would otherwise open a note they were no longer looking at.
 */

const hit = (over: Partial<SearchHit> = {}): SearchHit => ({
  documentId: 'd1',
  title: 'Osmosis',
  classId: 'c1',
  className: 'Biology',
  classSlug: 'biology',
  slug: 'osmosis',
  snippet: 'water moves across the membrane',
  inTitle: true,
  ...over,
})

function setup() {
  const onClose = vi.fn()
  render(
    <MemoryRouter>
      <SearchDialog open userId="user-1" onClose={onClose} />
    </MemoryRouter>,
  )
  return { onClose, user: userEvent.setup() }
}

const box = () => screen.getByRole('searchbox', { name: 'Search your notes' })

beforeEach(() => {
  vi.clearAllMocks()
  searchNotesMock.mockResolvedValue([hit()])
})

describe('SearchDialog', () => {
  it('does not search on a single character', async () => {
    const { user } = setup()

    await user.type(box(), 'o')

    await waitFor(() => expect(screen.getByText(/at least 2 characters/i)).toBeVisible())
    expect(searchNotesMock).not.toHaveBeenCalled()
  })

  it('finds notes and shows which class they are in', async () => {
    const { user } = setup()

    await user.type(box(), 'osmosis')

    expect(await screen.findByText('Osmosis')).toBeVisible()
    expect(screen.getByText('Biology')).toBeVisible()
    expect(screen.getByText('water moves across the membrane')).toBeVisible()
  })

  it('opens a note, addressed by its immutable id', async () => {
    const { user, onClose } = setup()

    await user.type(box(), 'osmosis')
    await user.click(await screen.findByRole('button', { name: /Osmosis/ }))

    expect(navigate).toHaveBeenCalledWith('/classes/biology/osmosis--d1')
    expect(onClose).toHaveBeenCalled()
  })

  it('opens the highlighted note on Enter', async () => {
    searchNotesMock.mockResolvedValue([hit(), hit({ documentId: 'd2', title: 'Cells', slug: 'cells' })])
    const { user } = setup()

    await user.type(box(), 'cell')
    await screen.findByText('Cells')

    await user.keyboard('{ArrowDown}{Enter}')

    expect(navigate).toHaveBeenCalledWith('/classes/biology/cells--d2')
  })

  it('wraps around the ends of the list', async () => {
    searchNotesMock.mockResolvedValue([hit(), hit({ documentId: 'd2', title: 'Cells', slug: 'cells' })])
    const { user } = setup()

    await user.type(box(), 'cell')
    await screen.findByText('Cells')

    // Up from the first entry lands on the last.
    await user.keyboard('{ArrowUp}{Enter}')

    expect(navigate).toHaveBeenCalledWith('/classes/biology/cells--d2')
  })

  it('says so when nothing matches, rather than showing an empty box', async () => {
    searchNotesMock.mockResolvedValue([])
    const { user } = setup()

    await user.type(box(), 'quantum')

    expect(await screen.findByText(/No notes match/)).toBeVisible()
  })

  it('reports a failure instead of an empty result', async () => {
    searchNotesMock.mockRejectedValue(new Error('network down'))
    const { user } = setup()

    await user.type(box(), 'osmosis')

    expect(await screen.findByRole('alert')).toBeVisible()
  })

  /**
   * The reason results are keyed to their query. Without it there is a render
   * where the previous query's notes sit under the new one, and Enter opens a
   * note the student was no longer looking at.
   */
  it('never shows results belonging to a different query', async () => {
    searchNotesMock.mockResolvedValue([hit({ title: 'Osmosis' })])
    const { user } = setup()

    await user.type(box(), 'osmosis')
    await screen.findByText('Osmosis')

    // Typing on makes the shown results stale; they must go, not linger.
    searchNotesMock.mockImplementation(() => new Promise(() => {}))
    await user.type(box(), 'x')

    await waitFor(() => expect(screen.queryByText('Osmosis')).toBeNull())
  })

  it('closes', async () => {
    const { user, onClose } = setup()

    await user.click(screen.getByRole('button', { name: 'Close search' }))

    expect(onClose).toHaveBeenCalled()
  })
})
