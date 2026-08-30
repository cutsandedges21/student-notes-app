import { isUsable, pageStride, printableHeight, type PageGeometry } from './geometry'
import {
  DEFAULT_LIMITS,
  type BreakKind,
  type MeasuredBlock,
  type MeasuredLine,
  type Measurer,
  type ComputedBreak,
  type PaginationLayout,
  type PaginationLimits,
} from './types'

/**
 * The layout algorithm: fills pages greedily and records where the content has
 * to be pushed down to clear a page boundary.
 *
 * It never touches the DOM. Everything it knows arrives through `Measurer`,
 * and everything it produces is a list of spacer positions and heights. That
 * separation is what lets the whole thing be unit tested, and it is also what
 * makes deletion work for free: each run recomputes the entire list from the
 * current measurements, so content that no longer overflows simply produces no
 * break and flows back up, and pages that lost all their content stop being
 * counted.
 *
 * ## Coordinate systems
 *
 * - *Natural* coordinates are where content would sit with no spacers at all.
 *   The measurer hands everything over already converted to these.
 * - *Layout* coordinates are where content actually sits. For any point on the
 *   current page, `layout = natural + shift`.
 *
 * Both are measured from the top of the editable content box, which sits one
 * top margin below page 0. That offset cancels out of every calculation, so
 * page `n`'s printable band starts at layout `n * stride` exactly.
 */

/** Deep enough for list > item > paragraph, with room to spare. */
const MAX_CONTAINER_DEPTH = 6

/** A single block can only close so many pages before something is wrong. */
const MAX_PASSES_PER_BLOCK = 512

/** Sub-pixel slack, so float noise never reads as an overflow. */
const EPSILON = 0.5

export function computePagination(
  measurer: Measurer,
  geometry: PageGeometry,
  limits: PaginationLimits = DEFAULT_LIMITS,
): PaginationLayout {
  if (!isUsable(geometry)) return { breaks: [], pageCount: 1 }

  const printable = printableHeight(geometry)
  const stride = pageStride(geometry)

  const breaks: ComputedBreak[] = []
  /** Index of the page being filled. */
  let page = 0
  /** Natural y at which the current page's content begins. */
  let pageStart = 0
  /** Displacement applied to content on the current page. */
  let shift = 0
  /** Furthest layout y any content reached, used to count bled-over pages. */
  let contentBottom = 0

  /**
   * Close the current page.
   *
   * @param contentTop Natural top of the content that moves to the next page.
   * @param anchor     Natural y the spacer's own top edge will sit at. For a
   *                   block break that is the previous sibling's bottom, since
   *                   the spacer displaces the margin between them.
   * @returns False when no break was possible, which the caller reads as "let
   *          this content overflow".
   */
  function addBreak(
    contentTop: number,
    anchor: number,
    pos: number,
    kind: BreakKind,
  ): boolean {
    // Breaking at or above the page's own start would open an empty page and,
    // worse, would not advance -- this is the loop's termination guarantee.
    if (contentTop <= pageStart + EPSILON) return false

    // Normally the next boundary. It is further along only when one oversized
    // block (a full-height image, say) has bled across whole pages.
    let targetPage = page + 1
    while (targetPage * stride < contentTop + shift) targetPage += 1
    if (targetPage >= limits.maxPages) return false

    const target = targetPage * stride
    const height = target - anchor - shift
    if (height < 0) return false

    breaks.push({ pos, height, delta: target - contentTop - shift, kind, page })
    shift = target - contentTop
    page = targetPage
    pageStart = contentTop
    return true
  }

  /**
   * Move the bookkeeping on after a block that could not be broken and bled
   * over one or more page edges.
   *
   * Without this the engine would still think it was filling the page the
   * block started on, and would push the next paragraph down to clear a
   * boundary the image had already crossed on its own -- leaving a blank page
   * under an image that ended halfway down a perfectly usable one.
   */
  function absorbBleed(block: MeasuredBlock): void {
    const landed = Math.floor((block.bottom + shift) / stride)
    if (landed <= page) return

    if (landed >= limits.maxPages) {
      // Past the cap. An unreachable page start stops any further breaking
      // without needing a flag threaded through every branch.
      page = limits.maxPages - 1
      pageStart = Number.POSITIVE_INFINITY
      return
    }

    page = landed
    // Keeps the invariant every target depends on: pageStart + shift is the
    // layout position of the current page's band start.
    pageStart = landed * stride - shift
  }

  /**
   * Pick the line a paragraph should be cut at, honouring widow and orphan
   * control. Null means "do not split this paragraph here".
   */
  function chooseSplitLine(block: MeasuredBlock, limit: number): MeasuredLine | null {
    const lines = measurer.lines(block)
    if (lines.length < 2) return null

    // Lines above the page start were already carried over by an earlier
    // break; the split has to come from the ones on the page being closed.
    let start = 0
    while (start < lines.length && lines[start].top < pageStart - EPSILON) start += 1
    if (start >= lines.length) return null

    let index = start
    while (index < lines.length && lines[index].bottom <= limit + EPSILON) index += 1

    // Everything fits (the overflow was margin, not text), or the very first
    // line on this page already does not fit. Either way, do not split.
    if (index >= lines.length || index === start) return null

    // Orphan control: too few lines would be left behind, so move the whole
    // paragraph instead.
    if (index - start < limits.minLinesBefore) return null

    // Widow control: too few lines would carry over, so cut earlier.
    if (lines.length - index < limits.minLinesAfter) {
      index = lines.length - limits.minLinesAfter
      if (index - start < limits.minLinesBefore) return null
    }

    return lines[index] ?? null
  }

  function placeBlock(block: MeasuredBlock, prevBottom: number, depth: number): void {
    for (let pass = 0; pass < MAX_PASSES_PER_BLOCK; pass += 1) {
      const limit = pageStart + printable
      if (block.bottom <= limit + EPSILON) return

      // Begins past the limit: none of it belongs on the page being closed.
      if (block.top >= limit - EPSILON) {
        if (!addBreak(block.top, prevBottom, block.pos, 'block')) return
        continue
      }

      // Straddles the boundary. Try to split it at the finest level available:
      // between a container's children, then between a paragraph's lines.
      if (block.kind === 'container' && depth < MAX_CONTAINER_DEPTH) {
        const children = measurer.children(block)
        if (children.length > 0) {
          placeChildren(children, block.top, depth + 1)
          return
        }
      }

      if (block.kind === 'text') {
        const line = chooseSplitLine(block, limit)
        if (line && addBreak(line.top, line.top, line.pos, 'line')) continue
      }

      // Unsplittable, or the split was refused by widow/orphan control: send
      // the whole block down. If that is refused too, the block is already
      // alone on its page and taller than one, so nothing can be done for it
      // -- it bleeds, and the bookkeeping follows it onto the page it ends on.
      if (!addBreak(block.top, prevBottom, block.pos, 'block')) {
        absorbBleed(block)
        return
      }
    }
  }

  function placeChildren(
    blocks: readonly MeasuredBlock[],
    containerTop: number,
    depth: number,
  ): void {
    // The spacer for a break before the first child sits at the container's
    // content edge, not below a sibling.
    let prevBottom = containerTop
    let breakBeforeNext = false

    for (const block of blocks) {
      if (block.explicitBreak) {
        const limit = pageStart + printable
        if (block.bottom > limit + EPSILON) {
          // The marker itself did not fit. Pushing it down already starts the
          // new page, so the content after it needs no second break -- that
          // would leave a page holding nothing but the marker.
          breakBeforeNext = !addBreak(block.top, prevBottom, block.pos, 'explicit')
        } else {
          breakBeforeNext = true
        }
        prevBottom = block.bottom
        contentBottom = Math.max(contentBottom, block.bottom + shift)
        continue
      }

      if (breakBeforeNext) {
        addBreak(block.top, prevBottom, block.pos, 'explicit')
        breakBeforeNext = false
      }

      placeBlock(block, prevBottom, depth)
      prevBottom = block.bottom
      contentBottom = Math.max(contentBottom, block.bottom + shift)
    }
  }

  placeChildren(measurer.roots(), 0, 0)

  // Content that bled past the last break still needs pages under it. The
  // content box starts one top margin down, which is added back to turn a
  // content-relative offset into a distance from page 0's top edge.
  const bledPages = Math.floor((contentBottom + geometry.marginTop) / stride) + 1

  return {
    breaks,
    pageCount: Math.max(1, page + 1, Math.min(bledPages, limits.maxPages)),
  }
}

/**
 * Whether two layouts are close enough to skip re-applying decorations.
 *
 * Measurement is float-noisy and a `ResizeObserver` fires again after every
 * spacer we insert, so without this the engine would dispatch a transaction on
 * every observation and never settle.
 */
export function layoutsEqual(
  a: PaginationLayout,
  b: PaginationLayout,
  tolerance = EPSILON,
): boolean {
  if (a.pageCount !== b.pageCount) return false
  if (a.breaks.length !== b.breaks.length) return false
  return a.breaks.every((left, index) => {
    const right = b.breaks[index]
    return (
      left.pos === right.pos &&
      left.kind === right.kind &&
      Math.abs(left.height - right.height) <= tolerance
    )
  })
}
