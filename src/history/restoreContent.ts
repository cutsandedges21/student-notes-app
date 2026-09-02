import type { Editor } from '@tiptap/react'
import type { JSONContent } from '@tiptap/react'

/**
 * Putting an old version back into the editor.
 *
 * The obvious implementation is `editor.commands.setContent(version)`, and it
 * is avoided here. `DocumentEditor` records that under a Yjs binding a
 * `setContent` replacement can reach the CRDT as an insertion rather than a
 * swap, leaving the note holding its own text twice on every screen -- which
 * is why it refuses to re-sync content while collaborating.
 *
 * Measured rather than assumed: on two already-synced documents `setContent`
 * does converge, so that hazard is not universal. It belongs to the re-sync
 * path, where content is set around the moment stored state is seeded into the
 * document. A restore is a user-initiated replacement of everything, and is
 * exactly the operation where being wrong is unrecoverable, so it does not
 * rely on being on the safe side of that distinction.
 *
 * Instead the replacement is one ordinary ProseMirror transaction over the
 * whole document. `ySyncPlugin` translates a transaction into Yjs deltas the
 * same way it translates typing, so a restore converges on every connected
 * client by the same mechanism as any other edit -- no special case to be on
 * the wrong side of.
 *
 * One transaction, not a delete followed by an insert: two would be two undo
 * steps, and would leave a moment where the note was legitimately empty --
 * which autosave could observe and persist.
 */

export type RestoreResult =
  | { ok: true }
  | { ok: false; reason: 'unparseable' | 'no-editor' }

/**
 * Replaces the whole document with `content`, atomically.
 *
 * Returns a result rather than throwing: a version row whose JSON no longer
 * matches the current schema is a real possibility once extensions change, and
 * the caller needs to be able to say so rather than crash the editor.
 */
export function restoreContent(
  editor: Editor | null,
  content: JSONContent,
): RestoreResult {
  if (!editor) return { ok: false, reason: 'no-editor' }

  let node
  try {
    node = editor.schema.nodeFromJSON(content)
  } catch {
    /*
     * Thrown when the stored JSON names a node or mark this editor has no
     * schema for -- an old version written before an extension was removed,
     * for instance. Refusing is the only safe answer: ProseMirror would
     * otherwise drop what it did not recognise and the "restore" would quietly
     * return a version that never existed.
     */
    return { ok: false, reason: 'unparseable' }
  }

  const { state, view } = editor
  const tr = state.tr.replaceWith(0, state.doc.content.size, node.content)

  /*
   * `addToHistory` is left alone deliberately. A restore should be undoable
   * like any other edit -- someone restoring the wrong version needs Ctrl+Z to
   * work, and it is the only recovery that does not require the panel again.
   */
  tr.setMeta('restore', true)
  view.dispatch(tr)

  return { ok: true }
}
