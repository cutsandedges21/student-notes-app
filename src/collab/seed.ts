import * as Y from 'yjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Schema } from '@tiptap/pm/model'
import type { JSONContent } from '@tiptap/core'
import { prosemirrorJSONToYDoc } from '@tiptap/y-tiptap'
import { toBase64 } from './encoding'
import { loadYDoc, type LoadedDocument } from './persistence'

/**
 * The first collaborative open of a note that already has content.
 *
 * Notes written before collaborative editing hold their text in
 * `documents.content` as Tiptap JSON and have no Yjs document at all. Opening
 * one collaboratively has to convert that content into a CRDT and store it --
 * once, ever, across every client that might open it.
 *
 * "Once" is the whole problem. A Yjs merge is not a de-duplicating union: two
 * clients that each build a document from the same paragraph produce two
 * unrelated insertions of it, and merging them leaves the note holding its
 * content twice. No error, no warning, and the person who owns the note finds
 * their essay doubled. That is silent corruption of a student's work, so it is
 * decided in the database rather than by racing clients -- see
 * supabase/migrations/20260901000300_seed_ydoc.sql for the statement that makes
 * it atomic.
 *
 * The client's half of the contract is the part that is easy to get wrong: when
 * the database says the seed did not apply, the seed must be *discarded*, not
 * kept "because we built it from the same content anyway". Somebody else's
 * state is authoritative from that moment, and it may already contain edits.
 */

/**
 * The Y.XmlFragment name Tiptap's Collaboration extension binds to.
 *
 * Its `field` option defaults to 'default', and the fragment a document is
 * seeded into has to be the one the editor later reads. Getting this wrong
 * gives an editor that is empty next to a database row that is not.
 */
export const COLLAB_FRAGMENT = 'default'

export interface SeededDocument extends LoadedDocument {
  /** True when this client wrote the first snapshot. Diagnostics only. */
  seeded: boolean
}

/**
 * Builds the update that carries `content` into a fresh Yjs document.
 *
 * The temporary Y.Doc is destroyed rather than returned: handing back a live
 * document invites a caller to edit it before it is connected to anything,
 * and the update is the only part that travels.
 */
export function encodeSeedUpdate(schema: Schema, content: JSONContent): Uint8Array {
  const seed = prosemirrorJSONToYDoc(schema, content, COLLAB_FRAGMENT)
  try {
    return Y.encodeStateAsUpdate(seed)
  } finally {
    seed.destroy()
  }
}

/**
 * Reads a document's Yjs state, seeding it from `documents.content` on the
 * first collaborative open.
 *
 * `loadYDoc` returning `update === null` is the seeding condition, and it is
 * stronger than "the snapshot column is empty": it means there is no snapshot
 * *and* no rows in the append-only update log. A note with log rows has been
 * edited collaboratively already, so seeding it would insert a second copy of
 * content its collaborators have since changed. That case never reaches the
 * RPC at all.
 */
export async function loadOrSeedYDoc(
  supabase: SupabaseClient,
  documentId: string,
  content: JSONContent,
  schema: Schema,
): Promise<SeededDocument> {
  const loaded = await loadYDoc(supabase, documentId)
  if (loaded.update !== null) return { ...loaded, seeded: false }

  const seed = encodeSeedUpdate(schema, content)

  const { data, error } = await supabase.rpc('seed_document_ydoc', {
    p_document_id: documentId,
    p_ydoc: toBase64(seed),
  })

  if (error) throw error

  // The RPC reports whether its conditional update actually applied.
  if (data === true) {
    return { update: seed, throughId: 0, updateCount: 0, seeded: true }
  }

  /*
   * Somebody else seeded first.
   *
   * The seed just built is thrown away without being applied anywhere. It is
   * tempting to keep it -- it was derived from the same `documents.content`,
   * so surely it is the same document? It is not: it is a second, unrelated
   * set of Yjs insertions describing the same words, and merging it with the
   * winner's state is exactly how a note ends up saying everything twice.
   *
   * Re-reading is also not merely a formality. Between their write and this
   * read the winner may already have typed, and their state -- not the row we
   * loaded a moment ago -- is what everyone else is now editing.
   */
  const again = await loadYDoc(supabase, documentId)
  return { ...again, seeded: false }
}
