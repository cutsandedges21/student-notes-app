/**
 * Custom pagination engine.
 *
 * ```
 * React                          ProseMirror
 * ─────                          ───────────
 * PaginatedSheet ──┐          ┌── paginationPlugin
 *   page backdrops │          │     │
 *   page numbers   ├ controller ────┤ schedules a pass (debounced + rAF)
 *   auto-fit zoom  │          │     │
 *   ruler margins ─┘          └──── │
 *                                   ▼
 *                            createViewMeasurer   (DOM reads only)
 *                                   ▼
 *                            computePagination    (pure, unit tested)
 *                                   ▼
 *                            spacer decorations
 * ```
 */

export {
  A4,
  DEFAULT_PAGE_GAP,
  INCH,
  PAPER_SIZES,
  US_LEGAL,
  US_LETTER,
  bandTop,
  isUsable,
  pageStride,
  pageTop,
  printableHeight,
  printableWidth,
  stackHeight,
  type PageGeometry,
  type PaperSizeName,
} from './geometry'

export {
  DEFAULT_LIMITS,
  EXACT_LIMITS,
  type ComputedBreak,
  type MeasuredBlock,
  type MeasuredLine,
  type Measurer,
  type PaginationLayout,
  type PaginationLimits,
} from './types'

export { computePagination, layoutsEqual } from './computeBreaks'
export { DisplacementIndex, type Displacement } from './displacement'
export { createViewMeasurer, SPACER_ATTRIBUTE, type MeasureContext } from './measure'
export { createScheduler, type Scheduler } from './scheduler'
export {
  PaginationController,
  type PaginationSettings,
  type PaginationSnapshot,
} from './controller'
export { paginationPlugin, paginationPluginKey } from './paginationPlugin'
export { Pagination, type PaginationOptions } from './Pagination'
export { PageBreak, PAGE_BREAK_NAME } from './PageBreak'
