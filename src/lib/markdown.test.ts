import { describe, it, expect } from 'vitest'
import { markdownToHtml, escapeHtml } from './markdown'

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
