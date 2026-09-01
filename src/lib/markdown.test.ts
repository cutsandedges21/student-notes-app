import { describe, it, expect } from 'vitest'
import { markdownToHtml, escapeHtml, isInlineSuggestion } from './markdown'

describe('escapeHtml', () => {
  // AI output lands directly in the student's document. Unescaped markup would
  // be a stored-XSS vector via a poisoned model response.
  it('neutralises markup', () => {
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe(
      '&lt;img src=x onerror=alert(1)&gt;',
    )
  })

  it('escapes ampersands before angle brackets, so entities are not doubled', () => {
    expect(escapeHtml('a & <b>')).toBe('a &amp; &lt;b&gt;')
  })
})

describe('markdownToHtml', () => {
  it('converts headings', () => {
    expect(markdownToHtml('## Photosynthesis')).toBe('<h2>Photosynthesis</h2>')
  })

  it('wraps plain lines as paragraphs', () => {
    expect(markdownToHtml('Just a line')).toBe('<p>Just a line</p>')
  })

  it('groups consecutive bullets into one list', () => {
    expect(markdownToHtml('- one\n- two')).toBe('<ul><li><p>one</p></li><li><p>two</p></li></ul>')
  })

  it('groups consecutive numbered items into one ordered list', () => {
    expect(markdownToHtml('1. first\n2. second')).toBe(
      '<ol><li><p>first</p></li><li><p>second</p></li></ol>',
    )
  })

  it('closes a list when prose follows it', () => {
    expect(markdownToHtml('- one\n\nAfter')).toBe('<ul><li><p>one</p></li></ul><p>After</p>')
  })

  it('renders bold and italic inline', () => {
    expect(markdownToHtml('**key** and *soft*')).toBe(
      '<p><strong>key</strong> and <em>soft</em></p>',
    )
  })

  it('escapes markup inside converted text', () => {
    expect(markdownToHtml('<script>alert(1)</script>')).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
    )
  })

  it('ignores blank lines rather than emitting empty paragraphs', () => {
    expect(markdownToHtml('one\n\n\ntwo')).toBe('<p>one</p><p>two</p>')
  })

  it('returns an empty string for empty input', () => {
    expect(markdownToHtml('   ')).toBe('')
  })
})

describe('markdownToHtml, pipe tables', () => {
  // The case the feature exists for: a truth table used to land in the note as
  // rows of literal pipes and dashes.
  it('renders a header row, a delimiter and body rows as a table', () => {
    const markdown = ['| D | B |', '|---|---|', '| T | T |', '| T | F |'].join('\n')

    expect(markdownToHtml(markdown)).toBe(
      '<table><tbody>' +
        '<tr><th><p>D</p></th><th><p>B</p></th></tr>' +
        '<tr><td><p>T</p></td><td><p>T</p></td></tr>' +
        '<tr><td><p>T</p></td><td><p>F</p></td></tr>' +
        '</tbody></table>',
    )
  })

  // The delimiter is the whole signal. Without it these are just sentences
  // that happen to contain pipes, and rewriting them as a table would invent
  // structure the student never wrote.
  it('leaves pipe-looking prose alone when the delimiter row is missing', () => {
    expect(markdownToHtml('| D | B |\n| T | T |')).toBe(
      '<p>| D | B |</p><p>| T | T |</p>',
    )
  })

  it('does not treat a pipe inside prose as a table', () => {
    expect(markdownToHtml('Bayes gives P(A | B) directly.')).toBe(
      '<p>Bayes gives P(A | B) directly.</p>',
    )
  })

  it('reads alignment from colons in the delimiter', () => {
    const markdown = ['| L | C | R |', '|:---|:---:|---:|', '| a | b | c |'].join('\n')
    const html = markdownToHtml(markdown)

    expect(html).toContain('<th><p style="text-align: left">L</p></th>')
    expect(html).toContain('<th><p style="text-align: center">C</p></th>')
    expect(html).toContain('<th><p style="text-align: right">R</p></th>')
    expect(html).toContain('<td><p style="text-align: center">b</p></td>')
  })

  /*
   * ProseMirror rejects a table whose rows disagree on width, and it rejects
   * the whole node rather than the offending row -- so a single stray pipe
   * would delete the entire table. Padding and truncating keeps the content.
   */
  it('pads short rows and truncates long ones to the header width', () => {
    const markdown = ['| A | B |', '|---|---|', '| only |', '| x | y | z |'].join('\n')
    const html = markdownToHtml(markdown)

    expect(html).toContain('<tr><td><p>only</p></td><td><p></p></td></tr>')
    expect(html).toContain('<tr><td><p>x</p></td><td><p>y</p></td></tr>')
    expect(html).not.toContain('<p>z</p>')
  })

  it('escapes markup inside cells', () => {
    const markdown = ['| H |', '|---|', '| <script>alert(1)</script> |'].join('\n')

    expect(markdownToHtml(markdown)).toContain(
      '<td><p>&lt;script&gt;alert(1)&lt;/script&gt;</p></td>',
    )
  })

  it('applies bold and italic inside cells', () => {
    const markdown = ['| H |', '|---|', '| **hard** and *soft* |'].join('\n')

    expect(markdownToHtml(markdown)).toContain(
      '<td><p><strong>hard</strong> and <em>soft</em></p></td>',
    )
  })

  it('keeps an escaped pipe as a literal inside a cell', () => {
    const markdown = ['| Notation |', '|---|', '| P(A \\| B) |'].join('\n')

    expect(markdownToHtml(markdown)).toContain('<td><p>P(A | B)</p></td>')
  })

  it('returns to ordinary parsing after the table ends', () => {
    const markdown = ['| H |', '|---|', '| v |', '', 'After the table.'].join('\n')

    expect(markdownToHtml(markdown)).toBe(
      '<table><tbody><tr><th><p>H</p></th></tr><tr><td><p>v</p></td></tr></tbody></table>' +
        '<p>After the table.</p>',
    )
  })

  it('renders a heading above a table without swallowing it', () => {
    const markdown = ['## Truth table', '| D |', '|---|', '| T |'].join('\n')

    expect(markdownToHtml(markdown)).toBe(
      '<h2>Truth table</h2>' +
        '<table><tbody><tr><th><p>D</p></th></tr><tr><td><p>T</p></td></tr></tbody></table>',
    )
  })
})

describe('isInlineSuggestion', () => {
  it('treats a single run of prose as inline', () => {
    expect(isInlineSuggestion('a clearer sentence')).toBe(true)
  })

  // A lone pipe row is a table the model cut short. Applied inline, its pipes
  // would be pasted into the middle of a sentence.
  it('does not treat a pipe row as inline', () => {
    expect(isInlineSuggestion('| D | B |')).toBe(false)
  })
})
