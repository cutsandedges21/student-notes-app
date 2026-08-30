import { Extension } from '@tiptap/core'
import type { PaginationController } from './controller'
import { paginationPlugin } from './paginationPlugin'

/**
 * Mounts the pagination engine into a Tiptap editor.
 *
 * The controller has to be created per editor rather than per module, because
 * it carries that editor's live margins, zoom and page count. `Pagination` is
 * therefore configured at `useEditor` time rather than living in the shared
 * `editorExtensions` list -- the manual page break node does live there, since
 * that one is schema and every editor has to agree on it.
 */

export interface PaginationOptions {
  /** Shared with React. Omit to leave the editor unpaginated. */
  controller: PaginationController | null
}

export const Pagination = Extension.create<PaginationOptions>({
  name: 'pagination',

  addOptions() {
    return { controller: null }
  },

  addProseMirrorPlugins() {
    const { controller } = this.options
    return controller ? [paginationPlugin(controller)] : []
  },
})
