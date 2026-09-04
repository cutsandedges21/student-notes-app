import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AiDock } from './AiDock'
import { AiConversationProvider } from './AiConversation'
import type { AiResponse } from '../types/ai'

/*
 * The bar measures the sheet it centres on, and jsdom has no layout and no
 * ResizeObserver. A no-op is the honest stub: there is nothing to observe, so
 * the bar keeps its fallback position, which is what these tests want anyway.
 */
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', NoopResizeObserver)

const chat = vi.fn()

/**
 * Long and multi-line on purpose.
 *
 * The button exists because selecting an answer by hand means dragging inside
 * a box that scrolls. A one-line reply would pass a copy test that the real
 * complaint would still fail.
 */
const ANSWER = [
  'Mitochondria make ATP through oxidative phosphorylation.',
  '',
  'The electron transport chain pumps protons across the inner membrane,',
  'and ATP synthase uses the gradient that creates.',
].join('\n')

const reply: AiResponse = {
  mode: 'CHAT',
  response: ANSWER,
  proposed_content: null,
  issues: [],
  added_information: [],
  sources: [],
  proposed_actions: [],
}

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } } }),
}))

vi.mock('../services/aiClient', () => ({
  AIService: { chat: (...args: unknown[]) => chat(...args) },
  AI_ACTIONS: [],
}))

function renderDock() {
  return render(
    <AiConversationProvider
      documentId="doc-1"
      classId="class-1"
      selection={null}
      pendingMode={null}
      onPendingHandled={vi.fn()}
      onApply={vi.fn()}
      onPreview={vi.fn()}
    >
      <AiDock onMoveToPanel={vi.fn()} />
    </AiConversationProvider>,
  )
}

/** Opens the bar and gets an answer into it, which is what the button acts on. */
async function ask(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'AI assistant' }))
  await user.type(screen.getByLabelText('Ask the assistant'), 'how does ATP work?')
  await user.click(screen.getByRole('button', { name: 'Send' }))
  await screen.findByText(/Mitochondria make ATP/)
}

describe('AiDock copy button', () => {
  let writeText: ReturnType<typeof vi.fn>

  /*
   * Order matters here, which is why this is a helper rather than a line in
   * `beforeEach`. `userEvent.setup()` installs its own `navigator.clipboard`
   * stub, so a spy planted before it is silently replaced -- and the copy then
   * "succeeds" against user-event's stub no matter what this test asked for.
   * Ours goes on afterwards.
   */
  function setup() {
    const user = userEvent.setup()
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
      writable: true,
    })
    return user
  }

  beforeEach(() => {
    chat.mockReset().mockResolvedValue(reply)
    writeText = vi.fn().mockResolvedValue(undefined)
  })

  it('puts the whole answer on the clipboard, not just what is on screen', async () => {
    const user = setup()
    renderDock()
    await ask(user)

    await user.click(screen.getByRole('button', { name: 'Copy the whole answer' }))

    expect(writeText).toHaveBeenCalledWith(ANSWER)
  })

  it('acknowledges the copy, because the clipboard is invisible', async () => {
    const user = setup()
    renderDock()
    await ask(user)

    await user.click(screen.getByRole('button', { name: 'Copy the whole answer' }))

    await screen.findByRole('button', { name: 'Answer copied' })
    expect(screen.getByText('Copied')).toBeInTheDocument()
  })

  it('says so when the clipboard refuses, rather than showing a tick that lies', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    // The component logs the refusal; the test is about what it shows.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const user = setup()
    renderDock()
    await ask(user)

    await user.click(screen.getByRole('button', { name: 'Copy the whole answer' }))

    await screen.findByRole('button', { name: 'Could not copy the answer' })
    expect(writeText).toHaveBeenCalled()
  })

  it('offers nothing to copy when the card is showing an error', async () => {
    chat.mockRejectedValue(new Error('upstream fell over'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const user = setup()
    renderDock()

    await user.click(screen.getByRole('button', { name: 'AI assistant' }))
    await user.type(screen.getByLabelText('Ask the assistant'), 'how does ATP work?')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await screen.findByText(/couldn't complete that request/)
    expect(screen.queryByRole('button', { name: 'Copy the whole answer' })).not.toBeInTheDocument()
  })

  it('drops the acknowledgement when a newer answer replaces the one that was copied', async () => {
    const user = setup()
    renderDock()
    await ask(user)

    await user.click(screen.getByRole('button', { name: 'Copy the whole answer' }))
    await screen.findByRole('button', { name: 'Answer copied' })

    // A second answer arrives well inside the acknowledgement window. The tick
    // was a claim about the previous message and must not carry over.
    chat.mockResolvedValue({ ...reply, response: 'A different answer entirely.' })
    await user.type(screen.getByLabelText('Ask the assistant'), 'and glycolysis?')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await screen.findByText('A different answer entirely.')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Copy the whole answer' })).toBeInTheDocument(),
    )
    expect(screen.queryByText('Copied')).not.toBeInTheDocument()
  })
})
