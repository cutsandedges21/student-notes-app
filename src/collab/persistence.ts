import * as Y from 'yjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fromBase64, toBase64 } from './encoding'

/**
 * Durability for a collaborative document.
 *
 * Delivery and durability are different problems. The transport gets an edit
 * onto the other person's screen; this gets it to survive both of them closing
 * the tab. Neither substitutes for the other, which is why the provider
 * reports local updates separately from broadcasting them.
 *
 * Storage is a compacted snapshot plus an append-only log of everything since.
 * The log is append-only for a reason worth stating plainly: if each client
 * instead wrote the whole merged state, a client could only ever write what it
 * had received. One that was mid-sync, or had missed a broadcast, would
 * persist a state missing someone else's work -- and being the most recent
 * write, it would win. That is the precise failure collaborative editing
 * exists to eliminate, reintroduced at the storage layer. Appends cannot
 * conflict, so no writer can erase another's.
 */

/** Merge the log into the snapshot once it gets longer than this. */
export const COMPACT_THRESHOLD = 200

/** How long local edits are gathered before one write. */
export const PERSIST_DEBOUNCE_MS = 1_500

export interface LoadedDocument {
  /** Everything stored, merged: snapshot plus log. */
  update: Uint8Array | null
  /** Highest log id included, for compaction to delete through. */
  throughId: number
  /** How many log rows were replayed. */
  updateCount: number
}

/**
 * Reads a document's stored state.
 *
 * Returns one merged update rather than applying anything, so the caller
 * decides when it lands -- which matters, because it must be applied before
 * connecting, with the provider as its origin, or loading the document
 * rebroadcasts all of it to everyone already editing.
 */
export async function loadYDoc(
  supabase: SupabaseClient,
  documentId: string,
): Promise<LoadedDocument> {
  const [snapshot, log] = await Promise.all([
    supabase.from('documents').select('ydoc').eq('id', documentId).maybeSingle(),
    supabase
      .from('document_yupdates')
      .select('id, update_b64')
      .eq('document_id', documentId)
      .order('id', { ascending: true }),
  ])

  if (snapshot.error) throw snapshot.error
  if (log.error) throw log.error

  const parts: Uint8Array[] = []
  const stored = snapshot.data?.ydoc as string | null | undefined
  if (stored) parts.push(fromBase64(stored))

  const rows = (log.data ?? []) as { id: number; update_b64: string }[]
  for (const row of rows) parts.push(fromBase64(row.update_b64))

  return {
    // mergeUpdates rather than applying in sequence: one update to hand to the
    // provider, and Yjs does the merging it is built for.
    update: parts.length > 0 ? Y.mergeUpdates(parts) : null,
    throughId: rows.length > 0 ? rows[rows.length - 1].id : 0,
    updateCount: rows.length,
  }
}

/** Appends a batch of local updates. */
export async function appendYUpdate(
  supabase: SupabaseClient,
  documentId: string,
  userId: string,
  updates: Uint8Array[],
): Promise<void> {
  if (updates.length === 0) return

  const { error } = await supabase.from('document_yupdates').insert({
    document_id: documentId,
    user_id: userId,
    // Merged before writing: a burst of keystrokes becomes one row rather than
    // thirty, which keeps the log short and the next load fast.
    update_b64: toBase64(Y.mergeUpdates(updates)),
  })

  if (error) throw error
}

/**
 * Folds the log into the snapshot.
 *
 * `throughId` is the highest row this snapshot accounts for. Deleting strictly
 * through it is what makes concurrent editing safe during compaction: anything
 * inserted while this was in flight has a higher id, survives the delete, and
 * is replayed on top of the new snapshot.
 */
export async function compactYDoc(
  supabase: SupabaseClient,
  documentId: string,
  doc: Y.Doc,
  throughId: number,
): Promise<void> {
  if (throughId <= 0) return

  const { error } = await supabase.rpc('compact_document_ydoc', {
    p_document_id: documentId,
    p_ydoc: toBase64(Y.encodeStateAsUpdate(doc)),
    p_through_id: throughId,
  })

  if (error) throw error
}

/**
 * Batches local updates and writes them.
 *
 * Debounced for the same reason autosave is: a keystroke is not a save. The
 * queue is only cleared once the write succeeds, so a failed one is retried
 * with the next batch rather than dropped -- an update lost here is lost for
 * good, since the transport has no replay either.
 */
export function createYPersister(
  supabase: SupabaseClient,
  documentId: string,
  userId: string,
  options: { debounceMs?: number } = {},
) {
  const debounceMs = options.debounceMs ?? PERSIST_DEBOUNCE_MS
  let queue: Uint8Array[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let inFlight: Promise<void> | null = null

  async function write(): Promise<void> {
    if (inFlight) await inFlight
    if (queue.length === 0) return

    const batch = queue
    queue = []

    inFlight = appendYUpdate(supabase, documentId, userId, batch)
      .catch((caught) => {
        // Put them back at the front: losing an update here loses it entirely.
        queue = [...batch, ...queue]
        console.error('[collab] failed to persist updates; will retry:', caught)
      })
      .finally(() => {
        inFlight = null
      })

    await inFlight
  }

  return {
    push(update: Uint8Array) {
      queue.push(update)
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        void write()
      }, debounceMs)
    },

    async flush(): Promise<void> {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      await write()
    },

    /** Exposed for tests and for the unload path. */
    get pending() {
      return queue.length
    },
  }
}
