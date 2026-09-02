import { describe, it, expect } from 'vitest'
import { normaliseImageSrc } from './imageSrc'

/**
 * Image sources were taken from `window.prompt` and handed to the editor
 * unexamined, so whatever was typed became an `<img src>`. These pin the
 * allowlist and the one convenience it makes room for.
 */

describe('normaliseImageSrc', () => {
  it('fills in a missing scheme, as pasting a bare domain requires', () => {
    expect(normaliseImageSrc('example.com/diagram.png')).toEqual({
      src: 'https://example.com/diagram.png',
    })
  })

  it('accepts http and https', () => {
    expect(normaliseImageSrc('https://example.com/a.png')).toEqual({
      src: 'https://example.com/a.png',
    })
    expect(normaliseImageSrc('http://example.com/a.png')).toEqual({
      src: 'http://example.com/a.png',
    })
  })

  /** How a pasted screenshot arrives. Refused for links, allowed here. */
  it('accepts a data URL that is an image', () => {
    const src = 'data:image/png;base64,iVBORw0KGgo='
    expect(normaliseImageSrc(src)).toEqual({ src })
  })

  it('refuses a data URL that is not an image', () => {
    expect(normaliseImageSrc('data:text/html;base64,PHNjcmlwdD4=')).toHaveProperty('error')
  })

  it('refuses javascript: however it is cased or spaced', () => {
    expect(normaliseImageSrc('javascript:alert(1)')).toHaveProperty('error')
    expect(normaliseImageSrc('  JavaScript:alert(1)  ')).toHaveProperty('error')
  })

  it('refuses blob:, which can outlive the origin that made it', () => {
    expect(normaliseImageSrc('blob:https://example.com/abc')).toHaveProperty('error')
  })

  it('asks for something rather than accepting nothing', () => {
    expect(normaliseImageSrc('')).toEqual({ error: 'Enter an image address.' })
    expect(normaliseImageSrc('   ')).toEqual({ error: 'Enter an image address.' })
  })
})
