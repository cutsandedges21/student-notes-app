import { Extension } from '@tiptap/core'

/**
 * Line spacing, as a property of the paragraph.
 *
 * The menu used to call `setLineHeight` from `@tiptap/extension-text-style`,
 * which is a *mark*: it wraps the selection in `<span style="line-height:2">`.
 * That is the wrong element for the job. A line box is laid out by its block
 * container, so a span inside a paragraph does not change the spacing between
 * that paragraph's lines -- the options were all applied correctly and none of
 * them did anything visible, which is exactly what was reported.
 *
 * Line spacing is a block property in every editor that has one, for this
 * reason. So it is stored as an attribute on the textblock nodes and rendered
 * as an inline style on the block itself.
 *
 * Applied to whole blocks rather than to the selection: selecting three words
 * and asking for double spacing means the paragraph they are in, because there
 * is no such thing as three words being double spaced on their own.
 */

/** The blocks that carry spacing. Lists inherit from their list item. */
const SPACED_BLOCKS = ['paragraph', 'heading', 'listItem', 'taskItem'] as const

/**
 * The default, matching the editor's own stylesheet.
 *
 * Stored as null rather than as "1.75" so an untouched paragraph carries no
 * attribute at all: nothing is written into the document until somebody
 * chooses a spacing, and exports stay clean.
 */
export const DEFAULT_LINE_HEIGHT = '1.75'

export interface LineSpacingOptions {
  types: string[]
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    lineSpacing: {
      /** Sets spacing on every block touched by the selection. */
      setLineSpacing: (value: string) => ReturnType
      /** Returns the blocks to the stylesheet's default. */
      unsetLineSpacing: () => ReturnType
    }
  }
}

export const LineSpacing = Extension.create<LineSpacingOptions>({
  name: 'lineSpacing',

  addOptions() {
    return { types: [...SPACED_BLOCKS] }
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (element) => element.style.lineHeight || null,
            renderHTML: (attributes) => {
              if (!attributes.lineHeight) return {}
              return { style: `line-height: ${attributes.lineHeight}` }
            },
          },
        },
      },
    ]
  },

  addCommands() {
    return {
      setLineSpacing:
        (value: string) =>
        ({ commands, editor }) =>
          // Every configured type is attempted, and the ones the selection does
          // not touch simply report false. Requiring all of them to succeed
          // would make spacing fail on any selection that is not a paragraph.
          this.options.types
            .map((type) =>
              editor.schema.nodes[type] ? commands.updateAttributes(type, { lineHeight: value }) : false,
            )
            .some(Boolean),

      unsetLineSpacing:
        () =>
        ({ commands, editor }) =>
          this.options.types
            .map((type) =>
              editor.schema.nodes[type] ? commands.resetAttributes(type, 'lineHeight') : false,
            )
            .some(Boolean),
    }
  },
})

/**
 * The spacing in force at the selection.
 *
 * Reads the block the caret is in rather than a mark, and falls back to the
 * stylesheet default so the menu shows a tick against what is actually on
 * screen instead of against nothing.
 */
export function activeLineHeight(
  attributes: Record<string, unknown>,
  fallback = DEFAULT_LINE_HEIGHT,
): string {
  const value = attributes.lineHeight
  return typeof value === 'string' && value ? value : fallback
}
