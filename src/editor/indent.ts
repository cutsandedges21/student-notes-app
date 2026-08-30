import { Extension, type CommandProps } from '@tiptap/core'

/**
 * Block indentation for paragraphs and headings.
 *
 * The toolbar's two indent buttons need something to drive outside of lists,
 * where `sinkListItem`/`liftListItem` already do the job. Rather than reach
 * for a blockquote (which carries meaning we don't want) this stores a plain
 * `indent` attribute in half-inch steps and renders it as `margin-left`, so it
 * round-trips through the saved JSON like any other node attribute.
 */

/** Half an inch at 96dpi -- the step Docs and Word both use. */
const INDENT_STEP = 48
const MAX_INDENT = 480

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    indent: {
      indent: () => ReturnType
      outdent: () => ReturnType
    }
  }
}

export interface IndentOptions {
  types: string[]
}

export const Indent = Extension.create<IndentOptions>({
  name: 'indent',

  addOptions() {
    return { types: ['paragraph', 'heading'] }
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element) => parseInt(element.style.marginLeft, 10) || 0,
            renderHTML: (attributes) =>
              attributes.indent
                ? { style: `margin-left: ${attributes.indent}px` }
                : {},
          },
        },
      },
    ]
  },

  addKeyboardShortcuts() {
    /*
     * Tab indents, Shift+Tab outdents -- what every editor does and what the
     * commands were missing, so the key did nothing but move focus out of the
     * document.
     *
     * Inside a list the list extension's own Tab is the right behaviour
     * (nesting the item), so this stands aside and lets it run. Everywhere
     * else the handler always reports handled, even when already at the
     * maximum: falling through would hand Tab back to the browser and tab the
     * writer out of the page mid-sentence.
     */
    const inList = () =>
      this.editor.isActive('listItem') || this.editor.isActive('taskItem')

    return {
      Tab: () => {
        if (inList()) return false
        this.editor.commands.indent()
        return true
      },
      'Shift-Tab': () => {
        if (inList()) return false
        this.editor.commands.outdent()
        return true
      },
    }
  },

  addCommands() {
    const { types } = this.options

    // Every block touched by the selection moves, not just the one holding the
    // caret -- selecting three paragraphs and clicking indent should indent all
    // three, which is what makes the button feel like the one in Docs.
    const shift = (direction: 1 | -1) => () => ({ state, dispatch }: CommandProps) => {
      const { tr, selection } = state
      let changed = false

      state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
        if (!types.includes(node.type.name)) return

        const current = (node.attrs.indent as number) || 0
        const next = Math.max(0, Math.min(MAX_INDENT, current + direction * INDENT_STEP))
        if (next === current) return

        tr.setNodeAttribute(pos, 'indent', next)
        changed = true
      })

      if (changed && dispatch) dispatch(tr)
      return changed
    }

    return { indent: shift(1), outdent: shift(-1) }
  },
})
