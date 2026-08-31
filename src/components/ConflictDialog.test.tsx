import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConflictDialog } from './ConflictDialog'

/*
 * A save refused as stale used to be answered by loading the other side's
 * version over the top of whatever the writer had just typed, then reporting
 * "Saved". This dialog is what replaced that: neither version is discarded
 * until somebody chooses.
 *
 * The properties worth pinning down are that both choices are actually
 * offered, that neither fires on its own, and that there is no way out of the
 * dialog that is not a decision -- a dismissable conflict would have to pick
 * an answer silently, which is the behaviour being removed.
 */

describe('ConflictDialog', () => {
  const setup = () => {
    const onKeepMine = vi.fn()
    const onUseTheirs = vi.fn()
    render(
      <ConflictDialog open onKeepMine={onKeepMine} onUseTheirs={onUseTheirs} />,
    )
    return { onKeepMine, onUseTheirs }
  }

  it('renders nothing when closed', () => {
    const { container } = render(
      <ConflictDialog open={false} onKeepMine={vi.fn()} onUseTheirs={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('offers both versions and decides nothing by itself', () => {
    const { onKeepMine, onUseTheirs } = setup()

    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Keep what I wrote' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Use the other version instead' }),
    ).toBeInTheDocument()
    expect(onKeepMine).not.toHaveBeenCalled()
    expect(onUseTheirs).not.toHaveBeenCalled()
  })

  // The reassurance has to be true, and it is: the caller sets this state
  // without touching the editor.
  it('says plainly that nothing has been overwritten', () => {
    setup()
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/nothing has been overwritten/i)
  })

  it('spells out the cost of each choice', () => {
    setup()
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent(/saves your text over theirs/i)
    expect(dialog).toHaveTextContent(/discards what you have written/i)
  })

  it('reports keeping the local version', async () => {
    const { onKeepMine, onUseTheirs } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Keep what I wrote' }))

    expect(onKeepMine).toHaveBeenCalledOnce()
    expect(onUseTheirs).not.toHaveBeenCalled()
  })

  it('reports taking the remote version', async () => {
    const { onKeepMine, onUseTheirs } = setup()
    await userEvent.click(
      screen.getByRole('button', { name: 'Use the other version instead' }),
    )

    expect(onUseTheirs).toHaveBeenCalledOnce()
    expect(onKeepMine).not.toHaveBeenCalled()
  })

  // No backdrop click, no close button, no Escape: every exit is a decision.
  it('offers no dismissal that would silently pick a side', async () => {
    const { onKeepMine, onUseTheirs } = setup()

    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('alertdialog'))

    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(onKeepMine).not.toHaveBeenCalled()
    expect(onUseTheirs).not.toHaveBeenCalled()
  })

  it('names who saved when that is known', () => {
    render(
      <ConflictDialog open by="Sam" onKeepMine={vi.fn()} onUseTheirs={vi.fn()} />,
    )
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Sam saved a new version')
  })
})
