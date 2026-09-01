import { describe, it, expect } from 'vitest'
import { normaliseLinkHref } from './linkHref'

const href = (raw: string) => {
  const result = normaliseLinkHref(raw)
  return 'href' in result ? result.href : null
}

describe('normaliseLinkHref', () => {
  it('keeps a full URL as it is given', () => {
    expect(href('https://example.com/notes')).toBe('https://example.com/notes')
  })

  /*
   * What people actually paste. Left alone, `example.com` becomes a relative
   * link and opens /classes/example.com inside the app -- a broken link that
   * looks like a working one.
   */
  it('assumes https for a bare domain', () => {
    expect(href('example.com')).toBe('https://example.com/')
    expect(href('example.com/path')).toBe('https://example.com/path')
    expect(href('  example.com  ')).toBe('https://example.com/')
  })

  it('allows the schemes a note legitimately links with', () => {
    expect(href('http://example.com')).toBe('http://example.com/')
    expect(href('mailto:tutor@example.edu')).toBe('mailto:tutor@example.edu')
    expect(href('tel:+15551234')).toBe('tel:+15551234')
  })

  // The reason this is an allowlist. Each of these is a way to run code or
  // smuggle a document through something that looks like an ordinary link.
  it('refuses schemes that can execute or carry content', () => {
    for (const hostile of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      '  javascript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'blob:https://example.com/uuid',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
    ]) {
      const result = normaliseLinkHref(hostile)
      expect(result, hostile).not.toHaveProperty('href')
      expect(result).toHaveProperty('error')
    }
  })

  it('asks for something rather than accepting nothing', () => {
    expect(normaliseLinkHref('')).toEqual({ error: 'Enter a web address.' })
    expect(normaliseLinkHref('   ')).toEqual({ error: 'Enter a web address.' })
  })

  it('reports input that is not a URL at all', () => {
    const result = normaliseLinkHref('http://')
    expect(result).toHaveProperty('error')
  })

  // A scheme-relative URL inherits the page's scheme, which is https here.
  it('handles a protocol-relative address', () => {
    expect(href('//example.com')).toBe('https://example.com/')
  })
})
