import { describe, it, expect } from 'vitest'
import { generateJSON } from '@tiptap/core'
import { documentToMarkdown, exportFilename } from './exportMarkdown'
import { markdownToHtml } from './markdown'
import { editorExtensions } from '../editor/extensions'
import type { JSONContent } from '@tiptap/react'

/**
 * Exporting a note.
 *
 * The property that matters most is the round trip: markdown out, imported
 * back, and the note is still the note. A student who exports to hand work in
 * and re-imports it later should not find their lists turned into prose.
 */

const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })
const text = (value: string, marks?: { type: string; attrs?: Record<string, unknown> }[]) => ({
  type: 'text',
  text: value,
  ...(marks ? { marks } : {}),
})
const para = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content })

describe('documentToMarkdown', () => {
  it('writes the title as a heading, so the note says what it is', () => {
    const out = documentToMarkdown(doc(para(text('Body.'))), 'Lecture 5')

    expect(out).toBe('# Lecture 5\n\nBody.\n')
  })

  it('omits the heading for an untitled note rather than writing "# "', () => {
    expect(documentToMarkdown(doc(para(text('Body.'))))).toBe('Body.\n')
  })

  it('keeps headings at their level', () => {
    const out = documentToMarkdown(
      doc(
        { type: 'heading', attrs: { level: 2 }, content: [text('Glycolysis')] },
        para(text('In the cytosol.')),
      ),
    )

    expect(out).toContain('## Glycolysis')
  })

  it('keeps emphasis, which the prompt renderer deliberately drops', () => {
    const out = documentToMarkdown(
      doc(
        para(
          text('bold', [{ type: 'bold' }]),
          text(' and '),
          text('italic', [{ type: 'italic' }]),
        ),
      ),
    )

    expect(out).toContain('**bold**')
    expect(out).toContain('*italic*')
  })

  it('writes sub- and superscript as HTML, which markdown has no syntax for', () => {
    const out = documentToMarkdown(
      doc(para(text('H'), text('2', [{ type: 'subscript' }]), text('O'))),
    )

    expect(out).toContain('H<sub>2</sub>O')
  })

  it('keeps a link', () => {
    const out = documentToMarkdown(
      doc(para(text('here', [{ type: 'link', attrs: { href: 'https://example.com' } }]))),
    )

    expect(out).toContain('[here](https://example.com)')
  })

  it('keeps a task list, ticks and all', () => {
    const out = documentToMarkdown(
      doc({
        type: 'taskList',
        content: [
          { type: 'taskItem', attrs: { checked: true }, content: [para(text('Done'))] },
          { type: 'taskItem', attrs: { checked: false }, content: [para(text('Not done'))] },
        ],
      }),
    )

    expect(out).toContain('- [x] Done')
    expect(out).toContain('- [ ] Not done')
  })

  it('gives a table its header separator, so it stays a table', () => {
    const cell = (value: string) => ({ type: 'tableCell', content: [para(text(value))] })
    const out = documentToMarkdown(
      doc({
        type: 'table',
        content: [
          { type: 'tableRow', content: [cell('Stage'), cell('ATP')] },
          { type: 'tableRow', content: [cell('Glycolysis'), cell('2')] },
        ],
      }),
    )

    expect(out).toContain('| Stage | ATP |')
    expect(out).toContain('| --- | --- |')
  })

  it('keeps equations as their source', () => {
    const out = documentToMarkdown(
      doc(
        para(text('Euler '), { type: 'inlineMath', attrs: { latex: 'e^{i\\pi}' } }),
        { type: 'blockMath', attrs: { latex: '\\int_0^1 x' } },
      ),
    )

    expect(out).toContain('$e^{i\\pi}$')
    expect(out).toContain('$$\n\\int_0^1 x\n$$')
  })

  /**
   * A student who wrote `2 * 3` did not write emphasis. A note that changes
   * meaning when exported is worse than one that does not export.
   */
  it('escapes characters that would otherwise become markup', () => {
    const out = documentToMarkdown(doc(para(text('2 * 3 * 4 and _underscores_'))))

    expect(out).toContain('2 \\* 3 \\* 4')
    expect(out).toContain('\\_underscores\\_')
  })

  it('does not escape inside a code span, where a backslash would print', () => {
    const out = documentToMarkdown(doc(para(text('a_b', [{ type: 'code' }]))))

    expect(out).toContain('`a_b`')
    expect(out).not.toContain('a\\_b')
  })

  it('handles an empty or unreadable document without throwing', () => {
    expect(documentToMarkdown(null, 'T')).toBe('# T\n')
    expect(documentToMarkdown(undefined)).toBe('\n')
    expect(() => documentToMarkdown({ type: 'doc' })).not.toThrow()
  })
})

/**
 * The round trip.
 *
 * Export is only worth having if what comes back is the same note. This runs
 * the real import path -- the markdown converter and the editor's own schema.
 */
describe('markdown round trip', () => {
  const reimport = (markdown: string) =>
    generateJSON(markdownToHtml(markdown), editorExtensions)

  const textOf = (node: JSONContent): string =>
    node.type === 'text'
      ? (node.text ?? '')
      : (node.content ?? []).map(textOf).join(node.type === 'doc' ? '\n' : '')

  it('brings headings back as headings', () => {
    const original = doc({ type: 'heading', attrs: { level: 2 }, content: [text('Glycolysis')] })
    const back = reimport(documentToMarkdown(original))

    expect(back.content?.some((node: JSONContent) => node.type === 'heading')).toBe(true)
  })

  it('brings a list back as a list, not as prose', () => {
    const original = doc({
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [para(text('Glycolysis'))] },
        { type: 'listItem', content: [para(text('Krebs'))] },
      ],
    })

    const back = reimport(documentToMarkdown(original))
    expect(back.content?.some((node: JSONContent) => node.type === 'bulletList')).toBe(true)
  })

  it('does not turn an asterisk into emphasis on the way back', () => {
    const back = reimport(documentToMarkdown(doc(para(text('2 * 3')))))

    expect(textOf(back)).toContain('2 * 3')
  })
})

describe('exportFilename', () => {
  it('uses the title', () => {
    expect(exportFilename('Lecture 5', 'md')).toBe('Lecture 5.md')
  })

  it('replaces characters a filesystem refuses', () => {
    expect(exportFilename('Bio: notes / part 1?', 'md')).toBe('Bio- notes - part 1-.md')
  })

  it('falls back for an untitled note', () => {
    expect(exportFilename('', 'md')).toBe('Untitled note.md')
    expect(exportFilename('   ', 'md')).toBe('Untitled note.md')
  })

  it('does not produce a hidden file from a leading dot', () => {
    expect(exportFilename('.env notes', 'md')).toBe('env notes.md')
  })

  /** "CON.md" failing to save is a confusing way to learn about a 1981 rule. */
  it('gets out of the way of reserved Windows names', () => {
    expect(exportFilename('CON', 'md')).toBe('_CON.md')
    expect(exportFilename('lpt1', 'txt')).toBe('_lpt1.txt')
  })

  it('keeps the name short enough to save', () => {
    expect(exportFilename('x'.repeat(300), 'md').length).toBeLessThanOrEqual(84)
  })
})
