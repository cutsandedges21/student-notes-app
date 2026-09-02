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
  proposed_actions: [],
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

/**
 * A restored answer is readable and inert.
 *
 * A suggestion is anchored to the document as it stood when it was made, and
 * that anchor cannot survive a reload -- the note can be edited in between.
 * Offering to apply it anyway would be pasting old text at a guessed location,
 * which is the exact failure `applySuggestion.ts` exists to prevent. So a
 * historical card keeps everything worth reading and offers nothing to press.
 */
describe('restored from an earlier conversation', () => {
  it('does not offer to apply a rewrite', () => {
    render(
      <SuggestionCard
        result={answer({ proposed_content: 'A tidier version.' })}
        onApply={vi.fn()}
        onReject={vi.fn()}
        onFixIssue={vi.fn()}
        onDismissIssue={vi.fn()}
        historical
      />,
    )

    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
  })

  it('still offers it in a live conversation', () => {
    render(
      <SuggestionCard
        result={answer({ proposed_content: 'A tidier version.' })}
        onApply={vi.fn()}
        onReject={vi.fn()}
        onFixIssue={vi.fn()}
        onDismissIssue={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Apply' })).toBeVisible()
  })

  it('shows a past correction without offering to make it', () => {
    render(
      <SuggestionCard
        result={answer({
          issues: [
            {
              original: 'chloroplast',
              problem: 'Respiration happens in the mitochondrion.',
              correction: 'mitochondrion',
              confidence: 'high',
            },
          ],
        })}
        onApply={vi.fn()}
        onReject={vi.fn()}
        onFixIssue={vi.fn()}
        onDismissIssue={vi.fn()}
        historical
      />,
    )

    // The correction is still there to read.
    expect(screen.getByText('mitochondrion')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Fix this' })).toBeNull()
    expect(screen.getByText(/Ask again to apply it/)).toBeVisible()
  })

  it('keeps its citations, which are what a reopened answer is for', () => {
    render(
      <SuggestionCard
        result={answer({
          sources: [{ documentId: ID, title: 'Lecture 4', className: 'Biology' }],
        })}
        onApply={vi.fn()}
        onReject={vi.fn()}
        onFixIssue={vi.fn()}
        onDismissIssue={vi.fn()}
        onOpenSource={vi.fn()}
        historical
      />,
    )

    expect(screen.getByRole('button', { name: /Lecture 4/ })).toBeEnabled()
  })
})

/**
 * Offers to create a note.
 *
 * The tool layer on the server is read-only so that anything which makes the
 * student's work has to come through a card like this. What is being pinned is
 * that the card is an offer: it says what would be made, shows the content
 * before it exists, and does nothing until pressed.
 */
describe('proposed actions', () => {
  const action = {
    kind: 'create_note' as const,
    title: 'Respiration study guide',
    content: '# Respiration\n\nGlycolysis happens in the cytosol.',
    reason: 'Pulls the three lectures into one place.',
  }

  it('shows nothing when nothing was offered', () => {
    setup(answer())
    expect(screen.queryByText('New note')).toBeNull()
  })

  it('names the note and says why', () => {
    render(
      <SuggestionCard
        result={answer({ proposed_actions: [action] })}
        onApply={vi.fn()}
        onReject={vi.fn()}
        onFixIssue={vi.fn()}
        onDismissIssue={vi.fn()}
        onRunAction={vi.fn()}
      />,
    )

    expect(screen.getByText('New note')).toBeVisible()
    expect(screen.getByText('Respiration study guide')).toBeVisible()
    expect(screen.getByText('Pulls the three lectures into one place.')).toBeVisible()
  })

  /** A note read before it exists is one that was chosen, not discovered. */
  it('lets the content be read before it is made', () => {
    render(
      <SuggestionCard
        result={answer({ proposed_actions: [action] })}
        onApply={vi.fn()}
        onReject={vi.fn()}
        onFixIssue={vi.fn()}
        onDismissIssue={vi.fn()}
        onRunAction={vi.fn()}
      />,
    )

    expect(screen.getByText(/Glycolysis happens in the cytosol/)).toBeInTheDocument()
  })

  it('does nothing until the button is pressed', async () => {
    const onRunAction = vi.fn()
    render(
      <SuggestionCard
        result={answer({ proposed_actions: [action] })}
        onApply={vi.fn()}
        onReject={vi.fn()}
        onFixIssue={vi.fn()}
        onDismissIssue={vi.fn()}
        onRunAction={onRunAction}
      />,
    )

    expect(onRunAction).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Create this note' }))

    expect(onRunAction).toHaveBeenCalledWith(action)
  })

  it('does not offer to make it again from an old conversation', () => {
    render(
      <SuggestionCard
        result={answer({ proposed_actions: [action] })}
        onApply={vi.fn()}
        onReject={vi.fn()}
        onFixIssue={vi.fn()}
        onDismissIssue={vi.fn()}
        onRunAction={vi.fn()}
        historical
      />,
    )

    expect(screen.queryByRole('button', { name: 'Create this note' })).toBeNull()
    expect(screen.getByText(/Ask again to make it/)).toBeVisible()
  })

  it('cannot be pressed twice while it is running', () => {
    render(
      <SuggestionCard
        result={answer({ proposed_actions: [action] })}
        onApply={vi.fn()}
        onReject={vi.fn()}
        onFixIssue={vi.fn()}
        onDismissIssue={vi.fn()}
        onRunAction={vi.fn()}
        runningAction={action}
      />,
    )

    expect(screen.getByRole('button', { name: 'Create this note' })).toBeDisabled()
  })
})
