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

  const children = node.content ?? []
  const parts = children.map(extractPlainText)

  const hasBlockChildren = children.some((child) => !INLINE_TYPES.has(child.type ?? ''))

  return hasBlockChildren ? parts.filter((part) => part !== '').join('\n') : parts.join('')
}
