import { describe, it, expect, vi, beforeEach } from 'vitest'

const from = vi.fn()
vi.mock('../lib/supabase', () => ({
  supabase: { from: (table: string) => from(table) },
  isSupabaseConfigured: true,
}))

import { appendTurn, clearConversation, loadConversation } from './conversations'

/**
 * Keeping the transcript.
 *
 * `conversations` and `messages` were created in the first migration and have
 * been empty in every deployment since. What matters here is not that rows are
 * written but which ones, and that opening a note does not write anything at
 * all -- an empty conversation per note per student is a table that grows with
 * navigation rather than with use.
 */

/** A chainable stub, since every call is builder.method().method()...  */
function builder(result: { data?: unknown; error?: unknown }) {
  const node: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'order', 'insert', 'delete']) {
    node[method] = vi.fn(() => node)
  }
  node.limit = vi.fn(() => Promise.resolve(result))
  node.single = vi.fn(() => Promise.resolve(result))
  node.then = (resolve: (value: unknown) => unknown) => resolve(result)
  return node
}

beforeEach(() => vi.clearAllMocks())

describe('loadConversation', () => {
  it('returns nothing for a guest, without asking the server', async () => {
    expect(await loadConversation(null, 'doc-1')).toEqual([])
    expect(from).not.toHaveBeenCalled()
  })

  it('returns nothing when the note has never had a conversation', async () => {
    from.mockReturnValue(builder({ data: [] }))

    expect(await loadConversation('user-1', 'doc-1')).toEqual([])
    // Looked for the conversation; never went looking for messages.
    expect(from).toHaveBeenCalledTimes(1)
    expect(from).toHaveBeenCalledWith('conversations')
  })

  it('reads the transcript oldest first, with its payloads', async () => {
    const payload = {
      mode: 'CHAT',
      response: 'Oxygen is the final acceptor.',
      proposed_content: null,
      issues: [],
      added_information: [],
      sources: [{ documentId: 'd', title: 'Lecture 4', className: 'Biology' }],
    }

    const conversations = builder({ data: [{ id: 'conv-1' }] })
    const messages = builder({
      data: [
        {
          id: 'm1',
          role: 'user',
          content: 'What is the final acceptor?',
          mode: 'CHAT',
          payload: null,
          created_at: '2026-09-01T10:00:00Z',
        },
        {
          id: 'm2',
          role: 'assistant',
          content: 'Oxygen is the final acceptor.',
          mode: 'CHAT',
          payload,
          created_at: '2026-09-01T10:00:05Z',
        },
      ],
    })
    from.mockImplementation((table: string) =>
      table === 'conversations' ? conversations : messages,
    )

    const turns = await loadConversation('user-1', 'doc-1')

    expect(turns.map((turn) => turn.role)).toEqual(['user', 'assistant'])
    expect(turns[1].payload?.sources[0].title).toBe('Lecture 4')
    expect(messages.order).toHaveBeenCalledWith('created_at', { ascending: true })
  })

  /** The column is nullable and rows predate it; a missing payload is a turn. */
  it('tolerates a turn with no payload', async () => {
    from.mockImplementation((table: string) =>
      table === 'conversations'
        ? builder({ data: [{ id: 'conv-1' }] })
        : builder({
            data: [
              {
                id: 'm1',
                role: 'assistant',
                content: 'An older answer.',
                mode: 'CHAT',
                payload: undefined,
                created_at: '2026-09-01T10:00:00Z',
              },
            ],
          }),
    )

    const turns = await loadConversation('user-1', 'doc-1')
    expect(turns[0].payload).toBeNull()
  })
})

describe('appendTurn', () => {
  it('creates the conversation on the first turn', async () => {
    const conversations = builder({ data: [] })
    // The insert path returns the new row through .single().
    conversations.single = vi.fn(() => Promise.resolve({ data: { id: 'conv-new' } }))
    const messages = builder({ error: null })
    from.mockImplementation((table: string) =>
      table === 'conversations' ? conversations : messages,
    )

    const id = await appendTurn('user-1', 'doc-1', 'class-1', {
      role: 'user',
      content: 'Why?',
      mode: 'CHAT',
    })

    expect(id).toBe('conv-new')
    expect(conversations.insert).toHaveBeenCalledWith({
      user_id: 'user-1',
      class_id: 'class-1',
      document_id: 'doc-1',
    })
  })

  /** One lookup per session, not one per turn. */
  it('reuses a conversation it was already given', async () => {
    const messages = builder({ error: null })
    from.mockReturnValue(messages)

    const id = await appendTurn(
      'user-1',
      'doc-1',
      'class-1',
      { role: 'assistant', content: 'Because.', mode: 'CHAT' },
      'conv-known',
    )

    expect(id).toBe('conv-known')
    expect(from).toHaveBeenCalledTimes(1)
    expect(from).toHaveBeenCalledWith('messages')
  })

  it('stores the validated response alongside the prose', async () => {
    const messages = builder({ error: null })
    from.mockReturnValue(messages)

    const payload = {
      mode: 'CHAT' as const,
      response: 'Answer.',
      proposed_content: null,
      issues: [],
      added_information: [],
      sources: [],
      proposed_actions: [],
    }

    await appendTurn(
      'user-1',
      'doc-1',
      'class-1',
      { role: 'assistant', content: 'Answer.', mode: 'CHAT', payload },
      'conv-1',
    )

    expect(messages.insert).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'assistant', payload }),
    )
  })

  it('reports a write that did not happen', async () => {
    from.mockReturnValue(builder({ error: { message: 'denied' } }))

    await expect(
      appendTurn('user-1', 'doc-1', 'class-1', { role: 'user', content: 'x', mode: 'CHAT' }, 'c'),
    ).rejects.toBeTruthy()
  })
})

describe('clearConversation', () => {
  it('deletes the conversation, and scopes the delete to its owner', async () => {
    const conversations = builder({ error: null })
    from.mockReturnValue(conversations)

    await clearConversation('user-1', 'doc-1')

    expect(conversations.delete).toHaveBeenCalled()
    expect(conversations.eq).toHaveBeenCalledWith('document_id', 'doc-1')
    expect(conversations.eq).toHaveBeenCalledWith('user_id', 'user-1')
  })

  it('does nothing for a guest', async () => {
    await clearConversation(null, 'doc-1')
    expect(from).not.toHaveBeenCalled()
  })
})
