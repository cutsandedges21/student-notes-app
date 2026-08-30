/**
 * Physical page geometry, in CSS pixels at 96 DPI.
 *
 * Every number the pagination engine works with is an unzoomed CSS pixel. The
 * browser's `zoom` on the sheet is divided back out at measurement time (see
 * `measure.ts`), so a break computed at 50% zoom lands on the same word as one
 * computed at 200%.
 */

export interface PageGeometry {
  /** Paper width. US Letter is 8.5in -> 816px. */
  pageWidth: number
  /** Paper height. US Letter is 11in -> 1056px. */
  pageHeight: number
  marginTop: number
  marginRight: number
  marginBottom: number
  marginLeft: number
  /** Blank backdrop between two pages in the scrolled view. Never printed. */
  pageGap: number
}

/** 1 inch at 96 DPI. The unit every default below is expressed in. */
export const INCH = 96

/** The gap Docs leaves between sheets when scrolling. */
export const DEFAULT_PAGE_GAP = 24

export const US_LETTER: PageGeometry = {
  pageWidth: 8.5 * INCH, // 816
  pageHeight: 11 * INCH, // 1056
  marginTop: INCH,
  marginRight: INCH,
  marginBottom: INCH,
  marginLeft: INCH,
  pageGap: DEFAULT_PAGE_GAP,
}

export const US_LEGAL: PageGeometry = { ...US_LETTER, pageHeight: 14 * INCH }

/** A4 is 210x297mm; at 96 DPI that is 793.7 x 1122.5, rounded to whole pixels. */
export const A4: PageGeometry = { ...US_LETTER, pageWidth: 794, pageHeight: 1123 }

export const PAPER_SIZES = { letter: US_LETTER, legal: US_LEGAL, a4: A4 } as const

export type PaperSizeName = keyof typeof PAPER_SIZES

/**
 * Height available to text on one page. For US Letter with 1in margins this is
 * 1056 - 96 - 96 = 864px -- the limit a page breach is measured against.
 */
export function printableHeight(geometry: PageGeometry): number {
  return geometry.pageHeight - geometry.marginTop - geometry.marginBottom
}

/** Width available to text on one page. 816 - 96 - 96 = 624px for US Letter. */
export function printableWidth(geometry: PageGeometry): number {
  return geometry.pageWidth - geometry.marginLeft - geometry.marginRight
}

/**
 * Distance from one page's top edge to the next one's. Content is laid out in
 * a single column, so this is also the distance between the start of one
 * printable band and the start of the next.
 */
export function pageStride(geometry: PageGeometry): number {
  return geometry.pageHeight + geometry.pageGap
}

/** Top edge of page `index`, relative to the top of page 0. */
export function pageTop(geometry: PageGeometry, index: number): number {
  return index * pageStride(geometry)
}

/**
 * Where page `index`'s printable band starts, measured from the top of the
 * editable content box.
 *
 * The content box already begins one top margin below page 0, so the margin
 * cancels out and this is simply the stride -- which is why the pagination
 * algorithm can treat `index * stride` as its layout target.
 */
export function bandTop(geometry: PageGeometry, index: number): number {
  return index * pageStride(geometry)
}

/** Total height of `pageCount` stacked pages including the gaps between them. */
export function stackHeight(geometry: PageGeometry, pageCount: number): number {
  const pages = Math.max(1, pageCount)
  return pages * geometry.pageHeight + (pages - 1) * geometry.pageGap
}

/** True when the geometry leaves room to put anything on a page. */
export function isUsable(geometry: PageGeometry): boolean {
  return printableHeight(geometry) > 0 && printableWidth(geometry) > 0
}
