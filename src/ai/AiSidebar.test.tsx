import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AiSidebar, type AiSelection } from './AiSidebar'
import type { AiResponse } from '../types/ai'

const improve = vi.fn()

const reply: AiResponse = {
  mode: 'IMPROVE_NOTES',
  response: 'Here is a tidier version.',
  proposed_content: null,
  issues: [],
  added_information: [],
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

function renderSidebar(props: Partial<React.ComponentProps<typeof AiSidebar>> = {}) {
  const onPendingHandled = vi.fn()
  const view = render(
    <AiSidebar
      documentId="doc-1"
      classId="class-1"
      selection={null}
      pendingMode={null}
      onPendingHandled={onPendingHandled}
      onApply={vi.fn()}
      onPreview={vi.fn()}
      {...props}
    />,
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

  // Both copies of the panel (docked and drawer) are mounted at every width,
  // so without the `active` gate one pending action became two API calls.
  it('ignores a pending action while it is the off-screen copy', async () => {
    const { onPendingHandled } = renderSidebar({
      active: false,
      pendingMode: { mode: 'IMPROVE_NOTES', selection },
    })

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(improve).not.toHaveBeenCalled()
    expect(onPendingHandled).not.toHaveBeenCalled()
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
