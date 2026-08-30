import { Node, mergeAttributes } from '@tiptap/core'
import { Selection } from '@tiptap/pm/state'

/**
 * A manual page break.
 *
 * Unlike the automatic breaks -- which are measurements of how today's text
 * happens to land at today's margins, and are recomputed rather than stored --
 * this one is the writer's intent, so it is a real node and travels with the
 * document. The pagination engine treats it as a hard boundary: whatever
 * follows starts a new page regardless of how much room is left.
 */

export const PAGE_BREAK_NAME = 'pageBreak'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageBreak: {
      /** Insert a page break at the cursor. */
      setPageBreak: () => ReturnType
    }
  }
}

export const PageBreak = Node.create({
  name: PAGE_BREAK_NAME,
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  /*
   * StarterKit's HardBreak also claims Mod-Enter. Tiptap resolves keymap
   * conflicts by extension priority, so this has to outrank the default (100)
   * to win. Shift-Enter still inserts a line break, which is the split Docs
   * and Word both use.
   */
  priority: 1000,

  parseHTML() {
    return [{ tag: 'div[data-page-break]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-page-break': '',
        class: 'doc-page-break',
        'aria-label': 'Page break',
      }),
    ]
  },

  addCommands() {
    return {
      setPageBreak:
        () =>
        ({ chain, state }) => {
          // A break as the last node in the document would leave nowhere to
          // carry on typing, so it gets a paragraph to land in.
          const atDocumentEnd = state.selection.to >= Selection.atEnd(state.doc).to

          return chain()
            .insertContent(
              atDocumentEnd
                ? [{ type: PAGE_BREAK_NAME }, { type: 'paragraph' }]
                : { type: PAGE_BREAK_NAME },
            )
            .run()
        },
    }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Enter': () => this.editor.commands.setPageBreak(),
    }
  },
})
