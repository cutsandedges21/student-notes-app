import {
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react'
import type { PaginationController } from './pagination/controller'
import { pageTop, printableHeight, stackHeight, type PageGeometry } from './pagination/geometry'
import type { PageNumberPosition } from './pagination/types'

/**
 * The paper the editor is drawn on.
 *
 * Page shapes are backdrops painted behind a single continuous editable
 * element rather than containers holding slices of it -- see the comment at
 * the top of `pagination/paginationPlugin.ts` for why the split has to be
 * drawn rather than performed. Their positions come straight from the geometry
 * (`index * stride`), which is the same arithmetic the layout algorithm uses
 * for its targets, so a spacer and the page it lands on can never disagree.
 */

interface PaginatedSheetProps {
  controller: PaginationController
  geometry: PageGeometry
  /** The writer's zoom from the toolbar. 1 = 100%. */
  zoom: number
  /** Where the page number sits in the footer band, or `off`. */
  pageNumbers?: PageNumberPosition
  /**
   * Page furniture, drawn into each page's margin bands.
   *
   * Called per page so the first can host the live editor while the rest show
   * a static copy: one editable element cannot be in several places at once,
   * and N editor instances for what is usually one line of text would be waste.
   */
  renderHeader?: (pageIndex: number) => ReactNode
  renderFooter?: (pageIndex: number) => ReactNode
  /** The editor itself. */
  children: ReactNode
}

/**
 * The page is never auto-shrunk past this, so a narrow window scrolls
 * sideways instead of rendering text nobody can read. iPad portrait (768px,
 * the smallest screen this app targets) fits at 0.94, well clear of it.
 */
const MIN_FIT_SCALE = 0.5

export function PaginatedSheet({
  controller,
  geometry,
  zoom,
  pageNumbers = 'off',
  renderHeader,
  renderFooter,
  children,
}: PaginatedSheetProps) {
  const frameRef = useRef<HTMLDivElement>(null)
  const [availableWidth, setAvailableWidth] = useState(0)

  useLayoutEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    if (typeof ResizeObserver !== 'function') {
      setAvailableWidth(frame.clientWidth)
      return
    }

    const observer = new ResizeObserver((entries) => {
      setAvailableWidth(entries[0]?.contentRect.width ?? 0)
    })
    observer.observe(frame)
    return () => observer.disconnect()
  }, [])

  /*
   * Zoom stays the writer's control: asking for 150% gives 150% and a
   * horizontal scrollbar. The fit is only ever applied downwards, to stop a
   * full-width page overflowing a column it cannot fit in.
   */
  const fitScale = availableWidth
    ? Math.max(MIN_FIT_SCALE, Math.min(1, availableWidth / geometry.pageWidth))
    : 1
  const scale = zoom > 1 ? zoom : Math.min(zoom, fitScale)

  // Layout effect rather than a plain one: the engine reads this scale to
  // convert client rects back to CSS pixels, so it has to be right before the
  // browser can paint a frame the plugin might measure.
  useLayoutEffect(() => {
    controller.configure({ geometry, scale, pageNumbers })
  }, [controller, geometry, scale, pageNumbers])

  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const pageCount = Math.max(1, snapshot.pageCount)
  const pages = Array.from({ length: pageCount }, (_, index) => index)

  /*
   * Discrete sheets are only drawn once the count behind them is real.
   *
   * Until the engine has measured, the count is 1 while the text may already
   * be several pages long, so drawing page shapes would put one sheet of
   * paper under all of it and leave the rest of the note sitting on the grey
   * backdrop. In that window -- and whenever pagination is off, where there
   * are no page boundaries to draw at all -- the stack itself is the paper:
   * one continuous sheet that always covers exactly as much as there is text.
   */
  const paginated = snapshot.measured && snapshot.enabled

  return (
    <div ref={frameRef} className="doc-frame">
      <div
        className="doc-stack"
        data-continuous={paginated ? undefined : ''}
        style={
          {
            width: geometry.pageWidth,
            minHeight: stackHeight(geometry, pageCount),
            zoom: scale,
            // Printing reads these back: the paper has to be the same width as
            // the page on screen, or the text rewraps and the printed copy
            // breaks in different places than the one being edited.
            '--doc-page-w': `${geometry.pageWidth}px`,
            '--doc-print-inset': `${geometry.marginLeft}px`,
          } as CSSProperties
        }
      >
        {paginated && (
          <div className="doc-pages" aria-hidden="true">
            {pages.map((index) => (
              <div
                key={index}
                className="doc-page"
                style={{ top: pageTop(geometry, index), height: geometry.pageHeight }}
              />
            ))}
          </div>
        )}

        <div
          className="doc-content"
          style={
            {
              paddingTop: geometry.marginTop,
              paddingRight: geometry.marginRight,
              paddingBottom: geometry.marginBottom,
              paddingLeft: geometry.marginLeft,
              // Caps an oversized image at one page, so it is scaled to fit
              // rather than bleeding across a page boundary.
              '--doc-printable-h': `${printableHeight(geometry)}px`,
            } as CSSProperties
          }
        >
          {children}

          {/*
            The last page has no spacer to hang a printed number on, so it gets
            this instead: a filler as tall as the room left on the page, with
            the number below it. Print-only -- on screen the footer band draws
            it, like every other page.
          */}
          {pageNumbers !== 'off' && (
            <div
              className="doc-print-tail"
              aria-hidden="true"
              style={
                {
                  '--doc-print-fill': `${Math.max(0, snapshot.lastPageFill - 1)}px`,
                } as CSSProperties
              }
            >
              <div className="doc-print-page-number" data-align={pageNumbers}>
                {pageCount}
              </div>
            </div>
          )}
        </div>

        {/*
          Header and footer sit in the margin bands, outside the printable
          area, so they never collide with the text the writer is editing.
        */}
        {renderHeader &&
          pages.map((index) => (
            <div
              key={`header-${index}`}
              // Printing keeps only page 0's copy and repeats it itself, so
              // the page index has to be visible to CSS.
              data-page={index}
              className="doc-furniture doc-furniture--header"
              style={{
                top: pageTop(geometry, index),
                height: geometry.marginTop,
                paddingLeft: geometry.marginLeft,
                paddingRight: geometry.marginRight,
              }}
            >
              {renderHeader(index)}
            </div>
          ))}

        {renderFooter &&
          pages.map((index) => (
            <div
              key={`footer-${index}`}
              data-page={index}
              className="doc-furniture doc-furniture--footer"
              style={{
                top: pageTop(geometry, index) + geometry.pageHeight - geometry.marginBottom,
                height: geometry.marginBottom,
                paddingLeft: geometry.marginLeft,
                paddingRight: geometry.marginRight,
              }}
            >
              {renderFooter(index)}
            </div>
          ))}

      </div>
    </div>
  )
}
