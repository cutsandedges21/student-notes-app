import { useEffect, useRef, useState } from 'react'

/**
 * Google Docs-style ruler with draggable left and right margin markers.
 *
 * Width is expressed in the same 816px page unit the document sheet uses, so
 * marker positions map 1:1 onto the page rather than needing a scale factor.
 * Zoom multiplies both, which keeps the ruler lined up with the page beneath
 * it at every zoom level.
 */

const PAGE_WIDTH = 816
const INCH = 96
const MIN_CONTENT_WIDTH = 200
/** Docs subdivides each inch into eighths. */
const TICKS_PER_INCH = 8

interface RulerProps {
  leftMargin: number
  rightMargin: number
  onChange: (margins: { left: number; right: number }) => void
  /** 1 = 100%, matching the toolbar's zoom readout. */
  zoom?: number
}

export function Ruler({ leftMargin, rightMargin, onChange, zoom = 1 }: RulerProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<'left' | 'right' | null>(null)

  useEffect(() => {
    if (!dragging) return

    function handleMove(event: MouseEvent) {
      const track = trackRef.current
      if (!track) return

      const bounds = track.getBoundingClientRect()
      // Positions are stored unzoomed, so the pointer offset is divided back
      // out before it becomes a margin.
      const x = Math.max(0, Math.min(PAGE_WIDTH, (event.clientX - bounds.left) / zoom))

      if (dragging === 'left') {
        const max = PAGE_WIDTH - rightMargin - MIN_CONTENT_WIDTH
        onChange({ left: Math.min(x, max), right: rightMargin })
      } else {
        const fromRight = PAGE_WIDTH - x
        const max = PAGE_WIDTH - leftMargin - MIN_CONTENT_WIDTH
        onChange({ left: leftMargin, right: Math.min(fromRight, max) })
      }
    }

    function handleUp() {
      setDragging(null)
    }

    // Listeners live on the document so the drag survives the pointer leaving
    // the marker, which is what makes the drag feel continuous.
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
    return () => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
    }
  }, [dragging, leftMargin, rightMargin, onChange, zoom])

  const nudge = (side: 'left' | 'right', delta: number) => {
    if (side === 'left') {
      const max = PAGE_WIDTH - rightMargin - MIN_CONTENT_WIDTH
      onChange({ left: Math.max(0, Math.min(leftMargin + delta, max)), right: rightMargin })
    } else {
      const max = PAGE_WIDTH - leftMargin - MIN_CONTENT_WIDTH
      onChange({ left: leftMargin, right: Math.max(0, Math.min(rightMargin + delta, max)) })
    }
  }

  const marker = (side: 'left' | 'right') => {
    const offset = (side === 'left' ? leftMargin : rightMargin) * zoom
    const value = side === 'left' ? leftMargin : rightMargin
    const max = PAGE_WIDTH - (side === 'left' ? rightMargin : leftMargin) - MIN_CONTENT_WIDTH

    return (
      <div
        role="slider"
        tabIndex={0}
        aria-label={`${side === 'left' ? 'Left' : 'Right'} margin`}
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={Math.round(max)}
        onMouseDown={() => setDragging(side)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault()
            nudge(side, side === 'left' ? -8 : 8)
          }
          if (event.key === 'ArrowRight') {
            event.preventDefault()
            nudge(side, side === 'left' ? 8 : -8)
          }
        }}
        style={{ [side]: offset }}
        className="absolute top-0 z-10 -ml-[7px] -mr-[7px] flex h-full w-[14px] cursor-col-resize flex-col items-center"
      >
        {/* Downward triangle over a bar on the left, triangle alone on the
            right -- the shapes Docs uses for the two ends. */}
        <div className="h-0 w-0 border-x-[6px] border-t-[7px] border-x-transparent border-t-docs-marker" />
        {side === 'left' && (
          <div className="mt-[2px] h-[4px] w-[11px] rounded-[1px] bg-docs-marker" />
        )}
      </div>
    )
  }

  const width = PAGE_WIDTH * zoom

  /*
   * The scale is anchored at the left margin rather than at the page edge:
   * Docs counts inches out from where the text starts, and the whole scale
   * slides when you drag that marker. It keeps counting past both margins, so
   * the ticks run to the ends of the page in either direction.
   */
  const step = INCH / TICKS_PER_INCH
  const ticks: number[] = []
  for (
    let index = Math.ceil(-leftMargin / step);
    index <= Math.floor((PAGE_WIDTH - leftMargin) / step);
    index += 1
  ) {
    ticks.push(index)
  }

  return (
    <div className="hidden justify-center bg-surface py-1 lg:flex">
      <div
        ref={trackRef}
        style={{ width }}
        className="relative h-[22px] select-none"
      >
        {/* Margins read as shaded; the writable width stays paper-white. */}
        <div className="absolute inset-y-[5px] inset-x-0 rounded-sm bg-docs-ruler" />
        <div
          style={{ left: leftMargin * zoom, right: rightMargin * zoom }}
          className="absolute inset-y-[5px] bg-surface"
        />

        {ticks.map((index) => {
          const left = (leftMargin + index * step) * zoom
          const inches = index / TICKS_PER_INCH

          if (!Number.isInteger(inches)) {
            return (
              <span
                key={index}
                style={{ left }}
                className="absolute top-1/2 h-[3px] w-px -translate-y-1/2 bg-docs-tick"
              />
            )
          }
          // The origin itself carries no label -- it is marked by the margin.
          if (inches === 0) return null

          return (
            <span
              key={index}
              style={{ left }}
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 font-ui text-[10px] leading-none text-docs-tick-text"
            >
              {Math.abs(inches)}
            </span>
          )
        })}

        {marker('left')}
        {marker('right')}
      </div>
    </div>
  )
}
