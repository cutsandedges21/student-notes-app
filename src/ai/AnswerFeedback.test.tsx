import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AnswerFeedback } from './AnswerFeedback'

/**
 * Rating an answer.
 *
 * The asymmetry is the design: "good" carries everything it needs, "bad"
 * carries nothing without the reason. And what it says afterwards is "Noted",
 * not "this helps improve the assistant" -- nothing here feeds back into the
 * model, and claiming otherwise would be the sort of thing this programme has
 * spent its time removing.
 */

describe('AnswerFeedback', () => {
  it('offers both ratings', () => {
    render(<AnswerFeedback onRate={vi.fn().mockResolvedValue(undefined)} />)

    expect(screen.getByRole('button', { name: 'Good answer' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Bad answer' })).toBeVisible()
  })

  it('is absent where there is nobody to attach a rating to', () => {
    const { container } = render(
      <AnswerFeedback onRate={vi.fn()} disabled />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  /** "Good" needs no follow-up; one click is a complete action. */
  it('records a good answer and asks nothing further', async () => {
    const onRate = vi.fn().mockResolvedValue(undefined)
    render(<AnswerFeedback onRate={onRate} />)

    await userEvent.click(screen.getByRole('button', { name: 'Good answer' }))

    expect(onRate).toHaveBeenCalledWith('up', undefined)
    expect(await screen.findByText('Noted.')).toBeVisible()
    expect(screen.queryByLabelText(/What was wrong/)).toBeNull()
  })

  /** "Bad" is not useful without the reason, so it asks — optionally. */
  it('asks what was wrong after a bad answer', async () => {
    const onRate = vi.fn().mockResolvedValue(undefined)
    render(<AnswerFeedback onRate={onRate} />)

    await userEvent.click(screen.getByRole('button', { name: 'Bad answer' }))

    expect(await screen.findByLabelText(/What was wrong/)).toBeVisible()
    // The rating is already recorded; the note is extra.
    expect(onRate).toHaveBeenCalledWith('down', undefined)
  })

  it('sends the reason when one is given', async () => {
    const onRate = vi.fn().mockResolvedValue(undefined)
    render(<AnswerFeedback onRate={onRate} />)

    await userEvent.click(screen.getByRole('button', { name: 'Bad answer' }))
    await userEvent.type(await screen.findByLabelText(/What was wrong/), 'It invented a date.')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(onRate).toHaveBeenLastCalledWith('down', 'It invented a date.')
  })

  it('lets the reason be skipped', async () => {
    const onRate = vi.fn().mockResolvedValue(undefined)
    render(<AnswerFeedback onRate={onRate} />)

    await userEvent.click(screen.getByRole('button', { name: 'Bad answer' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Skip' }))

    expect(await screen.findByText('Noted.')).toBeVisible()
  })

  /**
   * Being thanked for a report that never saved is worse than not being
   * offered the button.
   */
  it('says so when the rating did not save', async () => {
    const onRate = vi.fn().mockRejectedValue(new Error('offline'))
    render(<AnswerFeedback onRate={onRate} />)

    await userEvent.click(screen.getByRole('button', { name: 'Good answer' }))

    expect(await screen.findByText('That could not be sent.')).toBeVisible()
    expect(screen.queryByText('Noted.')).toBeNull()
  })

  it('does not claim the model learns from it', async () => {
    const onRate = vi.fn().mockResolvedValue(undefined)
    render(<AnswerFeedback onRate={onRate} />)

    await userEvent.click(screen.getByRole('button', { name: 'Good answer' }))
    await screen.findByText('Noted.')

    expect(screen.queryByText(/improve/i)).toBeNull()
    expect(screen.queryByText(/train/i)).toBeNull()
  })
})
