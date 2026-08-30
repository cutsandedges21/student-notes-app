import { Extension, type CommandProps } from '@tiptap/core'

/**
 * Block and first-line indentation for paragraphs and headings.
 *
 * Two separate attributes, because Tab and the toolbar buttons mean different
 * things:
 *
 * - `indent` is a left indent. It shifts the whole block, every wrapped line
 *   of it, and is what the toolbar's increase/decrease buttons apply.
 * - `firstLineIndent` shifts only the first line, and is what Tab applies.
 *
 * Tab used to drive `indent`, which is why pressing it in a paragraph of
 * continuous prose appeared to indent everything: one paragraph is one block,
 * however many lines it happens to wrap onto, so the whole passage moved.
 * Word and Docs both treat Tab at the head of a paragraph as a first-line
 * indent and Tab mid-sentence as a tab stop; this does the same.
 */

/** Half an inch at 96dpi -- the step Docs and Word both use. */
const INDENT_STEP = 48
const MAX_INDENT = 480

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    indent: {
      /** Shifts every selected block, including its wrapped lines. */
      indent: () => ReturnType
      outdent: () => ReturnType
      /** Shifts only the first line of the block holding the caret. */
      indentFirstLine: () => ReturnType
      outdentFirstLine: () => ReturnType
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
          firstLineIndent: {
            default: 0,
            parseHTML: (element) => parseInt(element.style.textIndent, 10) || 0,
            renderHTML: (attributes) =>
              attributes.firstLineIndent
                ? { style: `text-indent: ${attributes.firstLineIndent}px` }
                : {},
          },
        },
      },
    ]
  },

  addKeyboardShortcuts() {
    /*
     * Inside a list the list extension's own Tab is the right behaviour
     * (nesting the item), so this stands aside and lets it run. Everywhere
     * else the handler always reports handled, even when nothing moved:
     * falling through would hand Tab back to the browser and tab the writer
     * out of the page mid-sentence.
     */
    const inList = () =>
      this.editor.isActive('listItem') || this.editor.isActive('taskItem')

    /** True when the caret sits before the first character of its block. */
    const atBlockStart = () => {
      const { selection } = this.editor.state
      return selection.empty && selection.$from.parentOffset === 0
    }

    return {
      Tab: () => {
        if (inList()) return false

        // A selection is a deliberate "all of this", so it keeps the block
        // behaviour the toolbar buttons apply.
        if (!this.editor.state.selection.empty) {
          this.editor.commands.indent()
          return true
        }

        if (atBlockStart()) this.editor.commands.indentFirstLine()
        // Mid-sentence Tab advances to the next stop rather than moving the
        // paragraph out from under the writer.
        else this.editor.commands.insertContent('\t')

        return true
      },

      'Shift-Tab': () => {
        if (inList()) return false

        if (!this.editor.state.selection.empty) {
          this.editor.commands.outdent()
          return true
        }

        // Falls through to the block indent so Shift+Tab can also undo what
        // the toolbar button applied, rather than doing nothing once the
        // first-line indent is already back to zero.
        if (!this.editor.commands.outdentFirstLine()) this.editor.commands.outdent()
        return true
      },
    }
  },

  addCommands() {
    const { types } = this.options

    /**
     * Moves one indent attribute by one step.
     *
     * Every block touched by the selection moves, not just the one holding the
     * caret -- selecting three paragraphs and clicking indent should indent
     * all three, which is what makes the toolbar button feel like Docs'. With
     * a collapsed caret that range covers exactly one block.
     */
    const shift =
      (attribute: 'indent' | 'firstLineIndent', direction: 1 | -1) =>
      () =>
      ({ state, dispatch }: CommandProps) => {
        const { tr, selection } = state
        let changed = false

        state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
          if (!types.includes(node.type.name)) return

          const current = (node.attrs[attribute] as number) || 0
          const next = Math.max(
            0,
            Math.min(MAX_INDENT, current + direction * INDENT_STEP),
          )
          if (next === current) return

          tr.setNodeAttribute(pos, attribute, next)
          changed = true
        })

        if (changed && dispatch) dispatch(tr)
        return changed
      }

    return {
      indent: shift('indent', 1),
      outdent: shift('indent', -1),
      indentFirstLine: shift('firstLineIndent', 1),
      outdentFirstLine: shift('firstLineIndent', -1),
    }
  },
})
