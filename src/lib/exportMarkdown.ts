import type { JSONContent } from '@tiptap/react'

/**
 * The note as Markdown.
 *
 * There is a second Tiptap-to-markdown renderer in the edge function
 * (`ai-assist/structure.ts`) and this is deliberately not it. That one is
 * building a prompt, so it drops bold, italic, colour and highlight as noise a
 * model learns nothing from. This one is handing the student their own writing
 * back, where emphasis is the writing. Same input, opposite requirement.
 *
 * Markdown rather than a proprietary format because it is the one thing that
 * opens everywhere -- another editor, a git repository, a plain text box --
 * and because it is what the assistant already reads and writes, so a note
 * exported and re-imported comes back as itself.
 */

interface Node extends JSONContent {
  content?: Node[]
}

const attrString = (node: Node, key: string): string => {
  const value = node.attrs?.[key]
  return typeof value === 'string' ? value : ''
}

const attrNumber = (node: Node, key: string, fallback: number): number => {
  const value = node.attrs?.[key]
  return typeof value === 'number' ? value : fallback
}

/**
 * Escapes characters that would otherwise become markup.
 *
 * A student who wrote `2 * 3 * 4` in their notes did not write emphasis, and a
 * note that changes meaning when exported is worse than one that exports
 * nothing. Only the characters that actually start a construct are escaped;
 * escaping everything produces a file full of backslashes.
 */
function escapeText(text: string): string {
  return text.replace(/([\\`*_[\]])/g, '\\$1')
}

function inline(node: Node): string {
  if (node.type === 'text') {
    let text = escapeText(node.text ?? '')
    const marks = node.marks ?? []
    const has = (type: string) => marks.some((mark) => mark.type === type)

    // Innermost first, so the wrappers nest in a legal order.
    if (has('code')) {
      // Code spans are literal: an escaped backslash inside one would print.
      text = `\`${node.text ?? ''}\``
    }
    if (has('bold')) text = `**${text}**`
    if (has('italic')) text = `*${text}*`
    if (has('strike')) text = `~~${text}~~`
    // Markdown has no subscript or superscript. HTML is valid markdown and is
    // what every renderer that supports them expects.
    if (has('superscript')) text = `<sup>${text}</sup>`
    if (has('subscript')) text = `<sub>${text}</sub>`

    const link = marks.find((mark) => mark.type === 'link')
    const href = typeof link?.attrs?.href === 'string' ? link.attrs.href : ''
    if (href) text = `[${text}](${href})`

    return text
  }

  if (node.type === 'hardBreak') return '  \n'
  if (node.type === 'inlineMath') return `$${attrString(node, 'latex')}$`
  if (node.type === 'image') {
    return `![${attrString(node, 'alt')}](${attrString(node, 'src')})`
  }

  return (node.content ?? []).map(inline).join('')
}

function tableRow(row: Node): string {
  const cells = (row.content ?? []).map((cell) =>
    (cell.content ?? [])
      .map(inline)
      .join(' ')
      .trim()
      // A pipe inside a cell would end the column.
      .replace(/\|/g, '\\|'),
  )
  return `| ${cells.join(' | ')} |`
}

function table(node: Node): string {
  const rows = node.content ?? []
  if (rows.length === 0) return ''

  const lines = rows.map(tableRow)
  const columns = (rows[0].content ?? []).length

  /*
   * Markdown tables must have a header separator, and a Tiptap table need not
   * have a header row. Inserting the separator after row one either way keeps
   * the table a table; the alternative is a block that renders as prose.
   */
  lines.splice(1, 0, `| ${Array(columns).fill('---').join(' | ')} |`)
  return lines.join('\n')
}

function list(node: Node, depth: number): string {
  const ordered = node.type === 'orderedList'
  const start = attrNumber(node, 'start', 1)
  const indent = '  '.repeat(depth)

  return (node.content ?? [])
    .map((item, index) => {
      const marker = ordered ? `${start + index}.` : '-'
      const box =
        item.type === 'taskItem' ? (item.attrs?.checked === true ? '[x] ' : '[ ] ') : ''

      const body = (item.content ?? [])
        .map((child) =>
          child.type === 'bulletList' ||
          child.type === 'orderedList' ||
          child.type === 'taskList'
            ? `\n${list(child, depth + 1)}`
            : block(child, depth + 1),
        )
        .filter(Boolean)
        .join('\n')

      return `${indent}${marker} ${box}${body}`.trimEnd()
    })
    .join('\n')
}

function block(node: Node, depth = 0): string {
  switch (node.type) {
    case 'heading':
      return `${'#'.repeat(Math.min(6, Math.max(1, attrNumber(node, 'level', 1))))} ${(node.content ?? []).map(inline).join('')}`

    case 'paragraph':
      return (node.content ?? []).map(inline).join('')

    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return list(node, depth)

    case 'blockquote':
      return (node.content ?? [])
        .map((child) => block(child, depth))
        .filter(Boolean)
        .join('\n')
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')

    case 'codeBlock':
      return `\`\`\`${attrString(node, 'language')}\n${(node.content ?? []).map((child) => child.text ?? '').join('')}\n\`\`\``

    case 'blockMath':
      return `$$\n${attrString(node, 'latex')}\n$$`

    case 'table':
      return table(node)

    case 'image':
      return `![${attrString(node, 'alt')}](${attrString(node, 'src')})`

    case 'horizontalRule':
      return '---'

    /*
     * A page break has no markdown. `---` is already the horizontal rule, and
     * a reader cannot tell them apart -- so it becomes a comment: invisible
     * when rendered, and still there for anything that round-trips.
     */
    case 'pageBreak':
      return '<!-- page break -->'

    default:
      return (node.content ?? [])
        .map((child) => block(child, depth))
        .filter(Boolean)
        .join('\n\n')
  }
}

/**
 * Serialises a note.
 *
 * The title is written as a level-one heading rather than left to the file
 * name: a file gets renamed, moved and attached to things, and the note should
 * still say what it is.
 */
export function documentToMarkdown(doc: JSONContent | null | undefined, title = ''): string {
  const body = !doc || typeof doc !== 'object'
    ? ''
    : (doc.content ?? [])
        .map((node) => block(node as Node))
        .filter((text) => text.trim() !== '')
        .join('\n\n')
        .trim()

  const heading = title.trim() ? `# ${title.trim()}` : ''
  return [heading, body].filter(Boolean).join('\n\n') + '\n'
}

/**
 * A file name that survives being saved.
 *
 * Anything a filesystem refuses becomes a dash. Reserved Windows device names
 * are prefixed rather than rejected, because "CON.md" failing to save is a
 * confusing way to learn about a rule from 1981.
 */
export function exportFilename(title: string, extension: string): string {
  const cleaned = title
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .slice(0, 80)
    .trim()

  const base = cleaned || 'Untitled note'
  const reserved = /^(con|prn|aux|nul|com\d|lpt\d)$/i
  return `${reserved.test(base) ? `_${base}` : base}.${extension}`
}
