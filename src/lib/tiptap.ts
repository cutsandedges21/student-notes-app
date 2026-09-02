import type { JSONContent } from '@tiptap/react'

/**
 * The only node types that flow inline within a block. Everything else is
 * block-level and occupies its own line.
 *
 * Inverted deliberately: enumerating inline types is stable (there are two),
 * while enumerating block types is not — every new Tiptap extension would
 * need to be added here, and forgetting one silently concatenates adjacent
 * blocks with no separator (e.g. two consecutive lists mashing their last
 * and first items together).
 */
const INLINE_TYPES = new Set(['text', 'hardBreak'])

/**
 * Flattens a Tiptap JSON document to plain text.
 *
 * This is denormalized into `documents.content_text` on every save so the AI
 * context layer never has to walk Tiptap JSON.
 */
export function extractPlainText(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? ''

  // hardBreak (Shift+Enter) is inline for layout purposes -- it doesn't
  // start a new block -- but it still represents a line break the user
  // explicitly typed. Treating it as a no-op would mash the surrounding
  // words together (e.g. "Line oneLine two"), so it contributes its own
  // newline instead.
  if (node.type === 'hardBreak') return '\n'

  // Equations are atoms: the formula lives in `attrs.latex` and there is no
  // text content underneath, so the generic walk below returns nothing and the
  // equation disappears from `content_text` entirely. The AI reads that field,
  // which means a note whose whole point is a derivation would reach the model
  // as a paragraph of prose wrapped around a hole. The LaTeX source is the only
  // textual form the equation has, so it is what gets written.
  if (node.type === 'inlineMath' || node.type === 'blockMath') {
    return typeof node.attrs?.latex === 'string' ? node.attrs.latex : ''
  }

  // A row's cells are block nodes, so the generic rule below would give each
  // its own line -- and the row grouping, which is the entire meaning of a
  // table, would be gone by the time the AI reads the note back. Pipes keep it,
  // and are what the model was asked to write in the first place.
  if (node.type === 'tableRow') {
    return (node.content ?? []).map(extractPlainText).join(' | ')
  }

  const children = node.content ?? []
  const parts = children.map(extractPlainText)

  const hasBlockChildren = children.some((child) => !INLINE_TYPES.has(child.type ?? ''))

  return hasBlockChildren ? parts.filter((part) => part !== '').join('\n') : parts.join('')
}
