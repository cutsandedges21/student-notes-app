import { US_LETTER, type PageGeometry } from './geometry'
import { DEFAULT_LIMITS, type PaginationLimits } from './types'

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
}

/** What React renders from: page backdrops, page numbers, stack height. */
export interface PaginationSnapshot {
  pageCount: number
  geometry: PageGeometry
  enabled: boolean
}

type Listener = () => void

export class PaginationController implements PaginationSettings {
  geometry: PageGeometry = US_LETTER
  scale = 1
  enabled = true
  limits: PaginationLimits = DEFAULT_LIMITS
  pageBreakName = 'pageBreak'

  private snapshot: PaginationSnapshot = {
    pageCount: 1,
    geometry: this.geometry,
    enabled: this.enabled,
  }

  private readonly listeners = new Set<Listener>()
  private requestPass: (() => void) | null = null

  constructor(settings: Partial<PaginationSettings> = {}) {
    Object.assign(this, settings)
    this.snapshot = { pageCount: 1, geometry: this.geometry, enabled: this.enabled }
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

    if (visibleChange) {
      this.snapshot = {
        pageCount: this.snapshot.pageCount,
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

  /** Ask the plugin for a pass. No-op before an editor is attached. */
  invalidate(): void {
    this.requestPass?.()
  }

  /** Called by the plugin once a layout has been computed. */
  publish(pageCount: number): void {
    if (pageCount === this.snapshot.pageCount) return
    this.snapshot = { ...this.snapshot, pageCount }
    this.emit()
  }

  /**
   * Wired up by the plugin view. Returns the teardown, so a destroyed editor
   * cannot leave the controller pointing at a dead view.
   */
  attach(requestPass: () => void): () => void {
    this.requestPass = requestPass
    return () => {
      if (this.requestPass === requestPass) this.requestPass = null
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
