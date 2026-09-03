/**
 * The note as a structure, rather than as a paragraph of run-together words.
 *
 * The model was shown `content_text`: every block flattened and joined with
 * newlines. That loses the thing a student's notes are mostly made of. A
 * heading and a sentence arrive identically, a list looks like prose, a table
 * becomes a row of words, and "what does the section on osmosis say" cannot be
 * answered because there are no sections.
 *
 * This keeps the shape and drops the decoration. Headings, lists, tables, code,
 * equations, quotes and images survive because they carry meaning; colour,
 * highlight, font and size do not, and every one of them spent tokens saying
 * nothing about what the note means.
 *
 * ## Why markdown-ish text and not JSON
 *
 * The brief asks for a structured representation, and JSON is the obvious
 * reading of that. It is the wrong one here: a JSON tree of the same note is
 * several times the tokens -- braces, type names and nesting for every
 * paragraph -- to describe a structure the model already reads fluently as
 * markdown. What matters is that structure survives, not which notation it
 * survives in.
 *
 * Pure, like the rest of `context.ts`: no Deno APIs and no network, so it is
 * testable from Vitest even though it ships inside an edge function.
 */

export interface JsonNode {
  type?: string
  content?: JsonNode[]
  text?: string
  attrs?: Record<string, unknown>
  marks?: { type?: string; attrs?: Record<string, unknown> }[]
}

/** A heading, with where it sits, for the outline the model is given first. */
export interface OutlineEntry {
  level: number
  text: string
}

const attrNumber = (node: JsonNode, key: string, fallback: number): number => {
  const value = node.attrs?.[key]
  return typeof value === 'number' ? value : fallback
}

const attrString = (node: JsonNode, key: string): string => {
  const value = node.attrs?.[key]
  return typeof value === 'string' ? value : ''
}

/**
 * Inline text, with the marks that change what it means.
 *
 * `code`, `superscript` and `subscript` are kept because dropping them changes
 * the content: H2O is not H₂O, and x2 is not x². Bold and italic are dropped
 * because emphasis is a claim about presentation, and a model that sees
 * `**mitochondria**` learns nothing it did not learn from `mitochondria`.
 * Links keep their target, which is information the words alone do not carry.
 */
function inlineText(node: JsonNode): string {
  if (node.type === 'text') {
    let text = node.text ?? ''
    const marks = node.marks ?? []

    if (marks.some((mark) => mark.type === 'code')) text = `\`${text}\``
    if (marks.some((mark) => mark.type === 'superscript')) text = `^${text}`
    if (marks.some((mark) => mark.type === 'subscript')) text = `_${text}`

    const link = marks.find((mark) => mark.type === 'link')
    const href = typeof link?.attrs?.href === 'string' ? link.attrs.href : ''
    if (href) text = `[${text}](${href})`

    return text
  }

  if (node.type === 'hardBreak') return '\n'
  if (node.type === 'inlineMath') return `$${attrString(node, 'latex')}$`

  return (node.content ?? []).map(inlineText).join('')
}

/** One table row as a pipe row, which is how the model already reads tables. */
function tableRow(row: JsonNode): string {
  const cells = (row.content ?? []).map((cell) =>
    (cell.content ?? []).map(inlineText).join(' ').trim(),
  )
  return `| ${cells.join(' | ')} |`
}

function renderTable(table: JsonNode): string {
  const rows = table.content ?? []
  if (rows.length === 0) return ''

  const lines = rows.map(tableRow)
  const firstRow = rows[0]
  const isHeader = (firstRow.content ?? []).some((cell) => cell.type === 'tableHeader')

  if (isHeader && lines.length > 0) {
    const columns = (firstRow.content ?? []).length
    lines.splice(1, 0, `| ${Array(columns).fill('---').join(' | ')} |`)
  }

  return lines.join('\n')
}

function renderList(list: JsonNode, depth: number): string {
  const ordered = list.type === 'orderedList'
  const start = attrNumber(list, 'start', 1)
  const indent = '  '.repeat(depth)

  return (list.content ?? [])
    .map((item, index) => {
      const marker = ordered ? `${start + index}.` : '-'

      // A task item's state is the whole point of writing one down.
      const box =
        item.type === 'taskItem' ? (item.attrs?.checked === true ? '[x] ' : '[ ] ') : ''

      const body = (item.content ?? [])
        .map((child) =>
          child.type === 'bulletList' || child.type === 'orderedList' || child.type === 'taskList'
            ? `\n${renderList(child, depth + 1)}`
            : renderBlock(child, depth + 1),
        )
        .filter(Boolean)
        .join('\n')
        // Continuation lines of the same item line up under its marker.
        .replace(/\n(?!$)/g, `\n${indent}  `)

      return `${indent}${marker} ${box}${body}`.trimEnd()
    })
    .join('\n')
}

function renderBlock(node: JsonNode, depth = 0): string {
  switch (node.type) {
    case 'heading': {
      const level = Math.min(6, Math.max(1, attrNumber(node, 'level', 1)))
      return `${'#'.repeat(level)} ${(node.content ?? []).map(inlineText).join('')}`
    }

    case 'paragraph':
      return (node.content ?? []).map(inlineText).join('')

    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return renderList(node, depth)

    case 'blockquote':
      return (node.content ?? [])
        .map((child) => renderBlock(child, depth))
        .filter(Boolean)
        .map((line) => `> ${line}`)
        .join('\n')

    case 'codeBlock': {
      const language = attrString(node, 'language')
      const body = (node.content ?? []).map(inlineText).join('')
      return `\`\`\`${language}\n${body}\n\`\`\``
    }

    case 'blockMath':
      return `$$${attrString(node, 'latex')}$$`

    case 'table':
      return renderTable(node)

    case 'image': {
      // The alt text is the only part of an image a language model can use.
      const alt = attrString(node, 'alt')
      return alt ? `[image: ${alt}]` : '[image]'
    }

    case 'horizontalRule':
      return '---'

    // A page break is layout. It says nothing about what the note means, and
    // the model reading one as a section boundary would be wrong as often as
    // right.
    case 'pageBreak':
      return ''

    default:
      return (node.content ?? [])
        .map((child) => renderBlock(child, depth))
        .filter(Boolean)
        .join('\n\n')
  }
}

/** Every heading in the note, in order. */
export function outlineOf(doc: JsonNode | null | undefined): OutlineEntry[] {
  if (!doc) return []

  const entries: OutlineEntry[] = []
  const walk = (node: JsonNode) => {
    if (node.type === 'heading') {
      const text = (node.content ?? []).map(inlineText).join('').trim()
      if (text) entries.push({ level: attrNumber(node, 'level', 1), text })
    }
    ;(node.content ?? []).forEach(walk)
  }
  walk(doc)

  return entries
}

/**
 * The note, structured.
 *
 * Returns an empty string for anything unusable -- a null, a row whose content
 * was never written, a shape this does not recognise -- so a caller can fall
 * back to the flattened text rather than send the model nothing.
 */
export function structureDocument(doc: JsonNode | null | undefined): string {
  if (!doc || typeof doc !== 'object') return ''

  return (doc.content ?? [])
    .map((node) => renderBlock(node))
    .filter((block) => block.trim() !== '')
    .join('\n\n')
    .trim()
}

/** The outline as lines, for the section the model reads before the body. */
export function renderOutline(entries: OutlineEntry[]): string {
  return entries
    .map((entry) => `${'  '.repeat(Math.max(0, entry.level - 1))}- ${entry.text}`)
    .join('\n')
}
