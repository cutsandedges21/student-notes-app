import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { computePagination, layoutsEqual } from './computeBreaks'
import type { PaginationController } from './controller'
import { DisplacementIndex } from './displacement'
import { isUsable } from './geometry'
import { createViewMeasurer, SPACER_ATTRIBUTE } from './measure'
import { createScheduler, type Scheduler } from './scheduler'
import type { ComputedBreak, PageNumberPosition, PaginationLayout } from './types'

/**
 * The engine's ProseMirror half.
 *
 * ProseMirror owns every node inside the editable element and re-renders from
 * the document on each transaction, so overflowing content cannot be moved
 * into sibling page elements: the next keystroke would put it back, and
 * position mapping would no longer agree with the DOM. Multiple editable roots
 * are worse still -- the caret cannot cross between them and a selection
 * spanning a break has no representation.
 *
 * So the split is drawn rather than performed. One editable element holds the
 * whole document, page-shaped backdrops are painted behind it, and a measured
 * spacer widget at each break point pushes the content that follows onto the
 * next page. A spacer placed at an inline position turns into a block box
 * inside the paragraph, which splits it between two line boxes -- a genuine
 * mid-sentence break, with the document model untouched.
 */

export interface PaginationPluginState {
  decorations: DecorationSet
  breaks: ComputedBreak[]
  pageCount: number
  lastPageFill: number
}

export const paginationPluginKey = new PluginKey<PaginationPluginState>('pagination')

/** Quiet period before a pass, and the ceiling during a continuous burst. */
const DEBOUNCE_MS = 90
const MAX_DEBOUNCE_MS = 400

/**
 * Applying spacers changes the editor's height, which the ResizeObserver sees,
 * which asks for another pass. That normally settles on the second pass
 * because the layout comes out identical. This caps the cycle in case some
 * content measures differently every time, so a pathological document degrades
 * to slightly stale pagination rather than a frozen tab.
 */
const MAX_PASSES_WITHOUT_EDIT = 12

/**
 * How close together applies have to be to count towards that cap.
 *
 * A runaway observe-apply cycle re-applies within milliseconds. Anything
 * spaced further apart than this is ordinary work -- a settings change, a late
 * image, the window being resized -- and must not be throttled, or the guard
 * latches on after a long paste and pagination stops responding until the next
 * keystroke.
 */
const SETTLE_WINDOW_MS = 1000

const EMPTY_STATE: PaginationPluginState = {
  decorations: DecorationSet.empty,
  breaks: [],
  pageCount: 1,
  lastPageFill: 0,
}

export function paginationPlugin(controller: PaginationController): Plugin<PaginationPluginState> {
  return new Plugin<PaginationPluginState>({
    key: paginationPluginKey,

    state: {
      init: () => EMPTY_STATE,

      apply(tr, value) {
        const next = tr.getMeta(paginationPluginKey) as PaginationPluginState | undefined
        if (next) return next
        if (!tr.docChanged) return value

        // Carry the existing spacers through the edit rather than dropping
        // them. They are stale by a few pixels until the next pass lands, but
        // holding them steady is what stops the page boundaries flickering
        // under the cursor while someone types.
        const breaks: ComputedBreak[] = []
        for (const item of value.breaks) {
          const mapped = tr.mapping.mapResult(item.pos)
          if (mapped.deleted) continue
          breaks.push({ ...item, pos: mapped.pos })
        }

        return {
          decorations: value.decorations.map(tr.mapping, tr.doc),
          breaks,
          pageCount: value.pageCount,
          lastPageFill: value.lastPageFill,
        }
      },
    },

    props: {
      decorations: (state) => paginationPluginKey.getState(state)?.decorations,
    },

    view: (view) => new PaginationPluginView(view, controller),
  })
}

class PaginationPluginView {
  private view: EditorView
  private readonly controller: PaginationController
  private readonly scheduler: Scheduler
  private readonly detachController: () => void
  private readonly resizeObserver: ResizeObserver | null
  private destroyed = false
  private passesWithoutEdit = 0
  /** What the spacers currently in the DOM were drawn with. */
  private renderedPageNumbers: PageNumberPosition | null = null
  private lastApplyAt = 0

  constructor(view: EditorView, controller: PaginationController) {
    this.view = view
    this.controller = controller
    this.scheduler = createScheduler(() => this.run(), {
      wait: DEBOUNCE_MS,
      maxWait: MAX_DEBOUNCE_MS,
    })
    this.detachController = controller.attach(() => this.scheduler.schedule())

    // Catches everything a transaction does not: the column resizing, a late
    // image, a web font swapping in and changing every line height.
    this.resizeObserver =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => this.scheduler.schedule())
        : null
    this.resizeObserver?.observe(view.dom)

    document.fonts?.ready
      .then(() => this.scheduler.schedule())
      .catch(() => {
        /* Font loading is an optimisation here, not a requirement. */
      })

    this.scheduler.schedule()
  }

  update(view: EditorView, previousState: { doc: unknown }): void {
    this.view = view
    // Reference equality: ProseMirror only allocates a new doc when the
    // content actually changed, so this is O(1) rather than a deep compare.
    if (previousState.doc !== view.state.doc) {
      this.passesWithoutEdit = 0
      this.scheduler.schedule()
    }
  }

  destroy(): void {
    this.destroyed = true
    this.scheduler.cancel()
    this.detachController()
    this.resizeObserver?.disconnect()
  }

  private run(): void {
    if (this.destroyed) return

    const { view, controller } = this
    if (!view.dom.isConnected) return

    // Repaginating mid-composition would move the text the IME is editing and
    // can cancel the composition outright.
    if (view.composing) {
      this.scheduler.schedule()
      return
    }

    const current = paginationPluginKey.getState(view.state) ?? EMPTY_STATE

    if (!controller.enabled || !isUsable(controller.geometry)) {
      controller.publish(1, 0)
      if (current.breaks.length > 0) this.apply({ breaks: [], pageCount: 1, lastPageFill: 0 })
      return
    }

    if (Date.now() - this.lastApplyAt > SETTLE_WINDOW_MS) this.passesWithoutEdit = 0
    if (this.passesWithoutEdit >= MAX_PASSES_WITHOUT_EDIT) return

    const measurer = createViewMeasurer({
      view,
      scale: controller.scale,
      displacement: new DisplacementIndex(current.breaks),
      pageBreakName: controller.pageBreakName,
    })

    const layout = computePagination(measurer, controller.geometry, controller.limits)
    controller.publish(layout.pageCount, layout.lastPageFill)

    // The layout can be identical while the spacers still need redrawing:
    // moving the page number, or switching it off, changes what is inside
    // them without moving a single break.
    const numbersMatch = this.renderedPageNumbers === controller.pageNumbers
    if (numbersMatch && layoutsEqual(layout, current)) {
      this.passesWithoutEdit = 0
      return
    }

    this.passesWithoutEdit += 1
    this.apply(layout)
  }

  private apply(layout: PaginationLayout): void {
    const { view } = this
    const { pageNumbers } = this.controller
    this.renderedPageNumbers = pageNumbers
    this.lastApplyAt = Date.now()
    const decorations = DecorationSet.create(
      view.state.doc,
      layout.breaks.map((item) => spacerDecoration(item, pageNumbers)),
    )

    // A transaction with no steps: `docChanged` is false, so Tiptap never
    // emits `update`, autosave never fires, and the document's version never
    // moves. Pagination stays a view concern and never reaches storage.
    const tr = view.state.tr
      .setMeta(paginationPluginKey, {
        decorations,
        breaks: layout.breaks,
        pageCount: layout.pageCount,
        lastPageFill: layout.lastPageFill,
      })
      .setMeta('addToHistory', false)

    view.dispatch(tr)
  }
}

function spacerDecoration(
  computedBreak: ComputedBreak,
  pageNumbers: PageNumberPosition,
): Decoration {
  const height = round(computedBreak.height)
  // A hair under the space actually left on the page. Landing a box exactly on
  // the boundary is the classic way to talk a print engine into an extra blank
  // sheet, and a pixel is not visible in either medium.
  const printFill = Math.max(0, round(computedBreak.printFill) - 1)
  const label = computedBreak.page + 1

  return Decoration.widget(
    computedBreak.pos,
    () => createSpacer(computedBreak.kind, height, printFill, pageNumbers, label),
    {
      // Before the content at this position, which is what makes it push.
      side: -1,
      // Everything that changes the rendered element belongs in the key, or
      // ProseMirror reuses the old DOM and the change never appears.
      key: `page-spacer:${computedBreak.kind}:${height}:${printFill}:${pageNumbers}:${label}`,
      // The spacer is scenery. Clicking near it should put the caret in the
      // text, not select a widget.
      ignoreSelection: true,
      marks: [],
    },
  )
}

function createSpacer(
  kind: ComputedBreak['kind'],
  height: number,
  printFill: number,
  pageNumbers: PageNumberPosition,
  label: number,
): HTMLElement {
  const element = document.createElement('div')
  element.setAttribute(SPACER_ATTRIBUTE, kind)
  element.setAttribute('aria-hidden', 'true')
  element.contentEditable = 'false'
  element.style.height = `${height}px`
  // Read only by the print stylesheet: on paper the spacer stops at the foot
  // of the text band and the browser supplies the margins and the sheet change.
  element.style.setProperty('--doc-print-fill', `${printFill}px`)

  /*
   * The printed page number.
   *
   * It has to live here, in the flow, rather than in the running footer beside
   * the writer's own footer text. A `position: fixed` footer is the only way to
   * repeat text on every printed sheet, but it repeats it *identically* -- and
   * the one CSS feature that would vary it, `counter(page)`, resolves to 0 in
   * every browser because the page counter only exists inside `@page` margin
   * boxes, which none of them implement. A spacer, by contrast, already knows
   * which page it closes and how much room is left on it, so it can put the
   * right number in the right place. Hidden on screen, where the footer band
   * shows the number instead.
   */
  if (pageNumbers !== 'off') {
    const number = document.createElement('div')
    number.className = 'doc-print-page-number'
    number.dataset.align = pageNumbers
    number.textContent = String(label)
    element.appendChild(number)
  }

  return element
}

function round(value: number): number {
  return Math.max(0, Math.round(value * 100) / 100)
}
