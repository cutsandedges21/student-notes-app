/**
 * Minimal Markdown → HTML for applying AI suggestions.
 *
 * The system prompt constrains proposed_content to headings, bullets, numbered
 * lists, bold/italic and pipe tables, so a full Markdown parser would be weight
 * we never use. Everything outside that set is treated as plain text.
 *
 * All text is escaped before any tag is emitted. Model output is untrusted
 * input: it goes straight into the student's saved document, so unescaped
 * markup would persist as stored XSS.
 */

export function escapeHtml(text: string): string {
  // Ampersand first, otherwise the entities produced below get double-escaped.
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Bold and italic only, applied after escaping. */
function inline(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)([^*]+?)\*/g, '$1<em>$2</em>')
}

type Alignment = 'left' | 'center' | 'right' | null

/**
 * Splits one pipe-table row into its cells.
 *
 * The outer pipes are optional in GFM but required here: a line has to look
 * unmistakably like a table before it is treated as one, or a sentence about
 * "p | q" becomes a one-row table. `\|` escapes a literal pipe inside a cell.
 */
function splitRow(line: string): string[] | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|') || trimmed.length < 2) return null

  return trimmed
    .slice(1, -1)
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, '|').trim())
}

/** `|---|:--:|---:|` — the row that turns the line above it into a header. */
function readAlignments(line: string): Alignment[] | null {
  const cells = splitRow(line)
  if (!cells || cells.length === 0) return null
  if (!cells.every((cell) => /^:?-+:?$/.test(cell))) return null

  return cells.map((cell) => {
    const left = cell.startsWith(':')
    const right = cell.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    if (left) return 'left'
    return null
  })
}

/**
 * A cell's inner paragraph.
 *
 * Tiptap's table cells hold blocks, not inline content, so the paragraph is
 * required rather than cosmetic -- without it the text is dropped on parse.
 * Alignment rides on the paragraph because that is where the TextAlign
 * extension stores it; a `text-align` on the cell itself would be discarded.
 */
function cell(tag: 'th' | 'td', content: string, align: Alignment): string {
  const style = align ? ` style="text-align: ${align}"` : ''
  return `<${tag}><p${style}>${inline(content)}</p></${tag}>`
}

/**
 * Reads a whole pipe table starting at `start`, or returns null.
 *
 * A table is a header row, a delimiter row, and zero or more body rows. The
 * delimiter is what makes it a table: without it the lines are just prose that
 * happens to contain pipes, and are left alone.
 */
function readTable(
  lines: string[],
  start: number,
): { html: string; next: number } | null {
  const header = splitRow(lines[start])
  if (!header) return null

  const alignments = readAlignments(lines[start + 1] ?? '')
  if (!alignments) return null

  // Ragged rows are normal in hand-written Markdown. The header decides the
  // column count; short rows are padded and long ones truncated, because a
  // table with uneven rows is invalid in ProseMirror's schema and would be
  // rejected wholesale -- losing the entire table over one stray pipe.
  const width = header.length
  const columnAlign = (index: number): Alignment => alignments[index] ?? null
  const fit = (cells: string[]) =>
    Array.from({ length: width }, (_, index) => cells[index] ?? '')

  const rows: string[] = [
    `<tr>${fit(header).map((text, index) => cell('th', text, columnAlign(index))).join('')}</tr>`,
  ]

  let index = start + 2
  for (; index < lines.length; index += 1) {
    const cells = splitRow(lines[index])
    if (!cells) break
    rows.push(
      `<tr>${fit(cells).map((text, column) => cell('td', text, columnAlign(column))).join('')}</tr>`,
    )
  }

  return { html: `<table><tbody>${rows.join('')}</tbody></table>`, next: index }
}

export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let listType: 'ul' | 'ol' | null = null

  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`)
      listType = null
    }
  }

  const openList = (type: 'ul' | 'ol') => {
    if (listType !== type) {
      closeList()
      out.push(`<${type}>`)
      listType = type
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()

    if (!line) {
      closeList()
      continue
    }

    // Before every single-line rule, because a table is the one construct here
    // that spans lines and has to claim all of them at once.
    const table = readTable(lines, index)
    if (table) {
      closeList()
      out.push(table.html)
      // -1 because the loop's own increment lands us on `next`.
      index = table.next - 1
      continue
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    if (heading) {
      closeList()
      const level = heading[1].length
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      continue
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(line)
    if (bullet) {
      openList('ul')
      out.push(`<li><p>${inline(bullet[1])}</p></li>`)
      continue
    }

    const numbered = /^\d+[.)]\s+(.*)$/.exec(line)
    if (numbered) {
      openList('ol')
      out.push(`<li><p>${inline(numbered[1])}</p></li>`)
      continue
    }

    if (/^(---|___|\*\*\*)$/.test(line)) {
      closeList()
      out.push('<hr>')
      continue
    }

    const quote = /^>\s+(.*)$/.exec(line)
    if (quote) {
      closeList()
      out.push(`<blockquote><p>${inline(quote[1])}</p></blockquote>`)
      continue
    }

    closeList()
    out.push(`<p>${inline(line)}</p>`)
  }

  closeList()
  return out.join('')
}

/**
 * True when the suggestion is a single run of prose with no block structure.
 *
 * Inline replacements preserve the surrounding paragraph, so they are applied
 * as text over the exact selection range. Anything with headings or lists has
 * to be inserted as nodes instead.
 */
export function isInlineSuggestion(text: string): boolean {
  return (
    !/\n/.test(text.trim()) &&
    // A leading pipe is in the set even though a real table always spans lines
    // and is caught by the newline test: a single pipe row is a table the model
    // truncated, and treating it as prose would paste the pipes into a
    // sentence.
    !/^(#{1,3}\s|[-*+]\s|\d+[.)]\s|>\s|\|)/.test(text.trim())
  )
}
