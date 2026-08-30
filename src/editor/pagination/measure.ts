import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { EMPTY_DISPLACEMENT, type DisplacementIndex } from './displacement'
import type { BlockKind, MeasuredBlock, MeasuredLine, Measurer } from './types'

/**
 * The DOM half of the engine: turns rendered geometry into the natural
 * coordinates `computePagination` works in.
 *
 * Every call in here is a *read*. Nothing writes to the DOM, so a whole pass
 * costs the browser one forced layout no matter how long the document is --
 * which is the single biggest thing keeping typing smooth.
 *
 * Cost is kept proportional to what actually changed rather than to document
 * length in two more ways:
 *
 * - Only top-level blocks are measured up front, one rect each. Containers are
 *   drilled into lazily, and lines are only resolved for the handful of blocks
 *   that genuinely straddle a page boundary.
 * - Line boxes are cached per block for the duration of the pass, so a
 *   paragraph long enough to span three pages is still measured once.
 */

export interface MeasureContext {
  view: EditorView
  /**
   * CSS `zoom` in effect on an ancestor of the editor. Client rects come back
   * multiplied by it, so it is divided out to keep every figure in unzoomed
   * CSS pixels -- the same units the page geometry is written in.
   */
  scale: number
  /** Displacements from the currently applied spacers. */
  displacement?: DisplacementIndex
  /** Node type name used for manual page breaks. */
  pageBreakName: string
}

/** Guards against a zero or negative zoom making every measurement infinite. */
const MIN_SCALE = 0.05

/** Rects overlapping vertically by more than this belong to the same line. */
const LINE_OVERLAP = 1

/** Client rects thinner than this are collapsed whitespace, not a line. */
const MIN_RECT_HEIGHT = 0.5

export const SPACER_ATTRIBUTE = 'data-page-spacer'

export function createViewMeasurer(context: MeasureContext): Measurer {
  const { view, pageBreakName } = context
  const displacement = context.displacement ?? EMPTY_DISPLACEMENT
  const scale = Math.max(context.scale, MIN_SCALE)

  // The content box's top edge, which is one page margin below page 0. Read
  // once: every other figure is expressed relative to it.
  const originY = view.dom.getBoundingClientRect().top

  const domByPos = new Map<number, HTMLElement>()
  const linesByPos = new Map<number, MeasuredLine[]>()

  /** Viewport y in layout px -> natural y in CSS px. */
  const toNatural = (layoutY: number, pos: number) =>
    (layoutY - originY) / scale - displacement.before(pos)

  function measureChildren(parent: PMNode, basePos: number): MeasuredBlock[] {
    const blocks: MeasuredBlock[] = []

    parent.forEach((child, offset) => {
      const pos = basePos + offset
      const dom = view.nodeDOM(pos)
      // Text nodes and unrendered nodes have no box to measure. Leaving them
      // out means they are never chosen as a break point, which is the safe
      // failure: the content stays where it is rather than being cut wrongly.
      if (!(dom instanceof HTMLElement)) return

      const rect = dom.getBoundingClientRect()
      if (rect.height <= 0) return

      const endPos = pos + child.nodeSize
      const top = toNatural(rect.top, pos)
      // A line break applied inside this block on an earlier pass inflated its
      // measured height; take that back out.
      const inner = displacement.within(pos, endPos)

      domByPos.set(pos, dom)
      blocks.push({
        pos,
        endPos,
        top,
        bottom: top + rect.height / scale - inner,
        kind: kindOf(child),
        explicitBreak: child.type.name === pageBreakName,
      })
    })

    return blocks
  }

  function measureLines(block: MeasuredBlock): MeasuredLine[] {
    const cached = linesByPos.get(block.pos)
    if (cached) return cached

    const lines = readLineBoxes(block)
    linesByPos.set(block.pos, lines)
    return lines
  }

  function readLineBoxes(block: MeasuredBlock): MeasuredLine[] {
    const dom = domByPos.get(block.pos)
    if (!dom || typeof document.createRange !== 'function') return []

    const range = document.createRange()
    let rects: DOMRect[]
    try {
      range.selectNodeContents(dom)
      rects = Array.from(range.getClientRects())
    } catch {
      return []
    } finally {
      range.detach?.()
    }

    // A spacer already inside this paragraph is a box in the range too, and it
    // is tall enough to masquerade as a line. Drop it by matching geometry
    // against the spacers we know we put there.
    const spacerRects = Array.from(dom.querySelectorAll(`[${SPACER_ATTRIBUTE}]`)).map(
      (element) => element.getBoundingClientRect(),
    )
    const isSpacer = (rect: DOMRect) =>
      spacerRects.some(
        (spacer) =>
          Math.abs(spacer.top - rect.top) < 0.5 && Math.abs(spacer.height - rect.height) < 0.5,
      )

    const usable = rects
      .filter((rect) => rect.height >= MIN_RECT_HEIGHT && rect.width > 0 && !isSpacer(rect))
      .sort((a, b) => a.top - b.top || a.left - b.left)

    // One line box can produce several rects (a bold run, a link, a
    // superscript). Merge anything that overlaps vertically.
    const runs: { top: number; bottom: number; left: number }[] = []
    for (const rect of usable) {
      const current = runs[runs.length - 1]
      if (current && rect.top < current.bottom - LINE_OVERLAP) {
        current.bottom = Math.max(current.bottom, rect.bottom)
        current.left = Math.min(current.left, rect.left)
      } else {
        runs.push({ top: rect.top, bottom: rect.bottom, left: rect.left })
      }
    }

    /*
     * Positions are resolved and coordinates converted to natural space
     * *before* the line boxes are worked out, because the leading is inferred
     * from the gap between one line's glyphs and the next one's. A spacer
     * already inside this paragraph opens a gap of several hundred pixels
     * there, and reading that as leading would drag the next break hundreds of
     * pixels up the page -- and then further up on the pass after that.
     * Subtracting the displacement first closes the gap back to real leading.
     */
    const resolved: GlyphRun[] = []
    for (const run of runs) {
      // Aimed at the glyphs, and nudged inside them: exactly on the left edge
      // can resolve to the previous line's trailing position in some browsers.
      const found = view.posAtCoords({
        left: run.left + 1,
        top: (run.top + run.bottom) / 2,
      })
      if (!found) continue

      const pos = clamp(found.pos, block.pos + 1, block.endPos - 1)
      // Positions must advance, or a break could be placed at or before the
      // previous one and the layout loop would stop making progress.
      if (resolved.length > 0 && pos <= resolved[resolved.length - 1].pos) continue

      resolved.push({
        pos,
        top: toNatural(run.top, pos),
        bottom: toNatural(run.bottom, pos),
      })
    }

    return toLineBoxes(resolved)
  }

  return {
    roots: () => measureChildren(view.state.doc, 0),

    children: (block) => {
      const node = view.state.doc.nodeAt(block.pos)
      if (!node || node.childCount === 0) return []
      return measureChildren(node, block.pos + 1)
    },

    lines: (block) => (block.kind === 'text' ? measureLines(block) : []),
  }
}

/** One line's glyphs, already in natural coordinates. */
export interface GlyphRun {
  pos: number
  top: number
  bottom: number
}

/**
 * Turns runs of glyphs into the line boxes that actually tile the block.
 *
 * `Range.getClientRects` measures text, not layout: each rect is the inline
 * box, roughly the font's ascent plus descent, so at `line-height: 1.75` it
 * sits about four pixels inside its line box on every side. Anchoring a break
 * to a glyph top would put the spacer four pixels below where the browser ends
 * the previous line, and every page after the split would start four pixels
 * above its printable band.
 *
 * The line boxes are recovered from the gaps: the boundary between two lines
 * is the middle of the space between their glyphs, which is exactly where one
 * line's half-leading meets the next one's. The result tiles with no gaps, so
 * one line's `bottom` is the next one's `top` -- which is what lets the layout
 * algorithm treat a paragraph as a stack of splittable pieces.
 */
export function toLineBoxes(runs: readonly GlyphRun[]): MeasuredLine[] {
  if (runs.length === 0) return []

  const halfLeading = runs.map((run, index) => {
    if (index === 0) return 0
    const gap = (run.top - runs[index - 1].bottom) / 2
    // Half-leading is a fraction of the font size, so it can never exceed the
    // glyph box. Clamping keeps any gap that is not leading -- a floated
    // element, an oddity in an inline layout -- from distorting the split.
    return Math.min(Math.max(0, gap), run.bottom - run.top)
  })

  // The first line has no gap above it to measure, so it borrows the next
  // one's; uniform line height is the overwhelmingly common case.
  if (runs.length > 1) halfLeading[0] = halfLeading[1]

  const tops = runs.map((run, index) => run.top - halfLeading[index])

  return runs.map((run, index) => ({
    pos: run.pos,
    top: tops[index],
    bottom: index < runs.length - 1 ? tops[index + 1] : run.bottom + halfLeading[index],
  }))
}

function kindOf(node: PMNode): BlockKind {
  if (node.isTextblock) return 'text'
  if (node.isAtom || node.isLeaf || node.childCount === 0) return 'atom'
  return 'container'
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
