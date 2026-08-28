/**
 * Minimal Markdown → HTML for applying AI suggestions.
 *
 * The system prompt constrains proposed_content to headings, bullets, numbered
 * lists and bold/italic, so a full Markdown parser would be weight we never
 * use. Everything outside that set is treated as plain text.
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

  for (const rawLine of lines) {
    const line = rawLine.trim()

    if (!line) {
      closeList()
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
  return !/\n/.test(text.trim()) && !/^(#{1,3}\s|[-*+]\s|\d+[.)]\s|>\s)/.test(text.trim())
}
