import { describe, it, expect } from 'vitest'
import {
  A4,
  DEFAULT_PAGE_SETUP,
  geometryFor,
  INCH,
  parsePageSetup,
  US_LETTER,
  printableHeight,
  printableWidth,
  type PageSetup,
} from './geometry'

/**
 * Page setup: the three choices a person makes, and the six numbers they
 * produce.
 *
 * `parsePageSetup` is the interesting half. The column is jsonb and nullable,
 * so it reads rows written before it existed, rows written by a newer client,
 * and rows edited by hand. A note that will not open because its paper size is
 * unrecognised would be a spectacularly bad trade, so every one of those cases
 * has to land somewhere sensible.
 */

const setup = (over: Partial<PageSetup> = {}): PageSetup => ({
  ...DEFAULT_PAGE_SETUP,
  ...over,
})

describe('geometryFor', () => {
  it('produces US Letter by default', () => {
    const geometry = geometryFor(DEFAULT_PAGE_SETUP)

    expect(geometry.pageWidth).toBe(US_LETTER.pageWidth)
    expect(geometry.pageHeight).toBe(US_LETTER.pageHeight)
  })

  it('produces A4', () => {
    const geometry = geometryFor(setup({ paper: 'a4' }))

    expect(geometry.pageWidth).toBe(A4.pageWidth)
    expect(geometry.pageHeight).toBe(A4.pageHeight)
  })

  it('swaps the paper for landscape', () => {
    const portrait = geometryFor(setup())
    const landscape = geometryFor(setup({ landscape: true }))

    expect(landscape.pageWidth).toBe(portrait.pageHeight)
    expect(landscape.pageHeight).toBe(portrait.pageWidth)
  })

  /**
   * Turning the page does not turn the margins with it: a left margin is the
   * binding edge whichever way up the sheet is.
   */
  it('leaves the margins where they are when the page turns', () => {
    const margins = { top: 10, right: 20, bottom: 30, left: 40 }
    const landscape = geometryFor(setup({ landscape: true, margins }))

    expect(landscape.marginTop).toBe(10)
    expect(landscape.marginRight).toBe(20)
    expect(landscape.marginBottom).toBe(30)
    expect(landscape.marginLeft).toBe(40)
  })

  it('gives landscape Letter a wider text column than portrait', () => {
    expect(printableWidth(geometryFor(setup({ landscape: true })))).toBeGreaterThan(
      printableWidth(geometryFor(setup())),
    )
    expect(printableHeight(geometryFor(setup({ landscape: true })))).toBeLessThan(
      printableHeight(geometryFor(setup())),
    )
  })
})

describe('parsePageSetup', () => {
  it('defaults for a row written before the column existed', () => {
    expect(parsePageSetup(null)).toEqual(DEFAULT_PAGE_SETUP)
    expect(parsePageSetup(undefined)).toEqual(DEFAULT_PAGE_SETUP)
  })

  it('reads a setup it wrote', () => {
    const stored = setup({ paper: 'a4', landscape: true, margins: { top: 48, right: 48, bottom: 48, left: 48 } })

    expect(parsePageSetup(JSON.parse(JSON.stringify(stored)))).toEqual(stored)
  })

  it('falls back on a paper size it does not know', () => {
    const parsed = parsePageSetup({ paper: 'tabloid', landscape: false, margins: DEFAULT_PAGE_SETUP.margins })

    expect(parsed.paper).toBe('letter')
  })

  it('falls back per margin rather than discarding the lot', () => {
    const parsed = parsePageSetup({
      paper: 'a4',
      margins: { top: 48, right: 'wide', bottom: null, left: 48 },
    })

    expect(parsed.paper).toBe('a4')
    expect(parsed.margins.top).toBe(48)
    expect(parsed.margins.left).toBe(48)
    expect(parsed.margins.right).toBe(INCH)
    expect(parsed.margins.bottom).toBe(INCH)
  })

  it('refuses a negative margin', () => {
    const parsed = parsePageSetup({ margins: { ...DEFAULT_PAGE_SETUP.margins, left: -200 } })

    expect(parsed.margins.left).toBe(INCH)
  })

  /**
   * Margins wider than the paper would render the note as a stack of blank
   * sheets with the writing nowhere -- and it would look like data loss.
   */
  it('refuses a setup that leaves no room for text', () => {
    const parsed = parsePageSetup({
      paper: 'letter',
      landscape: false,
      margins: { top: 600, right: 600, bottom: 600, left: 600 },
    })

    expect(parsed).toEqual(DEFAULT_PAGE_SETUP)
  })

  it('is not fooled by a non-object', () => {
    expect(parsePageSetup('a4')).toEqual(DEFAULT_PAGE_SETUP)
    expect(parsePageSetup(42)).toEqual(DEFAULT_PAGE_SETUP)
    expect(parsePageSetup([])).toEqual(DEFAULT_PAGE_SETUP)
  })
})
