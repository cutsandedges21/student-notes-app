import { describe, it, expect, vi, beforeEach } from 'vitest'

/*
 * The Supabase client is replaced by a small stand-in Postgres.
 *
 * `vi.mock` factories are hoisted above every import, so the factory cannot
 * close over anything declared normally in this file. It therefore closes over
 * a mutable handler pair created by `vi.hoisted`, and the interesting part --
 * the fake project below -- is written at ordinary top level where it can be
 * read.
 */
const hoisted = vi.hoisted(() => {
  const handlers = {
    rpc: (_name: string, _args: Record<string, unknown>): Promise<unknown> =>
      Promise.resolve({ data: null, error: null }),
    from: (_table: string): unknown => ({}),
  }

  return {
    handlers,
    client: {
      rpc: (name: string, args: Record<string, unknown>) => handlers.rpc(name, args),
      from: (table: string) => handlers.from(table),
    },
  }
})

vi.mock('../lib/supabase', () => ({
  supabase: hoisted.client,
  isSupabaseConfigured: true,
}))

import {
  fetchShareState,
  fetchSharedDocument,
  listDocumentAccess,
  pickDestinationClass,
  redeemShareToken,
  revokeDocumentAccess,
  rotateShareToken,
  type ClassCandidate,
} from './sharing'

/*
 * ---------------------------------------------------------------------------
 * A stand-in for the project, shaped exactly like the migrations.
 *
 * These functions cannot be tested against the real thing here -- there is no
 * Supabase project to point at, and a unit suite must not need one -- so the
 * next best thing is a fake that reproduces the rules the SQL actually states:
 *
 *   - documents are readable only by their owner (documents_select_own)
 *   - document_access is keyed on (document_id, user_id), and
 *     redeem_share_token upserts, which is where idempotency comes from
 *   - redeem_share_token returns an empty set for an unknown token, a rotated
 *     token and a private note alike -- no oracle
 *   - rotate_share_token issues a fresh token and deletes the grants that came
 *     from a link
 *   - list_document_access returns nothing to anyone but the owner
 *   - document_access rows are deletable only by the document's owner
 *
 * If one of these tests fails, it means the client no longer agrees with those
 * rules. It does not prove the SQL is right; only a live project can do that.
 * ---------------------------------------------------------------------------
 */

type Mode = 'private' | 'view' | 'edit'

interface DocRow {
  id: string
  user_id: string
  class_id: string
  share_mode: Mode
  share_token: string
  title: string
  version: number
}

interface AccessRow {
  document_id: string
  user_id: string
  mode: 'view' | 'edit'
  granted_via: string | null
  granted_at: string
}

const project = {
  /** Who is calling. `null` is an anonymous visitor. */
  auth: null as string | null,
  documents: [] as DocRow[],
  access: [] as AccessRow[],
  names: {} as Record<string, string>,
  rpcCalls: [] as string[],
  freshTokens: 0,
  clock: 0,
}

function ok(data: unknown) {
  return Promise.resolve({ data, error: null })
}

function fails(message: string) {
  return Promise.resolve({ data: null, error: { message } })
}

function nextGrantedAt(): string {
  project.clock += 1
  return new Date(Date.UTC(2026, 8, 1, 0, 0, project.clock)).toISOString()
}

/** The document a token opens, or undefined -- private notes included. */
function documentForToken(token: unknown): DocRow | undefined {
  return project.documents.find(
    (doc) => doc.share_token === token && doc.share_mode !== 'private',
  )
}

async function rpc(name: string, args: Record<string, unknown>) {
  project.rpcCalls.push(name)

  if (name === 'redeem_share_token') {
    // The RPC raises on a null auth.uid(): an anonymous visitor on an edit
    // link never gets a grant, and so never gets onto the channel.
    if (!project.auth) return fails('authentication required')

    const doc = documentForToken(args.p_token)
    if (!doc) return ok([])

    // The owner needs no grant; ownership already implies edit.
    if (doc.user_id === project.auth) return ok([{ document_id: doc.id, mode: 'edit' }])

    const mode = doc.share_mode as 'view' | 'edit'
    const existing = project.access.find(
      (row) => row.document_id === doc.id && row.user_id === project.auth,
    )

    if (existing) {
      // on conflict (document_id, user_id) do update
      existing.mode = mode
      existing.granted_via = args.p_token as string
    } else {
      project.access.push({
        document_id: doc.id,
        user_id: project.auth,
        mode,
        granted_via: args.p_token as string,
        granted_at: nextGrantedAt(),
      })
    }

    return ok([{ document_id: doc.id, mode }])
  }

  if (name === 'rotate_share_token') {
    // security invoker: the documents UPDATE policy is the ownership check.
    const doc = project.documents.find(
      (row) => row.id === args.p_document_id && row.user_id === project.auth,
    )
    if (!doc) return fails('document not found or not permitted')

    project.freshTokens += 1
    doc.share_token = `token-fresh-${project.freshTokens}`
    project.access = project.access.filter(
      (row) => !(row.document_id === doc.id && row.granted_via !== null),
    )
    return ok(doc.share_token)
  }

  if (name === 'get_shared_document') {
    const doc = documentForToken(args.p_token)
    if (!doc) return ok([])
    return ok([
      {
        id: doc.id,
        class_id: doc.class_id,
        class_name: 'Biology 101',
        class_slug: 'biology-101',
        slug: 'lecture-1',
        title: doc.title,
        content: { type: 'doc', content: [] },
        version: doc.version,
        share_mode: doc.share_mode,
        owner_id: doc.user_id,
      },
    ])
  }

  if (name === 'list_document_access') {
    const doc = project.documents.find(
      (row) => row.id === args.p_document_id && row.user_id === project.auth,
    )
    if (!doc) return ok([])

    return ok(
      project.access
        .filter((row) => row.document_id === doc.id)
        .map((row) => ({
          user_id: row.user_id,
          display_name: project.names[row.user_id] || 'Someone with the link',
          mode: row.mode,
          granted_at: row.granted_at,
        })),
    )
  }

  throw new Error(`unexpected rpc: ${name}`)
}

/** Enough of PostgREST's builder for the two queries this service makes. */
function from(table: string) {
  const filters: Array<[string, unknown]> = []
  let operation: 'select' | 'delete' = 'select'

  /* RLS, such as it is: owner-only on both tables. */
  function visible(): object[] {
    if (table === 'documents') {
      return project.documents.filter((row) => row.user_id === project.auth)
    }
    return project.access.filter((row) => {
      const doc = project.documents.find((d) => d.id === row.document_id)
      return Boolean(doc && doc.user_id === project.auth)
    })
  }

  function matching(): object[] {
    return visible().filter((row) =>
      filters.every(([column, value]) => (row as Record<string, unknown>)[column] === value),
    )
  }

  const api = {
    select: (_columns: string) => {
      operation = 'select'
      return api
    },
    delete: () => {
      operation = 'delete'
      return api
    },
    eq: (column: string, value: unknown) => {
      filters.push([column, value])
      return api
    },
    maybeSingle: () => ok(matching()[0] ?? null),
    then: <T>(onFulfilled: (result: { data: unknown; error: unknown }) => T) => {
      if (operation === 'delete') {
        const doomed = new Set(matching())
        project.access = project.access.filter((row) => !doomed.has(row))
      }
      return ok(null).then(onFulfilled)
    },
  }

  return api
}

hoisted.handlers.rpc = rpc
hoisted.handlers.from = from

const OWNER = 'owner-1'
const VISITOR = 'visitor-1'
const OTHER_VISITOR = 'visitor-2'

function seed(shareMode: Mode, token = 'token-original'): DocRow {
  const doc: DocRow = {
    id: 'doc-1',
    user_id: OWNER,
    class_id: 'class-1',
    share_mode: shareMode,
    share_token: token,
    title: 'Lecture 1',
    version: 3,
  }
  project.documents = [doc]
  return doc
}

beforeEach(() => {
  project.auth = null
  project.documents = []
  project.access = []
  project.names = { [VISITOR]: 'Sam Okafor', [OTHER_VISITOR]: 'Rae Lindqvist' }
  project.rpcCalls = []
  project.freshTokens = 0
  project.clock = 0
})

/* ------------------------------------------------------------------------ */

describe('redeemShareToken', () => {
  it('records a grant so the visitor can be authorised onto the channel later', async () => {
    const doc = seed('edit')
    project.auth = VISITOR

    const grant = await redeemShareToken(doc.share_token)

    expect(grant).toEqual({ documentId: 'doc-1', mode: 'edit' })
    expect(project.access).toEqual([
      expect.objectContaining({
        document_id: 'doc-1',
        user_id: VISITOR,
        mode: 'edit',
        granted_via: 'token-original',
      }),
    ])
  })

  /*
   * Opening the same link twice is ordinary -- a bookmark, a reload, a second
   * tab. The grant is keyed on (document_id, user_id) and the insert is ON
   * CONFLICT DO UPDATE, so the second redemption updates the row it already
   * has rather than adding another or failing on the primary key.
   */
  it('is idempotent: the second visit leaves one grant, not two', async () => {
    const doc = seed('edit')
    project.auth = VISITOR

    const first = await redeemShareToken(doc.share_token)
    const grantedAt = project.access[0].granted_at
    const second = await redeemShareToken(doc.share_token)

    expect(second).toEqual(first)
    expect(project.access).toHaveLength(1)
    // The upsert touches mode and granted_via, never granted_at: "since when"
    // should mean when they first arrived, not when they last reloaded.
    expect(project.access[0].granted_at).toBe(grantedAt)
  })

  it('still holds when the same link is redeemed many times over', async () => {
    const doc = seed('edit')
    project.auth = VISITOR

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await redeemShareToken(doc.share_token)
    }

    expect(project.access).toHaveLength(1)
  })

  // React runs effects twice in StrictMode, and a remount is one navigation
  // away. Two RPCs racing to upsert one row is harmless but pointless.
  it('collapses redemptions that overlap into a single request', async () => {
    const doc = seed('edit')
    project.auth = VISITOR

    const [a, b] = await Promise.all([
      redeemShareToken(doc.share_token),
      redeemShareToken(doc.share_token),
    ])

    expect(a).toEqual(b)
    expect(project.rpcCalls.filter((name) => name === 'redeem_share_token')).toHaveLength(1)
  })

  it('asks again on a later visit, so a downgraded link downgrades the grant', async () => {
    const doc = seed('edit')
    project.auth = VISITOR
    await redeemShareToken(doc.share_token)

    doc.share_mode = 'view'
    const second = await redeemShareToken(doc.share_token)

    expect(second).toEqual({ documentId: 'doc-1', mode: 'view' })
    expect(project.access[0].mode).toBe('view')
  })

  it('grants the owner nothing, because ownership already implies edit', async () => {
    const doc = seed('edit')
    project.auth = OWNER

    const grant = await redeemShareToken(doc.share_token)

    expect(grant).toEqual({ documentId: 'doc-1', mode: 'edit' })
    expect(project.access).toEqual([])
  })

  // The rule update_shared_document already enforces: an edit link is
  // read-only until you sign in. Nothing is recorded, so nothing authorises
  // an anonymous visitor onto the document's Realtime channel either.
  it('refuses an anonymous visitor rather than granting them anything', async () => {
    const doc = seed('edit')
    project.auth = null

    await expect(redeemShareToken(doc.share_token)).rejects.toMatchObject({
      message: 'authentication required',
    })
    expect(project.access).toEqual([])
  })
})

/*
 * The property the whole token design rests on: a wrong guess must be
 * indistinguishable from a note that was never shared. If a revoked token
 * answered differently from an unknown one, guessing tokens would be a
 * feedback loop instead of a lottery.
 */
describe('no oracle', () => {
  async function outcome(token: string) {
    return {
      grant: await redeemShareToken(token),
      document: await fetchSharedDocument(token),
    }
  }

  it('answers a revoked link, a private note and a made-up token identically', async () => {
    const doc = seed('edit')
    project.auth = VISITOR
    const revoked = doc.share_token

    // Revoke by rotating, as the owner.
    project.auth = OWNER
    await rotateShareToken(doc.id)
    project.auth = VISITOR

    const afterRevoke = await outcome(revoked)

    // A note that was never shared at all.
    seed('private', 'token-private')
    const whenPrivate = await outcome('token-private')

    // A token belonging to nothing.
    const whenUnknown = await outcome('token-never-existed')

    expect(afterRevoke).toEqual({ grant: null, document: null })
    expect(whenPrivate).toEqual(afterRevoke)
    expect(whenUnknown).toEqual(afterRevoke)
  })

  it('tells a non-owner nothing about who has access', async () => {
    const doc = seed('edit')
    project.auth = VISITOR
    await redeemShareToken(doc.share_token)

    // The visitor asking about the same document they can read.
    await expect(listDocumentAccess(doc.id)).resolves.toEqual([])
    // And about a document id they have no relationship to at all.
    await expect(listDocumentAccess('doc-someone-elses')).resolves.toEqual([])
  })
})

describe('rotateShareToken', () => {
  it('returns a token, and not the one it replaced', async () => {
    const doc = seed('edit')
    const before = doc.share_token
    project.auth = OWNER

    const after = await rotateShareToken(doc.id)

    expect(after).toEqual(expect.any(String))
    expect(after).not.toBe(before)
  })

  it('gives a different token every time, so turning sharing off and on cannot restore one', async () => {
    const doc = seed('edit')
    project.auth = OWNER

    const first = await rotateShareToken(doc.id)
    const second = await rotateShareToken(doc.id)

    expect(new Set([doc.share_token, first, second]).size).toBe(2)
    expect(second).not.toBe(first)
  })

  it('is what fetchShareState reports afterwards, not the stale one', async () => {
    const doc = seed('edit')
    const stale = doc.share_token
    project.auth = OWNER

    const fresh = await rotateShareToken(doc.id)
    const state = await fetchShareState(doc.id)

    expect(state).toEqual({ mode: 'edit', token: fresh, ownerId: OWNER })
    expect(state?.token).not.toBe(stale)
  })

  it('destroys the grants the old link handed out', async () => {
    const doc = seed('edit')
    project.auth = VISITOR
    await redeemShareToken(doc.share_token)
    project.auth = OTHER_VISITOR
    await redeemShareToken(doc.share_token)
    expect(project.access).toHaveLength(2)

    project.auth = OWNER
    await rotateShareToken(doc.id)

    expect(project.access).toEqual([])
  })

  it('leaves the old link opening nothing', async () => {
    const doc = seed('edit')
    const stale = doc.share_token
    project.auth = OWNER

    await rotateShareToken(doc.id)

    await expect(fetchSharedDocument(stale)).resolves.toBeNull()
  })

  it('refuses anyone who does not own the note', async () => {
    const doc = seed('edit')
    project.auth = VISITOR

    await expect(rotateShareToken(doc.id)).rejects.toMatchObject({
      message: 'document not found or not permitted',
    })
    expect(project.documents[0].share_token).toBe('token-original')
  })
})

describe('the access list', () => {
  it('names the people a link let in, with the mode they were given', async () => {
    const doc = seed('edit')
    project.auth = VISITOR
    await redeemShareToken(doc.share_token)
    project.auth = OTHER_VISITOR
    await redeemShareToken(doc.share_token)

    project.auth = OWNER
    const rows = await listDocumentAccess(doc.id)

    expect(rows).toEqual([
      expect.objectContaining({ userId: VISITOR, displayName: 'Sam Okafor', mode: 'edit' }),
      expect.objectContaining({ userId: OTHER_VISITOR, displayName: 'Rae Lindqvist' }),
    ])
    expect(rows[0].grantedAt).toEqual(expect.any(String))
  })

  it('removes one person without disturbing anyone else', async () => {
    const doc = seed('edit')
    project.auth = VISITOR
    await redeemShareToken(doc.share_token)
    project.auth = OTHER_VISITOR
    await redeemShareToken(doc.share_token)

    project.auth = OWNER
    await revokeDocumentAccess(doc.id, VISITOR)

    expect(await listDocumentAccess(doc.id)).toEqual([
      expect.objectContaining({ userId: OTHER_VISITOR }),
    ])
  })

  it('does not let a visitor revoke somebody else', async () => {
    const doc = seed('edit')
    project.auth = VISITOR
    await redeemShareToken(doc.share_token)
    project.auth = OTHER_VISITOR
    await redeemShareToken(doc.share_token)

    // The delete matches no visible row, so it silently affects nothing --
    // which is what an RLS-filtered delete does.
    await revokeDocumentAccess(doc.id, VISITOR)

    expect(project.access).toHaveLength(2)
  })
})

/*
 * "Make a copy" used to resolve its destination class with
 * `.eq('name', …).maybeSingle()`. There is no unique constraint on
 * classes(user_id, name) and there cannot be one -- taking the same course in
 * two terms is ordinary -- so PostgREST answered a second same-named class
 * with PGRST116 and the copy failed outright for anyone it applied to.
 *
 * The resolver now returns every candidate and chooses between them by a total
 * order. These tests pin that order down, because the property that matters is
 * not which class wins but that the same one always does: copies taken from
 * one share link on different days, or on different devices, have to land
 * together rather than scattering across duplicates.
 */

const candidate = (id: string, created_at: string, slug = id): ClassCandidate => ({
  id,
  slug,
  created_at,
})

describe('pickDestinationClass', () => {
  it('returns null when the user has no class of that name', () => {
    expect(pickDestinationClass([])).toBeNull()
  })

  it('returns the only candidate when the name is unambiguous', () => {
    const only = candidate('class-1', '2026-01-01T00:00:00.000Z')
    expect(pickDestinationClass([only])).toEqual(only)
  })

  // The case that used to throw.
  it('chooses deterministically when several classes share a name', () => {
    const older = candidate('class-b', '2026-01-01T00:00:00.000Z')
    const newer = candidate('class-a', '2026-09-01T00:00:00.000Z')

    expect(pickDestinationClass([newer, older])).toEqual(older)
  })

  it('gives the same answer whatever order the rows arrive in', () => {
    const rows = [
      candidate('class-c', '2026-03-01T00:00:00.000Z'),
      candidate('class-a', '2026-01-01T00:00:00.000Z'),
      candidate('class-b', '2026-02-01T00:00:00.000Z'),
    ]

    const first = pickDestinationClass(rows)
    const reversed = pickDestinationClass([...rows].reverse())
    const shuffled = pickDestinationClass([rows[1], rows[2], rows[0]])

    expect(first?.id).toBe('class-a')
    expect(reversed).toEqual(first)
    expect(shuffled).toEqual(first)
  })

  // Two classes created in the same millisecond is unlikely but not impossible,
  // and a partial order would let the winner flip between calls.
  it('breaks a timestamp tie on id rather than leaving it to chance', () => {
    const sameInstant = '2026-01-01T00:00:00.000Z'
    const rows = [candidate('zzz', sameInstant), candidate('aaa', sameInstant)]

    expect(pickDestinationClass(rows)?.id).toBe('aaa')
    expect(pickDestinationClass([...rows].reverse())?.id).toBe('aaa')
  })

  it('does not mutate the caller’s array', () => {
    const rows = [
      candidate('class-c', '2026-03-01T00:00:00.000Z'),
      candidate('class-a', '2026-01-01T00:00:00.000Z'),
    ]
    const before = rows.map((row) => row.id)

    pickDestinationClass(rows)

    expect(rows.map((row) => row.id)).toEqual(before)
  })
})
