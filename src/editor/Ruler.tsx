import { useEffect, useRef, useState } from 'react'

/**
 * Google Docs-style ruler with draggable left and right margin markers.
 *
 * Width is expressed in the same 816px page unit the document sheet uses, so
 * marker positions map 1:1 onto the page rather than needing a scale factor.
 */

const PAGE_WIDTH = 816
const MIN_CONTENT_WIDTH = 200
/** One tick per inch at 96dpi across an 8.5in page. */
const TICKS = Array.from({ length: 17 }, (_, i) => i)

interface RulerProps {
  leftMargin: number
  rightMargin: number
  onChange: (margins: { left: number; right: number }) => void
}

export function Ruler({ leftMargin, rightMargin, onChange }: RulerProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<'left' | 'right' | null>(null)

  useEffect(() => {
    if (!dragging) return

    function handleMove(event: MouseEvent) {
      const track = trackRef.current
      if (!track) return

      const bounds = track.getBoundingClientRect()
      const x = Math.max(0, Math.min(PAGE_WIDTH, event.clientX - bounds.left))

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
  }, [dragging, leftMargin, rightMargin, onChange])

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
    const offset = side === 'left' ? leftMargin : rightMargin
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
        className="absolute top-0 z-10 -ml-1.5 h-full w-3 cursor-col-resize"
      >
        <div className="mx-auto mt-1 h-0 w-0 border-x-[6px] border-t-[7px] border-x-transparent border-t-ink-faint" />
      </div>
    )
  }

  return (
    <div className="hidden justify-center border-b border-line bg-surface py-1 lg:flex">
      <div
        ref={trackRef}
        style={{ width: PAGE_WIDTH }}
        className="relative h-5 select-none"
      >
        {/* The writable region between the markers. */}
        <div
          style={{ left: leftMargin, right: rightMargin }}
          className="absolute inset-y-1.5 rounded-sm bg-surface-hover"
        />

        <div className="absolute inset-x-0 top-1.5 flex">
          {TICKS.map((tick) => (
            <div key={tick} className="relative flex-1">
              <div
                className={
                  tick % 2 === 0
                    ? 'absolute left-0 h-2 w-px bg-ink-faint'
                    : 'absolute left-0 h-1 w-px bg-line-strong'
                }
              />
            </div>
          ))}
        </div>

        {marker('left')}
        {marker('right')}
      </div>
    </div>
  )
}
