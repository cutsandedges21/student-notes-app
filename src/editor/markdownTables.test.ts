import { describe, it, expect } from 'vitest'
import { generateJSON, generateHTML } from '@tiptap/core'
import { editorExtensions } from './extensions'
import { markdownToHtml } from '../lib/markdown'
import { extractPlainText } from '../lib/tiptap'

/**
 * The seam the unit tests either side of it cannot cover.
 *
 * `markdown.test.ts` proves the converter emits the HTML we intended, and
 * `tiptap.test.ts` proves a table flattens back to readable text. Neither
 * proves the bit in between: that ProseMirror, configured with this app's
 * actual extension set, accepts that HTML as a table rather than discarding
 * it. A schema mismatch there fails silently -- unknown nodes are dropped on
 * parse, so the student's table would simply vanish on apply, with no error
 * anywhere. Hence a round trip through the real schema.
 */

const TRUTH_TABLE = [
  '| D | B | D → B |',
  '|---|---|-------|',
  '| T | T | T |',
  '| T | F | F |',
  '| F | T | T |',
  '| F | F | T |',
].join('\n')

describe('AI table markdown through the real editor schema', () => {
  it('survives as a table rather than being dropped on parse', () => {
    const doc = generateJSON(markdownToHtml(TRUTH_TABLE), editorExtensions)

    const table = doc.content?.[0]
    expect(table?.type).toBe('table')

    const rows = table?.content ?? []
    // One header row plus the four rows of a two-variable truth table.
    expect(rows).toHaveLength(5)
    expect(rows.every((row: { type?: string }) => row.type === 'tableRow')).toBe(true)

    const headerCells = rows[0].content ?? []
    expect(headerCells.map((cell: { type?: string }) => cell.type)).toEqual([
      'tableHeader',
      'tableHeader',
      'tableHeader',
    ])
  })

  it('keeps the cell text, including the Unicode the prompt asks for', () => {
    const doc = generateJSON(markdownToHtml(TRUTH_TABLE), editorExtensions)

    // The arrow is the whole point: it used to arrive as $D \rightarrow B$.
    expect(extractPlainText(doc)).toBe(
      ['D | B | D → B', 'T | T | T', 'T | F | F', 'F | T | T', 'F | F | T'].join('\n'),
    )
  })

  it('renders back to real table markup, which is what print re-renders from', () => {
    const doc = generateJSON(markdownToHtml(TRUTH_TABLE), editorExtensions)
    const html = generateHTML(doc, editorExtensions)

    expect(html).toContain('<table')
    expect(html).toContain('<th')
    expect(html).toContain('<td')
    expect(html).toContain('D → B')
  })

  it('carries column alignment through the schema', () => {
    const markdown = ['| L | C |', '|:---|:---:|', '| a | b |'].join('\n')
    const html = generateHTML(generateJSON(markdownToHtml(markdown), editorExtensions), editorExtensions)

    expect(html).toContain('text-align: center')
  })
})
