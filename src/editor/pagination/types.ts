/**
 * The vocabulary shared between the measuring layer (which touches the DOM)
 * and the layout algorithm (which does not).
 *
 * Keeping the algorithm behind this interface is what makes it testable: the
 * unit tests hand `computePagination` a hand-written `Measurer` and assert on
 * the breaks it produces, with no browser layout involved.
 */

export type BlockKind =
  /** Cannot be broken into: an image, a rule, a manual page break. */
  | 'atom'
  /** Holds inline content, so it can be split between its line boxes. */
  | 'text'
  /** Holds other blocks, so it can be split between its children. */
  | 'container'

/**
 * One block, measured in *natural* coordinates: where it would sit if no page
 * spacers had been inserted. The origin is the top of the editable content box
 * (which is one top margin below the first page's top edge).
 */
export interface MeasuredBlock {
  /** Document position immediately before the node. */
  pos: number
  /** Document position immediately after the node. */
  endPos: number
  /** Natural top edge of the border box, in CSS px. */
  top: number
  /** Natural bottom edge of the border box, in CSS px. */
  bottom: number
  kind: BlockKind
  /** True for a manual page break node inserted by the writer. */
  explicitBreak: boolean
}

/** One line box inside a text block, in natural coordinates. */
export interface MeasuredLine {
  /** Document position of the first character on the line. */
  pos: number
  top: number
  bottom: number
}

export interface Measurer {
  /** Top-level blocks of the document, in document order. */
  roots(): MeasuredBlock[]
  /**
   * Child blocks of a container, in document order. Empty when the block
   * cannot be drilled into, which the algorithm treats as unsplittable.
   */
  children(block: MeasuredBlock): MeasuredBlock[]
  /**
   * Line boxes of a text block, in document order. Empty when the lines could
   * not be resolved, which again degrades to an unsplittable block.
   */
  lines(block: MeasuredBlock): MeasuredLine[]
}

export type BreakKind =
  /** Inserted before a whole block that would not fit. */
  | 'block'
  /** Inserted inside a paragraph, between two of its line boxes. */
  | 'line'
  /** Inserted because the writer asked for a page break here. */
  | 'explicit'

/**
 * One automatic break the engine worked out. Not to be confused with the
 * `PageBreak` node, which is the writer's manual break and lives in the
 * document; this is a measurement, and is thrown away and recomputed.
 */
export interface ComputedBreak {
  /** Document position the spacer widget is anchored to. */
  pos: number
  /** Spacer height in CSS px. */
  height: number
  /**
   * How far this break displaces everything after it.
   *
   * Not the same as `height`: a block break also cancels the top margin of the
   * block it precedes (see `[data-page-spacer] + *` in index.css), so the net
   * displacement is the spacer minus that absorbed margin. The next pass needs
   * the net figure to convert measured positions back to natural ones.
   */
  delta: number
  kind: BreakKind
  /** Index of the page this break closes. */
  page: number
}

export interface PaginationLayout {
  breaks: ComputedBreak[]
  pageCount: number
}

export interface PaginationLimits {
  /**
   * Orphan control: the fewest lines of a paragraph allowed to stay behind on
   * the page being closed. A split that would leave fewer pushes the whole
   * paragraph to the next page instead.
   */
  minLinesBefore: number
  /**
   * Widow control: the fewest lines allowed to carry over to the next page.
   * A split that would leave fewer is moved earlier in the paragraph.
   */
  minLinesAfter: number
  /** Hard stop, so pathological content cannot spin the layout loop. */
  maxPages: number
}

export const DEFAULT_LIMITS: PaginationLimits = {
  minLinesBefore: 2,
  minLinesAfter: 2,
  maxPages: 500,
}

/** Widow and orphan control switched off: split at the exact overflow line. */
export const EXACT_LIMITS: PaginationLimits = {
  minLinesBefore: 1,
  minLinesAfter: 1,
  maxPages: 500,
}
