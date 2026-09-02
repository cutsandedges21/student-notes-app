import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { AiSidebar } from './AiSidebar'
import { AiConversationProvider, type AiSelection } from './AiConversation'
import type { AiResponse } from '../types/ai'

const improve = vi.fn()

const reply: AiResponse = {
  mode: 'IMPROVE_NOTES',
  response: 'Here is a tidier version.',
  proposed_content: null,
  issues: [],
  added_information: [],
  sources: [],
}

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } } }),
}))

vi.mock('../services/aiClient', () => ({
  AIService: { chat: vi.fn() },
  AI_ACTIONS: [
    { mode: 'IMPROVE_NOTES', run: (target: unknown) => improve(target) },
    { mode: 'CHECK_NOTES', run: vi.fn() },
    { mode: 'EXPLAIN', run: vi.fn() },
    { mode: 'MAKE_CLEARER', run: vi.fn() },
    { mode: 'EXAM_READY', run: vi.fn() },
  ],
}))

const selection: AiSelection = { text: 'mitochondria make ATP', from: 1, to: 22 }

/*
 * The conversation lives in the provider now, and the panel is a view onto it,
 * so these render together. What is being exercised is unchanged: what the
 * panel shows, and what it hands the document when a suggestion is applied.
 */
type ConversationProps = React.ComponentProps<typeof AiConversationProvider>

function renderSidebar(props: Partial<ConversationProps> = {}) {
  const onPendingHandled = vi.fn()
  const view = render(
    // The panel links to notes -- the class list, and now the notes a cited
    // answer came from -- so it needs a router in a test as much as in the app.
    <MemoryRouter>
    <AiConversationProvider
      documentId="doc-1"
      classId="class-1"
      selection={null}
      pendingMode={null}
      onPendingHandled={onPendingHandled}
      onApply={vi.fn()}
      onPreview={vi.fn()}
      {...props}
    >
      <AiSidebar />
    </AiConversationProvider>
    </MemoryRouter>,
  )
  return { ...view, onPendingHandled }
}

describe('AiSidebar', () => {
  beforeEach(() => {
    improve.mockReset().mockResolvedValue(reply)
  })

  describe('actions that need a selection', () => {
    // The whole point of the Ctrl+Alt shortcuts: they rewrite the student's
    // own words, so with nothing highlighted the assistant has to ask which
    // part rather than silently rewriting the entire note.
    it('asks which part to work on when a shortcut fires with no selection', async () => {
      renderSidebar({ pendingMode: { mode: 'IMPROVE_NOTES', selection: null } })

      expect(
        await screen.findByText(/Which part of your notes should I improve\?/),
      ).toBeInTheDocument()
      expect(screen.getByText(/Ctrl\+Alt\+I/)).toBeInTheDocument()
      expect(improve).not.toHaveBeenCalled()
    })

    it('asks the same way when the button is clicked with no selection', async () => {
      renderSidebar()

      await userEvent.click(screen.getByRole('button', { name: /Improve my notes/ }))

      expect(
        await screen.findByText(/Which part of your notes should I improve\?/),
      ).toBeInTheDocument()
      expect(improve).not.toHaveBeenCalled()
    })

    it('runs against the highlighted text when there is a selection', async () => {
      renderSidebar({ pendingMode: { mode: 'IMPROVE_NOTES', selection } })

      await waitFor(() => expect(improve).toHaveBeenCalledTimes(1))
      expect(improve).toHaveBeenCalledWith(
        expect.objectContaining({ selectedText: 'mitochondria make ATP' }),
      )
      expect(await screen.findByText('Here is a tidier version.')).toBeInTheDocument()
    })
  })

  /*
   * One pending action is one request.
   *
   * Two copies of the panel are mounted at every width, and each used to run
   * the pending-action effect -- so a single shortcut fired twice unless
   * exactly one copy was flagged as the real one. The conversation is shared
   * now and the effect runs in the provider, so the duplication is gone by
   * construction rather than by flag. Two panels, one call.
   */
  it('sends one request even with the panel rendered twice', async () => {
    render(
      <MemoryRouter>
        <AiConversationProvider
          documentId="doc-1"
          classId="class-1"
          selection={null}
          pendingMode={{ mode: 'IMPROVE_NOTES', selection }}
          onPendingHandled={vi.fn()}
          onApply={vi.fn()}
          onPreview={vi.fn()}
        >
          <AiSidebar />
          <AiSidebar />
        </AiConversationProvider>
      </MemoryRouter>,
    )

    await screen.findAllByText('Here is a tidier version.')
    expect(improve).toHaveBeenCalledTimes(1)
  })

  /*
   * Where the destroy-the-note bug lived.
   *
   * "Fix this" used to call onApply(correction, null), and the page turned a
   * null target into "replace the whole document". The panel must hand down an
   * anchor of its own -- the student's wording, which the issue quotes back --
   * and it must never be null, whatever is or is not selected.
   */
  describe('applying a flagged issue', () => {
    const flagged: AiResponse = {
      mode: 'CHECK_NOTES',
      response: 'One thing to check.',
      proposed_content: null,
      issues: [
        {
          original: 'the chloroplast',
          problem: 'Respiration happens in the mitochondrion.',
          correction: 'the mitochondrion',
          confidence: 'high',
        },
      ],
      added_information: [],
  sources: [],
    }

    // The prop is a union of sync and async returns, which a bare vi.fn() does
    // not satisfy. Asserted at the boundary rather than typing every mock:
    // what these tests care about is the arguments and the returned verdict.
    type ApplyProp = ConversationProps['onApply']

    const runCheck = async (onApply: ReturnType<typeof vi.fn>) => {
      improve.mockResolvedValue(flagged)
      renderSidebar({
        onApply: onApply as unknown as ApplyProp,
        selection: null,
        pendingMode: { mode: 'IMPROVE_NOTES', selection },
      })
      await screen.findByText('One thing to check.')
      await userEvent.click(screen.getByRole('button', { name: 'Fix this' }))
    }

    it('anchors on the words the issue quoted, never on the live selection', async () => {
      const onApply = vi.fn()
      await runCheck(onApply)

      expect(onApply).toHaveBeenCalledTimes(1)
      const [content, target] = onApply.mock.calls[0]
      expect(content).toBe('the mitochondrion')
      expect(target).toBeTruthy()
      expect(target.text).toBe('the chloroplast')
    })

    // A refusal that shows nothing is indistinguishable from a broken button.
    it('shows why an edit could not be placed, and keeps the transcript', async () => {
      const onApply = vi.fn().mockResolvedValue({
        status: 'refused',
        reason: 'ambiguous',
        message: 'That text appears 3 times in your notes.',
      })
      await runCheck(onApply)

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('That text appears 3 times in your notes.')
      // The answer that produced the suggestion is still there to act on.
      expect(screen.getByText('One thing to check.')).toBeInTheDocument()
    })

    it('says nothing when the edit lands', async () => {
      const onApply = vi.fn().mockResolvedValue({
        status: 'applied',
        from: 1,
        to: 15,
        source: 'text',
      })
      await runCheck(onApply)

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  it('shows each action with its shortcut', () => {
    renderSidebar()

    for (const [label, keys] of [
      ['Improve my notes', 'Ctrl+Alt+I'],
      ['Explain my notes', 'Ctrl+Alt+E'],
      ['Check my notes', 'Ctrl+Alt+C'],
      ['Examify my notes', 'Ctrl+Alt+X'],
      ['Simplify my notes', 'Ctrl+Alt+S'],
    ]) {
      const button = screen.getByRole('button', { name: new RegExp(label) })
      expect(button).toHaveTextContent(keys)
    }
  })
})
