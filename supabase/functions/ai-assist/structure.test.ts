import { describe, it, expect } from 'vitest'
import { outlineOf, renderOutline, structureDocument, type JsonNode } from './structure'

/**
 * Structure surviving the trip to the model.
 *
 * The old context flattened every block and joined with newlines, so a heading
 * and a sentence arrived identically and "what does the section on osmosis
 * say" had no answer. These pin the two halves of the fix: the shape is kept,
 * and the decoration is not.
 */

const doc = (...content: JsonNode[]): JsonNode => ({ type: 'doc', content })
const text = (value: string, marks?: JsonNode['marks']): JsonNode => ({
  type: 'text',
  text: value,
  ...(marks ? { marks } : {}),
})
const para = (...content: JsonNode[]): JsonNode => ({ type: 'paragraph', content })
const heading = (level: number, value: string): JsonNode => ({
  type: 'heading',
  attrs: { level },
  content: [text(value)],
})

describe('structureDocument', () => {
  it('keeps headings as headings', () => {
    const out = structureDocument(doc(heading(1, 'Respiration'), para(text('Happens in the mitochondria.'))))

    expect(out).toBe('# Respiration\n\nHappens in the mitochondria.')
  })

  it('keeps heading level, which is what makes an outline mean anything', () => {
    const out = structureDocument(doc(heading(1, 'Cells'), heading(3, 'Membranes')))

    expect(out).toContain('# Cells')
    expect(out).toContain('### Membranes')
  })

  it('keeps a bullet list as a list', () => {
    const out = structureDocument(
      doc({
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [para(text('Glycolysis'))] },
          { type: 'listItem', content: [para(text('Krebs cycle'))] },
        ],
      }),
    )

    expect(out).toBe('- Glycolysis\n- Krebs cycle')
  })

  it('numbers an ordered list, from where it starts', () => {
    const out = structureDocument(
      doc({
        type: 'orderedList',
        attrs: { start: 3 },
        content: [
          { type: 'listItem', content: [para(text('Third'))] },
          { type: 'listItem', content: [para(text('Fourth'))] },
        ],
      }),
    )

    expect(out).toBe('3. Third\n4. Fourth')
  })

  it('nests a list inside a list', () => {
    const out = structureDocument(
      doc({
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              para(text('Respiration')),
              {
                type: 'bulletList',
                content: [{ type: 'listItem', content: [para(text('Glycolysis'))] }],
              },
            ],
          },
        ],
      }),
    )

    expect(out).toContain('- Respiration')
    expect(out).toMatch(/\n\s+- Glycolysis/)
  })

  /** Whether a task is done is the whole point of writing it down. */
  it('keeps whether a task is ticked', () => {
    const out = structureDocument(
      doc({
        type: 'taskList',
        content: [
          { type: 'taskItem', attrs: { checked: true }, content: [para(text('Read chapter 4'))] },
          { type: 'taskItem', attrs: { checked: false }, content: [para(text('Do problem set'))] },
        ],
      }),
    )

    expect(out).toContain('- [x] Read chapter 4')
    expect(out).toContain('- [ ] Do problem set')
  })

  it('keeps a table as rows and columns', () => {
    const cell = (value: string, header = false) => ({
      type: header ? 'tableHeader' : 'tableCell',
      content: [para(text(value))],
    })
    const out = structureDocument(
      doc({
        type: 'table',
        content: [
          { type: 'tableRow', content: [cell('Stage', true), cell('ATP', true)] },
          { type: 'tableRow', content: [cell('Glycolysis'), cell('2')] },
        ],
      }),
    )

    expect(out).toContain('| Stage | ATP |')
    expect(out).toContain('| --- | --- |')
    expect(out).toContain('| Glycolysis | 2 |')
  })

  it('keeps equations as their source', () => {
    const out = structureDocument(
      doc(
        para(text('Euler: '), { type: 'inlineMath', attrs: { latex: 'e^{i\\pi}+1=0' } }),
        { type: 'blockMath', attrs: { latex: '\\int_0^1 x' } },
      ),
    )

    expect(out).toContain('$e^{i\\pi}+1=0$')
    expect(out).toContain('$$\\int_0^1 x$$')
  })

  it('keeps a code block, and its language', () => {
    const out = structureDocument(
      doc({ type: 'codeBlock', attrs: { language: 'python' }, content: [text('print(1)')] }),
    )

    expect(out).toBe('```python\nprint(1)\n```')
  })

  it('keeps a quote marked as one', () => {
    const out = structureDocument(
      doc({ type: 'blockquote', content: [para(text('Nothing in biology makes sense…'))] }),
    )

    expect(out).toBe('> Nothing in biology makes sense…')
  })

  /** Sub- and superscript change the content: H2O is not H₂O. */
  it('keeps subscript and superscript', () => {
    const out = structureDocument(
      doc(
        para(text('H'), text('2', [{ type: 'subscript' }]), text('O')),
        para(text('x'), text('2', [{ type: 'superscript' }])),
      ),
    )

    expect(out).toContain('H_2O')
    expect(out).toContain('x^2')
  })

  it('keeps a link’s target, which the words do not carry', () => {
    const out = structureDocument(
      doc(para(text('See here', [{ type: 'link', attrs: { href: 'https://example.com' } }]))),
    )

    expect(out).toBe('[See here](https://example.com)')
  })

  /**
   * The other half of the job. Emphasis, colour and highlight are claims about
   * presentation -- a model that sees `**mitochondria**` learns nothing extra,
   * and every one of those characters was a token spent saying nothing.
   */
  it('drops decoration that carries no meaning', () => {
    const out = structureDocument(
      doc(
        para(
          text('mitochondria', [
            { type: 'bold' },
            { type: 'italic' },
            { type: 'highlight', attrs: { color: 'yellow' } },
            { type: 'textStyle', attrs: { color: '#ff0000', fontSize: '24pt' } },
          ]),
        ),
      ),
    )

    expect(out).toBe('mitochondria')
  })

  /** Layout, not meaning: read as a section boundary it would mislead. */
  it('drops page breaks', () => {
    const out = structureDocument(doc(para(text('One')), { type: 'pageBreak' }, para(text('Two'))))

    expect(out).toBe('One\n\nTwo')
  })

  it('keeps an image’s description, which is all a model can use', () => {
    const out = structureDocument(
      doc({ type: 'image', attrs: { src: 'https://example.com/a.png', alt: 'A cell diagram' } }),
    )

    expect(out).toBe('[image: A cell diagram]')
    expect(out).not.toContain('https://example.com')
  })

  it('returns nothing for content it cannot read, so the caller can fall back', () => {
    expect(structureDocument(null)).toBe('')
    expect(structureDocument(undefined)).toBe('')
    expect(structureDocument({} as JsonNode)).toBe('')
  })

  it('does not throw on a node type it has never seen', () => {
    expect(() =>
      structureDocument(doc({ type: 'somethingNew', content: [para(text('Inside'))] })),
    ).not.toThrow()
  })
})

describe('outlineOf', () => {
  it('lists the headings in order, with their levels', () => {
    const entries = outlineOf(
      doc(heading(1, 'Respiration'), para(text('x')), heading(2, 'Glycolysis'), heading(2, 'Krebs')),
    )

    expect(entries).toEqual([
      { level: 1, text: 'Respiration' },
      { level: 2, text: 'Glycolysis' },
      { level: 2, text: 'Krebs' },
    ])
  })

  it('ignores an empty heading, which is not a section', () => {
    expect(outlineOf(doc({ type: 'heading', attrs: { level: 1 }, content: [] }))).toEqual([])
  })

  it('is empty for a note with no headings', () => {
    expect(outlineOf(doc(para(text('Just prose.'))))).toEqual([])
    expect(outlineOf(null)).toEqual([])
  })

  it('indents by level when rendered', () => {
    const rendered = renderOutline([
      { level: 1, text: 'Respiration' },
      { level: 2, text: 'Glycolysis' },
    ])

    expect(rendered).toBe('- Respiration\n  - Glycolysis')
  })
})
