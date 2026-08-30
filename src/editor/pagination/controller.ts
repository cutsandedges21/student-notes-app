import { US_LETTER, type PageGeometry } from './geometry'
import { DEFAULT_LIMITS, type PageNumberPosition, type PaginationLimits } from './types'

/**
 * The handle React and the ProseMirror plugin share.
 *
 * The plugin cannot read React state and React must not reach into the editor
 * view, so the two meet here: React writes settings (margins, zoom, whether
 * pagination is on at all) and reads the resulting page count; the plugin does
 * the reverse. Settings are pushed as plain mutation rather than through
 * transactions, so dragging a margin marker never touches the document.
 */

export interface PaginationSettings {
  geometry: PageGeometry
  /** CSS `zoom` applied to the sheet, so measurements can divide it out. */
  scale: number
  /** False leaves the document in continuous flow with no spacers. */
  enabled: boolean
  limits: PaginationLimits
  /** Node type name that represents a manual page break. */
  pageBreakName: string
  /** Where the page number sits, or `off`. */
  pageNumbers: PageNumberPosition
}

/** What React renders from: page backdrops, page numbers, stack height. */
export interface PaginationSnapshot {
  /**
   * False until the engine has measured the laid-out document at least once.
   *
   * The count starts at 1 and only becomes real after a pass -- but the text
   * is painted before that pass can run, because the text is what the pass
   * measures. A renderer that trusts the count during that window draws one
   * page of paper under several pages of text, leaving the overflow on the
   * backdrop. Renderers check this and draw a continuous sheet until the real
   * count arrives.
   */
  measured: boolean
  pageCount: number
  geometry: PageGeometry
  enabled: boolean
  /** Space left below the last page's content, for its printed footer. */
  lastPageFill: number
}

type Listener = () => void

export class PaginationController implements PaginationSettings {
  geometry: PageGeometry = US_LETTER
  scale = 1
  enabled = true
  limits: PaginationLimits = DEFAULT_LIMITS
  pageBreakName = 'pageBreak'
  pageNumbers: PageNumberPosition = 'off'

  private snapshot: PaginationSnapshot = {
    measured: false,
    pageCount: 1,
    geometry: this.geometry,
    enabled: this.enabled,
    lastPageFill: 0,
  }

  private readonly listeners = new Set<Listener>()
  /*
   * A set, not a single slot. An editor can hold more than one plugin view
   * over its life -- React re-mounts it in StrictMode, and ProseMirror
   * rebuilds plugin views when the props change -- and the old one is not
   * always torn down before the new one is built. With one slot, a late
   * teardown clears the live view's callback and the controller goes quiet:
   * margins, zoom and page numbering all stop reaching the engine, and
   * nothing repaginates again until an edit happens to trigger a pass.
   */
  private readonly passRequesters = new Set<() => void>()
  /** Set when a change arrives with no view attached to hear it. */
  private passPending = false

  constructor(settings: Partial<PaginationSettings> = {}) {
    Object.assign(this, settings)
    this.snapshot = {
      measured: false,
      pageCount: 1,
      geometry: this.geometry,
      enabled: this.enabled,
      lastPageFill: 0,
    }
    this.getSnapshot = this.getSnapshot.bind(this)
    this.subscribe = this.subscribe.bind(this)
  }

  /**
   * Change settings and ask for a fresh pass. Only rewrites the published
   * snapshot when something a renderer cares about actually moved, so a zoom
   * tweak does not re-render the page backdrops.
   */
  configure(patch: Partial<PaginationSettings>): void {
    let visibleChange = false
    let anyChange = false

    if (patch.geometry && !geometryEquals(patch.geometry, this.geometry)) {
      this.geometry = patch.geometry
      visibleChange = true
    }
    if (patch.enabled !== undefined && patch.enabled !== this.enabled) {
      this.enabled = patch.enabled
      visibleChange = true
    }
    if (patch.scale !== undefined && patch.scale !== this.scale) {
      this.scale = patch.scale
      anyChange = true
    }
    if (patch.limits && patch.limits !== this.limits) {
      this.limits = patch.limits
      anyChange = true
    }
    if (patch.pageBreakName && patch.pageBreakName !== this.pageBreakName) {
      this.pageBreakName = patch.pageBreakName
      anyChange = true
    }
    // The number is drawn inside the spacers, so switching it on or off has
    // to redraw the decorations, not just re-render React.
    if (patch.pageNumbers && patch.pageNumbers !== this.pageNumbers) {
      this.pageNumbers = patch.pageNumbers
      anyChange = true
    }

    if (visibleChange) {
      this.snapshot = {
        ...this.snapshot,
        geometry: this.geometry,
        enabled: this.enabled,
      }
      this.emit()
    }

    // React re-renders for reasons that have nothing to do with the page --
    // a keystroke's `onChange`, say -- and every one of those calls through
    // here. Scheduling a pass only when a setting actually moved keeps those
    // renders off the measuring path entirely.
    if (visibleChange || anyChange) this.invalidate()
  }

  /** Ask the plugin for a pass. Held over if no view is listening yet. */
  invalidate(): void {
    if (this.passRequesters.size === 0) {
      this.passPending = true
      return
    }
    for (const request of this.passRequesters) request()
  }

  /** Called by the plugin once a layout has been computed. */
  publish(pageCount: number, lastPageFill = 0): void {
    // `measured` is part of the comparison, not just the payload: a one-page
    // document publishes the same count it started with, so comparing only the
    // numbers would take this early return on the very first pass and leave
    // the flag false forever.
    const unchanged =
      this.snapshot.measured &&
      pageCount === this.snapshot.pageCount &&
      lastPageFill === this.snapshot.lastPageFill
    if (unchanged) return

    this.snapshot = { ...this.snapshot, measured: true, pageCount, lastPageFill }
    this.emit()
  }

  /**
   * Wired up by the plugin view. Returns the teardown, so a destroyed editor
   * cannot leave the controller pointing at a dead view.
   */
  attach(requestPass: () => void): () => void {
    this.passRequesters.add(requestPass)
    // Anything that changed while nothing was listening still has to land.
    if (this.passPending) {
      this.passPending = false
      requestPass()
    }
    return () => {
      this.passRequesters.delete(requestPass)
    }
  }

  /* --- useSyncExternalStore surface --- */

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot(): PaginationSnapshot {
    return this.snapshot
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}

function geometryEquals(a: PageGeometry, b: PageGeometry): boolean {
  return (
    a.pageWidth === b.pageWidth &&
    a.pageHeight === b.pageHeight &&
    a.marginTop === b.marginTop &&
    a.marginRight === b.marginRight &&
    a.marginBottom === b.marginBottom &&
    a.marginLeft === b.marginLeft &&
    a.pageGap === b.pageGap
  )
}
