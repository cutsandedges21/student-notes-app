import type { JSONContent } from '@tiptap/react'

/**
 * Node types that occupy their own line. When a node's children are blocks,
 * their text is joined with newlines; otherwise (inline runs) it is
 * concatenated directly.
 */
const BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'listItem',
  'taskItem',
  'blockquote',
  'codeBlock',
])

/**
 * Flattens a Tiptap JSON document to plain text.
 *
 * This is denormalized into `documents.content_text` on every save so the AI
 * context layer never has to walk Tiptap JSON.
 */
export function extractPlainText(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? ''

  const children = node.content ?? []
  const parts = children.map(extractPlainText)

  const hasBlockChildren = children.some((child) => BLOCK_TYPES.has(child.type ?? ''))

  return hasBlockChildren ? parts.filter((part) => part !== '').join('\n') : parts.join('')
}
