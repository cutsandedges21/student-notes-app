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
  showPageNumbers?: boolean
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
  showPageNumbers = true,
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
    controller.configure({ geometry, scale })
  }, [controller, geometry, scale])

  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const pageCount = Math.max(1, snapshot.pageCount)
  const pages = Array.from({ length: pageCount }, (_, index) => index)

  return (
    <div ref={frameRef} className="doc-frame">
      <div
        className="doc-stack"
        style={{
          width: geometry.pageWidth,
          minHeight: stackHeight(geometry, pageCount),
          zoom: scale,
        }}
      >
        <div className="doc-pages" aria-hidden="true">
          {pages.map((index) => (
            <div
              key={index}
              className="doc-page"
              style={{ top: pageTop(geometry, index), height: geometry.pageHeight }}
            />
          ))}
        </div>

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
        </div>

        {/*
          Decorative: the document itself is one continuous run of text, and a
          screen reader announcing "1", "2", "3" between paragraphs would be
          reading the paper rather than the note.
        */}
        {/*
          Header and footer sit in the margin bands, outside the printable
          area, so they never collide with the text the writer is editing.
        */}
        {renderHeader &&
          pages.map((index) => (
            <div
              key={`header-${index}`}
              className="doc-furniture"
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

        {showPageNumbers &&
          pageCount > 1 &&
          pages.map((index) => (
            <div
              key={index}
              aria-hidden="true"
              className="doc-page-number"
              style={{
                top: pageTop(geometry, index) + geometry.pageHeight - geometry.marginBottom / 2,
              }}
            >
              {index + 1}
            </div>
          ))}
      </div>
    </div>
  )
}
