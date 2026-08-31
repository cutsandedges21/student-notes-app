import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as Y from 'yjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createYPersister, loadYDoc } from './persistence'
import { toBase64 } from './encoding'

/*
 * Durability is a separate problem from delivery, and it has its own way of
 * losing work: an update that fails to persist is gone for good, because the
 * transport has no replay either. These tests are mostly about that -- what
 * happens when the write fails, and whether anything is dropped on the floor.
 */

/** Minimal fake of the query builder chain these functions use. */
function fakeSupabase(options: {
  ydoc?: string | null
  log?: { id: number; update_b64: string }[]
  insert?: (row: unknown) => Promise<{ error: unknown }>
}) {
  const inserted: unknown[] = []

  const client = {
    from(table: string) {
      if (table === 'documents') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { ydoc: options.ydoc ?? null }, error: null }),
            }),
          }),
        }
      }

      return {
        select: () => ({
          eq: () => ({
            order: async () => ({ data: options.log ?? [], error: null }),
          }),
        }),
        insert: async (row: unknown) => {
          inserted.push(row)
          if (options.insert) return options.insert(row)
          return { error: null }
        },
      }
    },
  } as unknown as SupabaseClient

  return { client, inserted }
}

const updateFor = (text: string) => {
  const doc = new Y.Doc()
  doc.getText('body').insert(0, text)
  return Y.encodeStateAsUpdate(doc)
}

describe('loadYDoc', () => {
  it('returns nothing for a document that has never been edited', async () => {
    const { client } = fakeSupabase({ ydoc: null, log: [] })
    const loaded = await loadYDoc(client, 'doc-1')

    expect(loaded.update).toBeNull()
    expect(loaded.throughId).toBe(0)
    expect(loaded.updateCount).toBe(0)
  })

  it('merges the snapshot with the log into one update', async () => {
    const snapshot = new Y.Doc()
    snapshot.getText('body').insert(0, 'From the snapshot. ')

    const later = new Y.Doc()
    Y.applyUpdate(later, Y.encodeStateAsUpdate(snapshot))
    later.getText('body').insert(later.getText('body').length, 'From the log.')
    const diff = Y.encodeStateAsUpdate(later, Y.encodeStateVector(snapshot))

    const { client } = fakeSupabase({
      ydoc: toBase64(Y.encodeStateAsUpdate(snapshot)),
      log: [{ id: 7, update_b64: toBase64(diff) }],
    })

    const loaded = await loadYDoc(client, 'doc-1')
    const restored = new Y.Doc()
    Y.applyUpdate(restored, loaded.update!)

    expect(restored.getText('body').toString()).toBe('From the snapshot. From the log.')
    // What compaction may delete through.
    expect(loaded.throughId).toBe(7)
    expect(loaded.updateCount).toBe(1)
  })

  it('reads a log with no snapshot yet', async () => {
    const { client } = fakeSupabase({
      ydoc: null,
      log: [{ id: 3, update_b64: toBase64(updateFor('Only a log.')) }],
    })

    const loaded = await loadYDoc(client, 'doc-1')
    const restored = new Y.Doc()
    Y.applyUpdate(restored, loaded.update!)

    expect(restored.getText('body').toString()).toBe('Only a log.')
    expect(loaded.throughId).toBe(3)
  })
})

describe('createYPersister', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('writes nothing until the debounce elapses', async () => {
    const { client, inserted } = fakeSupabase({})
    const persister = createYPersister(client, 'doc-1', 'user-1', { debounceMs: 100 })

    persister.push(updateFor('a'))
    expect(inserted).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(100)
    expect(inserted).toHaveLength(1)
  })

  // A burst of keystrokes must not become a row each, or the log grows so fast
  // that opening the note replays thousands of updates.
  it('coalesces a burst into a single row', async () => {
    const { client, inserted } = fakeSupabase({})
    const persister = createYPersister(client, 'doc-1', 'user-1', { debounceMs: 100 })

    persister.push(updateFor('a'))
    persister.push(updateFor('b'))
    persister.push(updateFor('c'))
    await vi.advanceTimersByTimeAsync(100)

    expect(inserted).toHaveLength(1)
  })

  it('flush writes immediately without waiting out the debounce', async () => {
    const { client, inserted } = fakeSupabase({})
    const persister = createYPersister(client, 'doc-1', 'user-1', { debounceMs: 10_000 })

    persister.push(updateFor('a'))
    await persister.flush()

    expect(inserted).toHaveLength(1)
  })

  it('flush on an empty queue does nothing', async () => {
    const { client, inserted } = fakeSupabase({})
    const persister = createYPersister(client, 'doc-1', 'user-1', { debounceMs: 10 })

    await persister.flush()
    expect(inserted).toHaveLength(0)
  })

  /*
   * The property that matters most here. An update dropped on a failed write
   * is not recoverable from anywhere else -- the transport has no replay, and
   * the local document will never emit it again.
   */
  it('keeps updates queued when the write fails, and retries them', async () => {
    let attempt = 0
    const { client, inserted } = fakeSupabase({
      insert: async () => {
        attempt += 1
        return attempt === 1 ? { error: new Error('network down') } : { error: null }
      },
    })

    const persister = createYPersister(client, 'doc-1', 'user-1', { debounceMs: 100 })

    persister.push(updateFor('first'))
    await vi.advanceTimersByTimeAsync(100)

    // Attempted and failed; still held rather than lost.
    expect(inserted).toHaveLength(1)
    expect(persister.pending).toBe(1)

    persister.push(updateFor('second'))
    await vi.advanceTimersByTimeAsync(100)

    expect(persister.pending).toBe(0)
    // The retry carried both the failed update and the new one.
    expect(inserted).toHaveLength(2)
  })

  /*
   * A save must not overtake one already running: two inserts racing means the
   * log can record them out of order, and an edit pushed while a write was in
   * flight must still be written rather than silently coalesced away.
   */
  it('does not lose an update pushed while a write is in flight', async () => {
    // Built up front rather than inside the executor, so it is definitely
    // assigned before anything can await it.
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    let started = 0
    const { client, inserted } = fakeSupabase({
      insert: async () => {
        started += 1
        // Only the first write blocks; later ones settle immediately.
        if (started === 1) await gate
        return { error: null }
      },
    })

    const persister = createYPersister(client, 'doc-1', 'user-1', { debounceMs: 10 })

    persister.push(updateFor('first'))
    // Fire the debounce without awaiting the write it starts.
    vi.advanceTimersByTime(10)
    await Promise.resolve()
    expect(started).toBe(1)

    // Arrives mid-write.
    persister.push(updateFor('during'))
    release()

    await persister.flush()

    expect(inserted).toHaveLength(2)
    expect(persister.pending).toBe(0)
  })
})
