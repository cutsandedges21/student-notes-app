import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MoveNoteDialog } from './MoveNoteDialog'
import type { ClassWithCount } from '../types/database'

/**
 * Choosing where a note goes.
 *
 * The two rules worth pinning: the class it is already in is not offered, and
 * a single-class account is told why there is nothing to choose rather than
 * shown an empty menu.
 */

const klass = (id: string, name: string): ClassWithCount =>
  ({ id, name, slug: name.toLowerCase(), note_count: 0 }) as ClassWithCount

function setup(classes: ClassWithCount[], onMove = vi.fn()) {
  render(
    <MoveNoteDialog
      open
      noteTitle="Lecture 5"
      currentClassId="c1"
      loadClasses={() => Promise.resolve(classes)}
      onMove={onMove}
      onClose={vi.fn()}
    />,
  )
  return { onMove }
}

describe('MoveNoteDialog', () => {
  it('names the note being moved', async () => {
    setup([klass('c1', 'Biology'), klass('c2', 'Chemistry')])

    expect(await screen.findByText(/Lecture 5/)).toBeVisible()
  })

  it('offers the other classes', async () => {
    setup([klass('c1', 'Biology'), klass('c2', 'Chemistry'), klass('c3', 'Physics')])

    await waitFor(() => expect(screen.getByLabelText('Move to')).toBeVisible())
    expect(screen.getByRole('option', { name: 'Chemistry' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Physics' })).toBeInTheDocument()
  })

  /** "Move it to where it already is" is not an option worth offering. */
  it('does not offer the class it is already in', async () => {
    setup([klass('c1', 'Biology'), klass('c2', 'Chemistry')])

    await waitFor(() => expect(screen.getByLabelText('Move to')).toBeVisible())
    expect(screen.queryByRole('option', { name: 'Biology' })).toBeNull()
  })

  /** The ordinary case for a new account, and "move" has no meaning in it. */
  it('explains itself when there is nowhere else to go', async () => {
    setup([klass('c1', 'Biology')])

    expect(await screen.findByText(/nowhere else to put it yet/)).toBeVisible()
    expect(screen.queryByLabelText('Move to')).toBeNull()
  })

  it('will not move until somewhere has been chosen', async () => {
    const { onMove } = setup([klass('c1', 'Biology'), klass('c2', 'Chemistry')])

    await waitFor(() => expect(screen.getByLabelText('Move to')).toBeVisible())
    expect(screen.getByRole('button', { name: 'Move' })).toBeDisabled()
    expect(onMove).not.toHaveBeenCalled()
  })

  it('moves to the chosen class', async () => {
    const { onMove } = setup([klass('c1', 'Biology'), klass('c2', 'Chemistry')])

    await waitFor(() => expect(screen.getByLabelText('Move to')).toBeVisible())
    await userEvent.selectOptions(screen.getByLabelText('Move to'), 'c2')
    await userEvent.click(screen.getByRole('button', { name: 'Move' }))

    expect(onMove).toHaveBeenCalledWith('c2')
  })

  it('says so when the classes could not be loaded', async () => {
    render(
      <MoveNoteDialog
        open
        noteTitle="Lecture 5"
        currentClassId="c1"
        loadClasses={() => Promise.reject(new Error('offline'))}
        onMove={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(await screen.findByRole('alert')).toBeVisible()
  })
})
