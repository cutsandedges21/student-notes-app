import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SuggestionCard } from './SuggestionCard'
import type { AiResponse } from '../types/ai'

/**
 * Citations, as the student sees them.
 *
 * The assistant can now read the student's own notes, and the entire value of
 * that is being able to check the answer against the note it came from. A
 * citation that is displayed but does nothing is the same as no citation.
 */

const ID = '33333333-3333-4333-8333-333333333333'

const answer = (over: Partial<AiResponse> = {}): AiResponse => ({
  mode: 'CHAT',
  response: 'Oxygen is the final electron acceptor.',
  proposed_content: null,
  issues: [],
  added_information: [],
  sources: [],
  ...over,
})

function setup(result: AiResponse, onOpenSource?: (source: { documentId: string }) => void) {
  render(
    <SuggestionCard
      result={result}
      onApply={vi.fn()}
      onReject={vi.fn()}
      onFixIssue={vi.fn()}
      onDismissIssue={vi.fn()}
      onOpenSource={onOpenSource}
    />,
  )
}

describe('SuggestionCard citations', () => {
  it('shows nothing when the answer cited nothing', () => {
    setup(answer())

    expect(screen.queryByText('From your notes')).toBeNull()
  })

  it('names the note and the class it is in', () => {
    setup(
      answer({
        sources: [{ documentId: ID, title: 'Lecture 4 — Respiration', className: 'Biology 101' }],
      }),
    )

    expect(screen.getByText('From your notes')).toBeVisible()
    expect(screen.getByText('Lecture 4 — Respiration')).toBeVisible()
    expect(screen.getByText('Biology 101')).toBeVisible()
  })

  it('opens the note it cited', async () => {
    const onOpenSource = vi.fn()
    setup(
      answer({ sources: [{ documentId: ID, title: 'Lecture 4', className: 'Biology' }] }),
      onOpenSource,
    )

    await userEvent.click(screen.getByRole('button', { name: /Lecture 4/ }))

    expect(onOpenSource).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: ID }),
    )
  })

  /**
   * A shared note opened by a visitor has nowhere to navigate to. The citation
   * still names the note rather than disappearing -- knowing which note an
   * answer came from is useful even when you cannot open it -- but it does not
   * pretend to be a link.
   */
  it('still names the note where it cannot navigate', () => {
    setup(answer({ sources: [{ documentId: ID, title: 'Lecture 4', className: 'Biology' }] }))

    expect(screen.getByText('Lecture 4')).toBeVisible()
    expect(screen.getByRole('button', { name: /Lecture 4/ })).toBeDisabled()
  })

  it('keeps citations separate from what the model made up', () => {
    setup(
      answer({
        added_information: ['ATP yield is roughly 30 per glucose.'],
        sources: [{ documentId: ID, title: 'Lecture 4', className: 'Biology' }],
      }),
    )

    // The two carry opposite meanings and must not read as one list.
    expect(screen.getByText('Added by AI — not from your notes')).toBeVisible()
    expect(screen.getByText('From your notes')).toBeVisible()
  })
})
