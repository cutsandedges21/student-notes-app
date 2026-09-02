import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SelectionToolbar } from './SelectionToolbar'

/**
 * The selection bar is where commenting became discoverable.
 *
 * A comment thread has to anchor to a selection, so the bar that appears on
 * selection is the only surface where the action is always available. Before
 * this it was reachable from one icon among thirty in the formatting toolbar,
 * which is a poor place to find a feature you do not already know exists.
 */

const AT = { top: 100, left: 200 }

describe('SelectionToolbar', () => {
  it('renders nothing without a selection', () => {
    const { container } = render(
      <SelectionToolbar position={null} onAction={vi.fn()} onComment={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('button', { name: 'Comment' })).toBeNull()
  })

  it('offers Comment alongside the AI actions', () => {
    render(<SelectionToolbar position={AT} onAction={vi.fn()} onComment={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Comment' })).toBeVisible()
    // Still there, and not replaced by it.
    expect(screen.getByRole('button', { name: 'Improve' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Ask AI' })).toBeVisible()
  })

  it('starts a comment when it is pressed', async () => {
    const onComment = vi.fn()
    const onAction = vi.fn()
    render(<SelectionToolbar position={AT} onAction={onAction} onComment={onComment} />)

    await userEvent.click(screen.getByRole('button', { name: 'Comment' }))

    expect(onComment).toHaveBeenCalledTimes(1)
    // Commenting is not an AI action and must not be reported as one.
    expect(onAction).not.toHaveBeenCalled()
  })

  /**
   * Signed out, a comment cannot be stored or addressed to anybody. The
   * control is absent rather than present and dead.
   */
  it('hides Comment where commenting is impossible', () => {
    render(<SelectionToolbar position={AT} onAction={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'Comment' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Improve' })).toBeVisible()
  })

  it('runs the AI actions it always did', async () => {
    const onAction = vi.fn()
    render(<SelectionToolbar position={AT} onAction={onAction} onComment={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Explain' }))

    expect(onAction).toHaveBeenCalledWith('EXPLAIN')
  })
})
