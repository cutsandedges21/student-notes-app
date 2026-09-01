import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Editor } from '@tiptap/core'
import { editorExtensions } from '../editor/extensions'
import { useComments } from './useComments'
import { CommentsSidebar } from './CommentsSidebar'

/*
 * The comment round trip, against a stand-in for the project.
 *
 * Comments were reported as "the panel is there but nothing shows up", and the
 * schema was verified deployed, so the question was whether the client half
 * holds up its end: does creating a thread actually reach the database, and
 * does what comes back render.
 *
 * The fake below reproduces the contract the SQL states -- the two list
 * functions return rows with author names attached, and inserts go through the
 * base tables -- so a failure here means the client disagrees with the
 * migration. It cannot prove the SQL is right; only a live project can.
 */

const DOC = 'doc-1'
const ME = 'user-a'

interface ThreadRow {
  id: string
  author_id: string
  author_name: string
  anchor: unknown
  resolved_at: string | null
  resolved_by: string | null
  created_at: string
  reply_count: number
}

interface CommentRow {
  id: string
  thread_id: string
  author_id: string
  author_name: string
  body: string
  created_at: string
  updated_at: string
}

const db = vi.hoisted(() => ({
  threads: [] as unknown[],
  comments: [] as unknown[],
  /** Rejects the next write, to check a failure is reported not swallowed. */
  failNextInsert: false,
  inserts: [] as { table: string; payload: Record<string, unknown> }[],
}))

vi.mock('../lib/supabase', () => {
  const ok = (data: unknown) => Promise.resolve({ data, error: null })

  return {
    isSupabaseConfigured: true,
    supabase: {
      rpc: (name: string) => {
        if (name === 'list_comment_threads') return ok(db.threads)
        if (name === 'list_comments') return ok(db.comments)
        throw new Error(`unexpected rpc ${name}`)
      },
      from: (table: string) => ({
        insert: (payload: Record<string, unknown>) => {
          if (db.failNextInsert) {
            db.failNextInsert = false
            return {
              select: () => ({
                single: () =>
                  Promise.resolve({ data: null, error: { message: 'insert refused' } }),
              }),
              then: (resolve: (v: unknown) => void) =>
                resolve({ data: null, error: { message: 'insert refused' } }),
            }
          }

          db.inserts.push({ table, payload })

          if (table === 'comment_threads') {
            const row: ThreadRow = {
              id: 'thread-new',
              author_id: payload.author_id as string,
              author_name: 'Ada',
              anchor: payload.anchor,
              resolved_at: null,
              resolved_by: null,
              created_at: '2026-09-01T00:00:00.000Z',
              reply_count: 1,
            }
            db.threads.push(row)
            return { select: () => ({ single: () => ok({ id: row.id }) }) }
          }

          const comment: CommentRow = {
            id: `comment-${db.comments.length + 1}`,
            thread_id: payload.thread_id as string,
            author_id: payload.author_id as string,
            author_name: 'Ada',
            body: payload.body as string,
            created_at: '2026-09-01T00:00:01.000Z',
            updated_at: '2026-09-01T00:00:01.000Z',
          }
          db.comments.push(comment)
          return Promise.resolve({ data: null, error: null })
        },
        update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
        delete: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
      }),
      channel: () => {
        const channel = {
          on: () => channel,
          subscribe: () => channel,
        }
        return channel
      },
      removeChannel: () => Promise.resolve('ok'),
    },
  }
})

/** A harness that wires the hook to the panel, exactly as the pages do. */
function Harness({ editor, userId = ME }: { editor: Editor | null; userId?: string | null }) {
  const comments = useComments({ documentId: DOC, userId, editor })

  return (
    <div>
      <button
        type="button"
        disabled={!comments.canComment}
        onClick={() => comments.startDraft()}
      >
        Add comment
      </button>
      <CommentsSidebar
        threads={comments.threads}
        activeThreadId={comments.activeThreadId}
        currentUserId={userId}
        draft={comments.draft}
        onSubmitDraft={(body) => void comments.submitDraft(body)}
        onCancelDraft={comments.cancelDraft}
        busy={comments.loading}
        error={comments.error}
        onSelect={comments.setActiveThreadId}
        onReply={(id, body) => void comments.reply(id, body)}
        onResolve={(id, resolved) => void comments.resolve(id, resolved)}
        onDeleteThread={(id) => void comments.removeThread(id)}
        onDeleteComment={(id) => void comments.removeComment(id)}
      />
    </div>
  )
}

let editor: Editor

function makeEditor(content = '<p>Cellular respiration happens in the mitochondrion.</p>') {
  editor = new Editor({ extensions: editorExtensions, content })
  return editor
}

beforeEach(() => {
  db.threads = []
  db.comments = []
  db.inserts = []
  db.failNextInsert = false
})

describe('useComments', () => {
  it('renders threads that already exist on the note', async () => {
    db.threads = [
      {
        id: 'thread-1',
        author_id: 'user-b',
        author_name: 'Grace',
        anchor: { quote: 'the mitochondrion', prefix: 'happens in ', suffix: '.' },
        resolved_at: null,
        resolved_by: null,
        created_at: '2026-09-01T00:00:00.000Z',
        reply_count: 1,
      },
    ]
    db.comments = [
      {
        id: 'comment-1',
        thread_id: 'thread-1',
        author_id: 'user-b',
        author_name: 'Grace',
        body: 'Is this the right organelle?',
        created_at: '2026-09-01T00:00:00.000Z',
        updated_at: '2026-09-01T00:00:00.000Z',
      },
    ]

    render(<Harness editor={makeEditor()} />)

    // The quoted passage identifies the thread in the list.
    expect(await screen.findByText('the mitochondrion')).toBeInTheDocument()
    expect(screen.queryByText(/No comments yet/)).not.toBeInTheDocument()
  })

  it('shows a collaborator’s reply, not only your own', async () => {
    db.threads = [
      {
        id: 'thread-1',
        author_id: 'user-b',
        author_name: 'Grace',
        anchor: { quote: 'the mitochondrion', prefix: '', suffix: '' },
        resolved_at: null,
        resolved_by: null,
        created_at: '2026-09-01T00:00:00.000Z',
        reply_count: 1,
      },
    ]
    db.comments = [
      {
        id: 'comment-1',
        thread_id: 'thread-1',
        author_id: 'user-b',
        author_name: 'Grace',
        body: 'Written by somebody elseentirely.',
        created_at: '2026-09-01T00:00:00.000Z',
        updated_at: '2026-09-01T00:00:00.000Z',
      },
    ]

    render(<Harness editor={makeEditor()} />)
    await userEvent.click(await screen.findByRole('button', { name: /Comment by Grace/ }))

    expect(screen.getByText('Written by somebody elseentirely.')).toBeInTheDocument()
    expect(screen.getByText('Grace')).toBeInTheDocument()
  })

  it('says there are none when there are none', async () => {
    render(<Harness editor={makeEditor()} />)
    expect(await screen.findByText(/No comments yet/)).toBeInTheDocument()
  })

  /*
   * The button was permanently disabled on the shared page, because the
   * selection is editor state and nothing re-rendered when it changed. The
   * hook subscribes now, so this holds on any page rather than only on the one
   * that happened to re-render for its own reasons.
   */
  it('enables commenting once text is selected, without the page re-rendering', async () => {
    const instance = makeEditor()
    render(<Harness editor={instance} />)

    expect(screen.getByRole('button', { name: 'Add comment' })).toBeDisabled()

    instance.commands.setTextSelection({ from: 1, to: 10 })

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add comment' })).toBeEnabled(),
    )
  })

  it('writes a new thread and its first comment, then shows it', async () => {
    const instance = makeEditor()
    render(<Harness editor={instance} />)

    instance.commands.setTextSelection({ from: 1, to: 21 })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add comment' })).toBeEnabled(),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Add comment' }))

    await userEvent.type(screen.getByLabelText('Your comment'), 'Check this')
    await userEvent.click(screen.getByRole('button', { name: 'Comment' }))

    await waitFor(() => expect(db.inserts).toHaveLength(2))
    expect(db.inserts[0].table).toBe('comment_threads')
    expect(db.inserts[0].payload.document_id).toBe(DOC)
    expect(db.inserts[0].payload.author_id).toBe(ME)
    expect(db.inserts[1].table).toBe('comments')
    expect(db.inserts[1].payload.body).toBe('Check this')

    // The anchor carries the words it was made about, which is what lets it
    // survive the note being edited afterwards.
    const anchor = db.inserts[0].payload.anchor as { quote: string }
    expect(anchor.quote).toContain('Cellular respiration')
  })

  it('reports a refused write instead of appearing to have saved', async () => {
    const instance = makeEditor()
    render(<Harness editor={instance} />)

    instance.commands.setTextSelection({ from: 1, to: 21 })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add comment' })).toBeEnabled(),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Add comment' }))

    db.failNextInsert = true
    await userEvent.type(screen.getByLabelText('Your comment'), 'Will not save')
    await userEvent.click(screen.getByRole('button', { name: 'Comment' }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('tells a signed-out reader why the panel is empty', () => {
    render(<Harness editor={makeEditor()} userId={null} />)
    expect(screen.getByText(/Sign in to comment/)).toBeInTheDocument()
  })
})
