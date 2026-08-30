import { describe, expect, it } from 'vitest'
import { computePagination, layoutsEqual } from './computeBreaks'
import { pageStride, printableHeight, US_LETTER, type PageGeometry } from './geometry'
import {
  DEFAULT_LIMITS,
  EXACT_LIMITS,
  type MeasuredBlock,
  type MeasuredLine,
  type Measurer,
  type PaginationLimits,
} from './types'

/*
 * The algorithm is exercised through a hand-written measurer, so these tests
 * describe the layout rules rather than the browser's text shaping. Every
 * figure is a natural coordinate: where the content would sit if no spacer had
 * ever been inserted.
 */

const PRINTABLE = printableHeight(US_LETTER) // 864
const STRIDE = pageStride(US_LETTER) // 1080

interface BlockSpec {
  top: number
  height: number
  kind?: MeasuredBlock['kind']
  pos?: number
  explicitBreak?: boolean
  lines?: number[]
  children?: BlockSpec[]
}

/** Builds a measurer from a nested description, assigning positions in order. */
function measurerFor(specs: BlockSpec[]): Measurer {
  const linesByPos = new Map<number, MeasuredLine[]>()
  const childrenByPos = new Map<number, MeasuredBlock[]>()
  let nextPos = 0

  const build = (list: BlockSpec[]): MeasuredBlock[] =>
    list.map((spec) => {
      const pos = spec.pos ?? nextPos
      nextPos = pos + 1000
      const block: MeasuredBlock = {
        pos,
        endPos: pos + 999,
        top: spec.top,
        bottom: spec.top + spec.height,
        kind: spec.kind ?? (spec.lines ? 'text' : 'atom'),
        explicitBreak: spec.explicitBreak ?? false,
      }

      if (spec.lines) {
        const height = spec.height / spec.lines.length
        linesByPos.set(
          pos,
          spec.lines.map((lineTop, index) => ({
            pos: pos + 1 + index,
            top: lineTop,
            bottom: lineTop + height,
          })),
        )
      }
      if (spec.children) childrenByPos.set(pos, build(spec.children))
      return block
    })

  const roots = build(specs)

  return {
    roots: () => roots,
    children: (block) => childrenByPos.get(block.pos) ?? [],
    lines: (block) => linesByPos.get(block.pos) ?? [],
  }
}

/** Evenly spaced line tops, the shape a wrapped paragraph produces. */
function lines(top: number, count: number, lineHeight: number): number[] {
  return Array.from({ length: count }, (_, index) => top + index * lineHeight)
}

const run = (specs: BlockSpec[], limits: PaginationLimits = DEFAULT_LIMITS, geometry: PageGeometry = US_LETTER) =>
  computePagination(measurerFor(specs), geometry, limits)

describe('computePagination', () => {
  it('leaves content that fits on one page alone', () => {
    const layout = run([
      { top: 0, height: 300 },
      { top: 312, height: 400 },
    ])

    expect(layout.breaks).toEqual([])
    expect(layout.pageCount).toBe(1)
  })

  it('treats the printable height as the limit, not the page height', () => {
    // 36 lines of 24px is 864: exactly US Letter's printable height with
    // one-inch margins, and the last thing that fits on a single page.
    const exact = run([{ top: 0, height: 864, kind: 'text', lines: lines(0, 36, 24) }], EXACT_LIMITS)
    expect(exact.pageCount).toBe(1)
    expect(exact.breaks).toEqual([])

    const oneLineMore = run(
      [{ top: 0, height: 888, kind: 'text', lines: lines(0, 37, 24) }],
      EXACT_LIMITS,
    )
    expect(oneLineMore.pageCount).toBe(2)
    expect(PRINTABLE).toBe(864)
  })

  it('pushes a whole block down when it cannot be split', () => {
    const layout = run([
      { top: 0, height: 800 },
      { top: 812, height: 200, kind: 'atom' },
    ])

    expect(layout.pageCount).toBe(2)
    expect(layout.breaks).toHaveLength(1)
    expect(layout.breaks[0].kind).toBe('block')
    expect(layout.breaks[0].page).toBe(0)
  })

  it('lands the moved block exactly on the next printable band', () => {
    const layout = run([
      { top: 0, height: 800 },
      { top: 812, height: 200, kind: 'atom' },
    ])

    // The spacer starts at the previous block's bottom (800) and its own
    // bottom edge has to reach the second band, because the margin between
    // the two blocks is absorbed by `[data-page-spacer] + *`.
    const [pageBreak] = layout.breaks
    expect(pageBreak.height).toBe(STRIDE - 800)
    // Displacement is the spacer minus that absorbed 12px margin, so the
    // block's own top (812) maps onto the band start.
    expect(812 + pageBreak.delta).toBe(STRIDE)
  })

  // The printed spacer is not the screen spacer. On screen it has to clear the
  // bottom margin, the gap between sheets and the next top margin; on paper
  // `@page` supplies all three, so it only reaches the foot of the text band --
  // which is what puts the printed page number at the foot of the page rather
  // than directly under the last line.
  it('measures the printed filler to the foot of the page, not to the next sheet', () => {
    const [pageBreak] = run([
      { top: 0, height: 800 },
      { top: 812, height: 200, kind: 'atom' },
    ]).breaks

    expect(pageBreak.height).toBe(STRIDE - 800)
    expect(pageBreak.printFill).toBe(PRINTABLE - 800)
  })

  it('reports the room left under a single page for its printed footer', () => {
    expect(run([{ top: 0, height: 300 }]).lastPageFill).toBe(PRINTABLE - 300)
  })

  it("measures the last page's filler from that page's own start", () => {
    // The block moves to page 2, where it occupies 200 of the 864 available.
    const layout = run([
      { top: 0, height: 800 },
      { top: 812, height: 200, kind: 'atom' },
    ])

    expect(layout.lastPageFill).toBe(PRINTABLE - 200)
  })

  it('splits a paragraph between its lines at the overflow point', () => {
    const layout = run(
      [
        { top: 0, height: 600 },
        // 20 lines of 24px running from 600 to 1080; the page's limit is 864,
        // so the line starting at 864 is the first that does not fit.
        { top: 600, height: 480, kind: 'text', lines: lines(600, 20, 24) },
      ],
      EXACT_LIMITS,
    )

    expect(layout.pageCount).toBe(2)
    expect(layout.breaks).toHaveLength(1)
    expect(layout.breaks[0].kind).toBe('line')
    // Eleventh line: 600 + 11 * 24 = 864.
    expect(layout.breaks[0].pos).toBe(1000 + 1 + 11)
  })

  it('carries a paragraph across three pages, splitting it twice', () => {
    const layout = run(
      [{ top: 0, height: 2400, kind: 'text', lines: lines(0, 100, 24) }],
      EXACT_LIMITS,
    )

    expect(layout.pageCount).toBe(3)
    expect(layout.breaks).toHaveLength(2)
    expect(layout.breaks.every((item) => item.kind === 'line')).toBe(true)
    expect(layout.breaks[0].page).toBe(0)
    expect(layout.breaks[1].page).toBe(1)
    // Each break moves its line onto the next band exactly.
    const first = layout.breaks[0]
    expect(first.height).toBeCloseTo(STRIDE - 864, 6)
  })

  it('moves the whole paragraph when a split would orphan too few lines', () => {
    // Only one line would stay behind on the first page.
    const layout = run([
      { top: 0, height: 840 },
      { top: 840, height: 240, kind: 'text', lines: lines(840, 10, 24) },
    ])

    expect(layout.breaks).toHaveLength(1)
    expect(layout.breaks[0].kind).toBe('block')
  })

  it('moves the split earlier when it would widow too few lines', () => {
    // 864 falls one line short of the paragraph's end, so a naive split would
    // carry a single line over.
    const paragraphLines = lines(600, 11, 24) // 600..840, ends at 864
    const layout = run([
      { top: 0, height: 600 },
      { top: 600, height: 12 * 24, kind: 'text', lines: [...paragraphLines, 864] },
    ])

    expect(layout.breaks).toHaveLength(1)
    expect(layout.breaks[0].kind).toBe('line')
    // Two lines carried over rather than one: the 11th line (index 10).
    expect(layout.breaks[0].pos).toBe(1000 + 1 + 10)
  })

  it('splits a list between its items rather than moving the whole list', () => {
    const layout = run([
      { top: 0, height: 700 },
      {
        top: 700,
        height: 600,
        kind: 'container',
        children: [
          { top: 700, height: 100 },
          { top: 800, height: 100 },
          { top: 900, height: 100 },
          { top: 1000, height: 300 },
        ],
      },
    ])

    expect(layout.breaks).toHaveLength(1)
    // The second item runs 800..900 and so is the one that crosses the 864
    // limit. It moves down whole; the first item stays put, and the list is
    // not sent to the next page in one piece.
    expect(layout.breaks[0].pos).toBe(3000)
    expect(layout.pageCount).toBe(2)
  })

  it('starts a new page after a manual page break', () => {
    const layout = run([
      { top: 0, height: 100 },
      { top: 112, height: 1, explicitBreak: true },
      { top: 125, height: 100 },
    ])

    expect(layout.pageCount).toBe(2)
    expect(layout.breaks).toHaveLength(1)
    expect(layout.breaks[0].kind).toBe('explicit')
    // The break is anchored before the block that follows the marker.
    expect(layout.breaks[0].pos).toBe(2000)
  })

  it('does not add a second page when a manual break is the last node', () => {
    const layout = run([
      { top: 0, height: 100 },
      { top: 112, height: 1, explicitBreak: true },
    ])

    expect(layout.breaks).toEqual([])
    expect(layout.pageCount).toBe(1)
  })

  it('does not leave a page holding nothing but a pushed-down break marker', () => {
    const layout = run([
      { top: 0, height: 860 },
      { top: 872, height: 1, explicitBreak: true },
      { top: 885, height: 100 },
    ])

    // The marker did not fit, so pushing it already opened the new page. The
    // content after it follows on that page rather than on a third one.
    expect(layout.pageCount).toBe(2)
    expect(layout.breaks).toHaveLength(1)
  })

  // Regression: the page bookkeeping has to follow a block that bled over an
  // edge on its own. Left on page 0, the engine would push the paragraph down
  // to clear a boundary the image had already crossed, leaving a blank page
  // under an image that ended halfway down a perfectly usable one.
  it('resumes on the page an oversized unsplittable block ended on', () => {
    const layout = run([
      { top: 0, height: 2500, kind: 'atom' },
      { top: 2512, height: 100 },
    ])

    // Nothing can move a 2500px image, so it covers pages 0 to 2. The
    // paragraph after it still fits in what is left of page 2's band.
    expect(layout.breaks).toEqual([])
    expect(layout.pageCount).toBe(3)
  })

  it('breaks against the page an oversized block ended on, not the one it started on', () => {
    const layout = run([
      { top: 0, height: 2500, kind: 'atom' },
      // Page 2's band ends at 3024, so this one does not fit after the image.
      { top: 2512, height: 600 },
    ])

    expect(layout.breaks).toHaveLength(1)
    expect(layout.breaks[0].page).toBe(2)
    expect(2512 + layout.breaks[0].delta).toBe(3 * STRIDE)
    expect(layout.pageCount).toBe(4)
  })

  it('terminates on a block taller than a page that cannot be split', () => {
    const layout = run([{ top: 0, height: 10_000, kind: 'atom' }])

    expect(layout.breaks).toEqual([])
    expect(layout.pageCount).toBe(Math.floor((10_000 + US_LETTER.marginTop) / STRIDE) + 1)
  })

  it('respects maxPages rather than growing without bound', () => {
    const layout = run(
      Array.from({ length: 50 }, (_, index) => ({
        top: index * 900,
        height: 800,
        kind: 'atom' as const,
      })),
      { ...DEFAULT_LIMITS, maxPages: 5 },
    )

    expect(layout.pageCount).toBeLessThanOrEqual(5)
  })

  // Deletion is not a separate code path: a pass always recomputes from the
  // current measurements, so shorter content simply yields fewer breaks and
  // the pages that lost their content stop being counted.
  it('gives back the pages when content shrinks', () => {
    const long = run([{ top: 0, height: 2400, kind: 'text', lines: lines(0, 100, 24) }], EXACT_LIMITS)
    expect(long.pageCount).toBe(3)

    const short = run([{ top: 0, height: 240, kind: 'text', lines: lines(0, 10, 24) }], EXACT_LIMITS)
    expect(short.pageCount).toBe(1)
    expect(short.breaks).toEqual([])
  })

  it('produces no breaks for a geometry with no printable height', () => {
    const airless: PageGeometry = { ...US_LETTER, marginTop: 600, marginBottom: 600 }
    const layout = run([{ top: 0, height: 5000 }], DEFAULT_LIMITS, airless)

    expect(layout.breaks).toEqual([])
    expect(layout.pageCount).toBe(1)
  })
})

describe('layoutsEqual', () => {
  const layout = (height: number) => ({
    pageCount: 2,
    lastPageFill: 0,
    breaks: [
      { pos: 10, height, delta: height, printFill: height, kind: 'block' as const, page: 0 },
    ],
  })

  it('ignores sub-pixel drift, so a settled layout is not re-applied', () => {
    expect(layoutsEqual(layout(240), layout(240.2))).toBe(true)
  })

  it('sees a real change', () => {
    expect(layoutsEqual(layout(240), layout(260))).toBe(false)
    expect(
      layoutsEqual(layout(240), { pageCount: 3, lastPageFill: 0, breaks: layout(240).breaks }),
    ).toBe(false)
  })
})
