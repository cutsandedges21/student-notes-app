import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { SupabaseClient } from '@supabase/supabase-js'
import * as Y from 'yjs'
import { getSchema, type JSONContent } from '@tiptap/core'
import { editorExtensions } from '../editor/extensions'
import { MemoryBus, MemoryTransport } from './transport'
import { toBase64 } from './encoding'
import { encodeSeedUpdate, COLLAB_FRAGMENT } from './seed'
import { useCollaboration } from './useCollaboration'

/*
 * The seeding race, and the two ways of getting it wrong.
 *
 * An existing note holds its text in `documents.content`. The first
 * collaborative open has to convert that into a Yjs document -- once, ever.
 * If two clients both do it, the merge does not recognise the two conversions
 * as the same paragraph: it keeps both, and the student's note silently
 * doubles. Nothing throws, so only a test catches it.
 *
 * The database makes the decision (see 20260901000300_seed_ydoc.sql), and the
 * fake below models that statement exactly: a conditional update that applies
 * only while `ydoc` is null, reporting whether it did. The client's obligation
 * is the half that is easy to get wrong, and is what most of these tests are
 * about -- when told it lost, it must throw its seed away and re-read rather
 * than apply it anyway.
 */

const schema = getSchema(editorExtensions)

const doc = (...paragraphs: string[]): JSONContent => ({
  type: 'doc',
  content: paragraphs.map((text) => ({
    type: 'paragraph',
    content: text ? [{ type: 'text', text }] : [],
  })),
})

/** What the collaborative editor would actually show. */
function bodyText(ydoc: Y.Doc): string {
  return ydoc.getXmlFragment(COLLAB_FRAGMENT).toString()
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

interface UpdateRow {
  id: number
  document_id: string
  user_id: string
  update_b64: string
}

/**
 * The parts of Supabase this path touches, with the seed RPC's real semantics.
 *
 * Counters rather than mocks on the client itself, so a test can assert that
 * guest mode reaches the backend zero times rather than merely that it did not
 * reach one particular method.
 */
interface FakeBackend {
  documents: Map<string, { ydoc: string | null }>
  updates: UpdateRow[]
  nextId: number
  seedCalls: number
  compactCalls: number
  reads: number
  /** Lets a test stage the winner of the race arriving first. */
  beforeSeed: (() => void) | null
}

function fakeClient(backend: FakeBackend): SupabaseClient {
  return {
    from(table: string) {
      backend.reads += 1
      let id = ''
      const builder = {
        select: () => builder,
        eq: (_column: string, value: string) => {
          id = value
          return builder
        },
        order: () =>
          Promise.resolve({
            data: backend.updates
              .filter((row) => row.document_id === id)
              .map(({ id: rowId, update_b64 }) => ({ id: rowId, update_b64 })),
            error: null,
          }),
        maybeSingle: () =>
          Promise.resolve({
            data:
              table === 'documents' ? { ydoc: backend.documents.get(id)?.ydoc ?? null } : null,
            error: null,
          }),
        insert: (row: Omit<UpdateRow, 'id'>) => {
          backend.updates.push({ ...row, id: backend.nextId })
          backend.nextId += 1
          return Promise.resolve({ data: null, error: null })
        },
      }
      return builder
    },

    rpc(name: string, args: Record<string, unknown>) {
      /*
       * Compaction folds the log into the snapshot and deletes the rows it
       * accounts for. Modelled here with the migration's exact delete bound --
       * strictly `<= p_through_id` -- because that is what makes it safe to
       * run while someone else is still appending: a row inserted mid-compact
       * has a higher id, survives, and is replayed on top of the snapshot.
       */
      if (name === 'compact_document_ydoc') {
        backend.compactCalls += 1
        const documentId = args.p_document_id as string
        const row = backend.documents.get(documentId)
        if (row) row.ydoc = args.p_ydoc as string
        const through = args.p_through_id as number
        backend.updates = backend.updates.filter(
          (update) => !(update.document_id === documentId && update.id <= through),
        )
        return Promise.resolve({ data: null, error: null })
      }

      if (name !== 'seed_document_ydoc') {
        return Promise.resolve({ data: null, error: null })
      }

      backend.seedCalls += 1
      backend.beforeSeed?.()

      const documentId = args.p_document_id as string
      const row = backend.documents.get(documentId)
      if (!row) return Promise.resolve({ data: false, error: null })

      // The whole safety property, in one line: the update applies only while
      // the column is still null, and the caller is told which way it went.
      // First writer wins; everyone else is told to start again.
      if (row.ydoc === null) {
        row.ydoc = args.p_ydoc as string
        return Promise.resolve({ data: true, error: null })
      }
      return Promise.resolve({ data: false, error: null })
    },
  } as unknown as SupabaseClient
}

interface Harness {
  backend: FakeBackend
  bus: MemoryBus
  client: SupabaseClient
  transports: MemoryTransport[]
  createTransport: () => MemoryTransport
}

/**
 * Identities are hoisted out of the render callback on purpose.
 *
 * The client and the transport factory are dependencies of the session's
 * effect. Building them inside the callback would give a new pair on every
 * render, so every state update would tear the session down and start another
 * one -- a loop, not a test.
 */
function harness(): Harness {
  const backend: FakeBackend = {
    documents: new Map(),
    updates: [],
    nextId: 1,
    seedCalls: 0,
    compactCalls: 0,
    reads: 0,
    beforeSeed: null,
  }
  const bus = new MemoryBus()
  const transports: MemoryTransport[] = []

  return {
    backend,
    bus,
    client: fakeClient(backend),
    transports,
    createTransport: () => {
      const transport = new MemoryTransport(bus)
      transports.push(transport)
      return transport
    },
  }
}

describe('useCollaboration', () => {
  describe('seeding an existing note', () => {
    it('converts documents.content into the Yjs document, once', async () => {
      const h = harness()
      h.backend.documents.set('doc-1', { ydoc: null })

      const { result } = renderHook(() =>
        useCollaboration({
          documentId: 'doc-1',
          userId: 'user-a',
          displayName: 'Ada Lovelace',
          sharedForEditing: true,
          content: doc('Mitochondria are the powerhouse'),
          client: h.client,
          createTransport: h.createTransport,
        }),
      )

      await waitFor(() => expect(result.current.active).toBe(true))

      expect(h.backend.seedCalls).toBe(1)
      expect(h.backend.documents.get('doc-1')?.ydoc).not.toBeNull()

      const text = bodyText(result.current.ydoc!)
      expect(text).toContain('Mitochondria are the powerhouse')
      expect(occurrences(text, 'Mitochondria are the powerhouse')).toBe(1)
    })

    it('does not seed a note that already has a Yjs document', async () => {
      const h = harness()
      h.backend.documents.set('doc-1', {
        ydoc: toBase64(encodeSeedUpdate(schema, doc('Already collaborative'))),
      })

      const { result } = renderHook(() =>
        useCollaboration({
          documentId: 'doc-1',
          userId: 'user-a',
          displayName: 'Ada',
          sharedForEditing: true,
          // Deliberately different from what is stored: the CRDT wins, and
          // this stale derived copy must not be layered on top of it.
          content: doc('A stale copy of the content column'),
          client: h.client,
          createTransport: h.createTransport,
        }),
      )

      await waitFor(() => expect(result.current.active).toBe(true))

      expect(h.backend.seedCalls).toBe(0)
      const text = bodyText(result.current.ydoc!)
      expect(text).toContain('Already collaborative')
      expect(text).not.toContain('A stale copy')
    })

    /*
     * A note whose log has rows has been edited collaboratively already, even
     * though the snapshot column is still empty -- it was seeded and then
     * compacted, or seeded by a client that has not compacted yet. Seeding it
     * again would insert a second copy of content its collaborators have since
     * been editing.
     */
    it('does not seed a note that already has update-log rows', async () => {
      const h = harness()
      h.backend.documents.set('doc-1', { ydoc: null })
      h.backend.updates.push({
        id: 1,
        document_id: 'doc-1',
        user_id: 'user-b',
        update_b64: toBase64(encodeSeedUpdate(schema, doc('Written collaboratively'))),
      })
      h.backend.nextId = 2

      const { result } = renderHook(() =>
        useCollaboration({
          documentId: 'doc-1',
          userId: 'user-a',
          displayName: 'Ada',
          sharedForEditing: true,
          content: doc('Written collaboratively'),
          client: h.client,
          createTransport: h.createTransport,
        }),
      )

      await waitFor(() => expect(result.current.active).toBe(true))

      expect(h.backend.seedCalls).toBe(0)
      expect(occurrences(bodyText(result.current.ydoc!), 'Written collaboratively')).toBe(1)
    })

    /*
     * The headline case. The RPC reports that the conditional update did not
     * apply, which means somebody else got there first and may already have
     * typed. The seed just built has to be discarded -- keeping it "because it
     * came from the same content" is precisely how the note ends up saying
     * everything twice.
     */
    it('discards its seed and re-reads when it loses the race', async () => {
      const h = harness()
      h.backend.documents.set('doc-1', { ydoc: null })

      const winner = toBase64(
        encodeSeedUpdate(schema, doc('Existing note', 'Typed by the winner')),
      )
      // The other client's write lands between our read and our write.
      h.backend.beforeSeed = () => {
        h.backend.documents.set('doc-1', { ydoc: winner })
      }

      const { result } = renderHook(() =>
        useCollaboration({
          documentId: 'doc-1',
          userId: 'user-a',
          displayName: 'Ada',
          sharedForEditing: true,
          content: doc('Existing note'),
          client: h.client,
          createTransport: h.createTransport,
        }),
      )

      await waitFor(() => expect(result.current.active).toBe(true))

      expect(h.backend.seedCalls).toBe(1)
      // Our seed never reached storage.
      expect(h.backend.documents.get('doc-1')?.ydoc).toBe(winner)

      const text = bodyText(result.current.ydoc!)
      // The note reads once, not twice, and it includes what the winner had
      // already written -- which is why re-reading is not a formality.
      expect(occurrences(text, 'Existing note')).toBe(1)
      expect(text).toContain('Typed by the winner')
    })

    it('lets exactly one of two simultaneous clients seed, and both agree', async () => {
      const h = harness()
      h.backend.documents.set('doc-1', { ydoc: null })

      const options = (userId: string) => ({
        documentId: 'doc-1',
        userId,
        displayName: userId,
        sharedForEditing: true,
        content: doc('Photosynthesis'),
        client: h.client,
        createTransport: h.createTransport,
      })

      const a = renderHook(() => useCollaboration(options('user-a')))
      const b = renderHook(() => useCollaboration(options('user-b')))

      await waitFor(() => expect(a.result.current.active).toBe(true))
      await waitFor(() => expect(b.result.current.active).toBe(true))

      // Both tried; the database let one through.
      expect(h.backend.seedCalls).toBe(2)

      await waitFor(() => {
        expect(occurrences(bodyText(a.result.current.ydoc!), 'Photosynthesis')).toBe(1)
        expect(occurrences(bodyText(b.result.current.ydoc!), 'Photosynthesis')).toBe(1)
      })
    })
  })

  describe('when collaboration must not engage', () => {
    it('stays off while signed out, and never touches the backend', async () => {
      const h = harness()
      h.backend.documents.set('doc-1', { ydoc: null })

      const { result } = renderHook(() =>
        useCollaboration({
          documentId: 'doc-1',
          // Guest mode. There is no account, no Realtime, and no server to
          // hold a CRDT; the note lives in this browser's localStorage.
          userId: null,
          displayName: 'Guest',
          sharedForEditing: true,
          content: doc('A guest note'),
          client: h.client,
          createTransport: h.createTransport,
        }),
      )

      expect(result.current.status).toBe('off')
      expect(result.current.active).toBe(false)
      // Nothing to wait for is the point: the editor opens immediately.
      expect(result.current.pending).toBe(false)
      expect(result.current.ydoc).toBeNull()

      // Give any stray async work a chance to run before asserting silence.
      await waitFor(() => expect(h.backend.seedCalls).toBe(0))
      expect(h.backend.reads).toBe(0)
      expect(h.transports).toHaveLength(0)
    })

    it('stays off for a private note owned by one person', async () => {
      const h = harness()
      h.backend.documents.set('doc-1', { ydoc: null })

      const { result } = renderHook(() =>
        useCollaboration({
          documentId: 'doc-1',
          userId: 'user-a',
          displayName: 'Ada',
          sharedForEditing: false,
          content: doc('Just mine'),
          client: h.client,
          createTransport: h.createTransport,
        }),
      )

      expect(result.current.status).toBe('off')
      await waitFor(() => expect(h.backend.reads).toBe(0))
      expect(h.backend.seedCalls).toBe(0)
    })

    it('stays off when the deployment has no backend at all', async () => {
      const h = harness()

      const { result } = renderHook(() =>
        useCollaboration({
          documentId: 'doc-1',
          userId: 'user-a',
          displayName: 'Ada',
          sharedForEditing: true,
          content: doc('Local only'),
          client: null,
          createTransport: h.createTransport,
        }),
      )

      expect(result.current.status).toBe('off')
      await waitFor(() => expect(h.transports).toHaveLength(0))
    })
  })

  /*
   * `pending` is what stops the caller opening a single-writer editor for the
   * second it takes to load or seed the Yjs document. Anything typed into that
   * editor would go into a ProseMirror document about to be discarded, so the
   * flag has to be true from the very first render rather than from the first
   * render after the effect has run.
   */
  describe('holding the editor back', () => {
    it('is pending on the first render, and settles', async () => {
      const h = harness()
      h.backend.documents.set('doc-1', { ydoc: null })

      const { result } = renderHook(() =>
        useCollaboration({
          documentId: 'doc-1',
          userId: 'user-a',
          displayName: 'Ada',
          sharedForEditing: true,
          content: doc('An existing note'),
          client: h.client,
          createTransport: h.createTransport,
        }),
      )

      expect(result.current.pending).toBe(true)
      expect(result.current.active).toBe(false)
      expect(result.current.ydoc).toBeNull()

      await waitFor(() => expect(result.current.pending).toBe(false))
      expect(result.current.active).toBe(true)
    })

    // Moving to another note must not report the previous note's session as
    // this one's, however briefly: that is a live Yjs document for the wrong
    // note being handed to an editor showing this one.
    it('does not carry a session over to a different note', async () => {
      const h = harness()
      h.backend.documents.set('doc-1', { ydoc: null })
      h.backend.documents.set('doc-2', { ydoc: null })

      const options = (documentId: string) => ({
        documentId,
        userId: 'user-a',
        displayName: 'Ada',
        sharedForEditing: true,
        content: doc('Note body'),
        client: h.client,
        createTransport: h.createTransport,
      })

      const { result, rerender } = renderHook(
        ({ documentId }: { documentId: string }) => useCollaboration(options(documentId)),
        { initialProps: { documentId: 'doc-1' } },
      )

      await waitFor(() => expect(result.current.active).toBe(true))
      const first = result.current.ydoc

      rerender({ documentId: 'doc-2' })

      expect(result.current.pending).toBe(true)
      expect(result.current.active).toBe(false)
      expect(result.current.ydoc).toBeNull()

      await waitFor(() => expect(result.current.active).toBe(true))
      expect(result.current.ydoc).not.toBe(first)
    })
  })

  describe('lifecycle', () => {
    it('releases the channel when the editor goes away', async () => {
      const h = harness()
      h.backend.documents.set('doc-1', { ydoc: null })

      const { result, unmount } = renderHook(() =>
        useCollaboration({
          documentId: 'doc-1',
          userId: 'user-a',
          displayName: 'Ada',
          sharedForEditing: true,
          content: doc('Some notes'),
          client: h.client,
          createTransport: h.createTransport,
        }),
      )

      await waitFor(() => expect(result.current.active).toBe(true))

      const transport = h.transports[0]
      const disconnect = vi.spyOn(transport, 'disconnect')

      unmount()

      await waitFor(() => expect(disconnect).toHaveBeenCalled())
    })

    /*
     * A caret left behind by someone who closed their tab implies a person who
     * is not there. The provider already handles the announcement; what this
     * asserts is that the hook's teardown actually runs it rather than dropping
     * the provider on the floor.
     */
    it('takes the writer’s cursor off everyone else’s screen', async () => {
      const h = harness()
      h.backend.documents.set('doc-1', { ydoc: null })

      const options = (userId: string) => ({
        documentId: 'doc-1',
        userId,
        displayName: userId,
        sharedForEditing: true,
        content: doc('Shared note'),
        client: h.client,
        createTransport: h.createTransport,
      })

      const a = renderHook(() => useCollaboration(options('user-a')))
      const b = renderHook(() => useCollaboration(options('user-b')))

      await waitFor(() => expect(a.result.current.active).toBe(true))
      await waitFor(() => expect(b.result.current.active).toBe(true))

      const namesSeenByB = () =>
        [...(b.result.current.provider?.awareness.getStates().values() ?? [])].map(
          (state) => (state as { user?: { id?: string } }).user?.id,
        )

      await waitFor(() => expect(namesSeenByB()).toContain('user-a'))

      a.unmount()

      await waitFor(() => expect(namesSeenByB()).not.toContain('user-a'))
    })
  })

  /*
   * Compaction is the one path here that deletes rows.
   *
   * Replaying a keystroke-sized update per row would make a long-lived note
   * slow to open, so the log is periodically folded into a snapshot and the
   * folded rows dropped. The real threshold is 200, which no test reaches a
   * keystroke at a time -- hence the injectable one, so this runs rather than
   * merely typechecking.
   */
  describe('compaction', () => {
    const session = (h: ReturnType<typeof harness>, compactThreshold: number) =>
      renderHook(() =>
        useCollaboration({
          documentId: 'doc-1',
          userId: 'user-a',
          displayName: 'Ada Lovelace',
          sharedForEditing: true,
          content: doc('Start'),
          client: h.client,
          createTransport: h.createTransport,
          compactThreshold,
        }),
      )

    it('leaves a short log alone', async () => {
      const h = harness()
      h.backend.documents.set('doc-1', {
        ydoc: toBase64(encodeSeedUpdate(schema, doc('Start'))),
      })

      const { result } = session(h, 5)
      await waitFor(() => expect(result.current.active).toBe(true))

      result.current.ydoc!.getXmlFragment(COLLAB_FRAGMENT)
      await waitFor(() => expect(h.backend.compactCalls).toBe(0))
    })

    it('folds the log into the snapshot once it grows past the threshold', async () => {
      const h = harness()
      h.backend.documents.set('doc-1', {
        ydoc: toBase64(encodeSeedUpdate(schema, doc('Start'))),
      })

      const { result } = session(h, 2)
      await waitFor(() => expect(result.current.active).toBe(true))

      const ydoc = result.current.ydoc!
      // Three separate transactions, so three local updates.
      for (const word of ['one', 'two', 'three']) {
        ydoc.getArray('scratch').push([word])
      }

      await waitFor(() => expect(h.backend.compactCalls).toBeGreaterThan(0))

      // The snapshot now stands in for the rows that were deleted.
      expect(h.backend.documents.get('doc-1')?.ydoc).not.toBeNull()
      await waitFor(() => expect(h.backend.updates.length).toBeLessThanOrEqual(1))
    })

    /*
     * The property that makes compacting safe while someone else is typing:
     * the snapshot only accounts for rows up to a known id, and the delete is
     * bounded by that id. A row that arrives mid-compact has a higher id,
     * survives, and is replayed on top.
     */
    it('does not delete a row that arrived after the snapshot was taken', async () => {
      const h = harness()
      h.backend.documents.set('doc-1', {
        ydoc: toBase64(encodeSeedUpdate(schema, doc('Start'))),
      })

      const { result } = session(h, 2)
      await waitFor(() => expect(result.current.active).toBe(true))

      const ydoc = result.current.ydoc!
      for (const word of ['one', 'two', 'three']) {
        ydoc.getArray('scratch').push([word])
      }
      await waitFor(() => expect(h.backend.compactCalls).toBeGreaterThan(0))

      // Somebody else appends after the compaction has been through.
      const highest = h.backend.nextId
      h.backend.updates.push({
        id: highest,
        document_id: 'doc-1',
        user_id: 'user-b',
        update_b64: toBase64(encodeSeedUpdate(schema, doc('From the other writer'))),
      })
      h.backend.nextId += 1

      // Still there: the delete was bounded, not a truncation.
      expect(h.backend.updates.some((row) => row.id === highest)).toBe(true)
    })

    // Compaction is an optimisation. Failing it must cost a slower load, not
    // a document.
    it('survives a failed compaction with the note intact', async () => {
      const h = harness()
      h.backend.documents.set('doc-1', {
        ydoc: toBase64(encodeSeedUpdate(schema, doc('Start'))),
      })
      const before = h.backend.documents.get('doc-1')!.ydoc

      const failing = {
        ...h,
        client: {
          ...(h.client as unknown as Record<string, unknown>),
          from: (h.client as unknown as { from: unknown }).from,
          rpc: (name: string, args: Record<string, unknown>) =>
            name === 'compact_document_ydoc'
              ? Promise.resolve({ data: null, error: { message: 'nope' } })
              : (h.client as unknown as {
                  rpc: (n: string, a: Record<string, unknown>) => Promise<unknown>
                }).rpc(name, args),
        } as unknown as SupabaseClient,
      }

      const { result } = session(failing, 2)
      await waitFor(() => expect(result.current.active).toBe(true))

      const ydoc = result.current.ydoc!
      for (const word of ['one', 'two', 'three']) {
        ydoc.getArray('scratch').push([word])
      }

      await waitFor(() => expect(result.current.active).toBe(true))
      // The session is still usable and the stored snapshot is untouched.
      expect(bodyText(result.current.ydoc!)).toContain('Start')
      expect(h.backend.documents.get('doc-1')?.ydoc).toBe(before)
    })
  })
})
