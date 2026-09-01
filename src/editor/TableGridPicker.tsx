import { useRef, useState, type KeyboardEvent } from 'react'
import { cn } from '../lib/cn'

/**
 * The Word/Docs size picker: a grid you sweep to choose dimensions.
 *
 * Sizing a table by dragging over a grid is the one interaction everybody
 * already knows, and it is faster than any dialog for the sizes people
 * actually pick. Larger tables are still reachable -- rows and columns can be
 * added from the same menu once the table exists -- so the grid is capped at a
 * size that stays readable rather than trying to cover every case.
 *
 * Implemented as the ARIA grid pattern rather than 100 tab stops: one roving
 * tabindex, arrows to move, Enter or Space to commit. Pointer users sweep and
 * click; the two paths set the same state, so the highlighted rectangle and
 * the readout are always what will be inserted.
 */

const MAX_ROWS = 10
const MAX_COLS = 10

export interface TableSize {
  rows: number
  cols: number
}

interface TableGridPickerProps {
  onSelect: (size: TableSize) => void
}

export function TableGridPicker({ onSelect }: TableGridPickerProps) {
  // 1-based, and never zero: there is always a highlighted rectangle, so
  // committing by keyboard without having moved still inserts something sane.
  const [size, setSize] = useState<TableSize>({ rows: 1, cols: 1 })
  const gridRef = useRef<HTMLDivElement>(null)

  const focusCell = (rows: number, cols: number) => {
    gridRef.current
      ?.querySelector<HTMLButtonElement>(`[data-cell="${rows}-${cols}"]`)
      ?.focus()
  }

  const move = (rowDelta: number, colDelta: number) => {
    const rows = clamp(size.rows + rowDelta, 1, MAX_ROWS)
    const cols = clamp(size.cols + colDelta, 1, MAX_COLS)
    setSize({ rows, cols })
    focusCell(rows, cols)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        move(1, 0)
        break
      case 'ArrowUp':
        move(-1, 0)
        break
      case 'ArrowRight':
        move(0, 1)
        break
      case 'ArrowLeft':
        move(0, -1)
        break
      case 'Home':
        setSize({ rows: 1, cols: 1 })
        focusCell(1, 1)
        break
      case 'End':
        setSize({ rows: MAX_ROWS, cols: MAX_COLS })
        focusCell(MAX_ROWS, MAX_COLS)
        break
      default:
        return
    }
    // Only for keys handled above: Enter and Space must reach the button, and
    // Escape must reach the popover that owns dismissal.
    event.preventDefault()
  }

  return (
    <div className="px-3 pb-2 pt-1">
      <div
        ref={gridRef}
        role="grid"
        aria-label="Table size"
        onKeyDown={handleKeyDown}
        className="grid w-max gap-[2px]"
        style={{ gridTemplateColumns: `repeat(${MAX_COLS}, 16px)` }}
      >
        {Array.from({ length: MAX_ROWS }, (_, rowIndex) =>
          Array.from({ length: MAX_COLS }, (_, colIndex) => {
            const rows = rowIndex + 1
            const cols = colIndex + 1
            const selected = rows <= size.rows && cols <= size.cols
            const isCursor = rows === size.rows && cols === size.cols

            return (
              <button
                key={`${rows}-${cols}`}
                type="button"
                role="gridcell"
                data-cell={`${rows}-${cols}`}
                // One tab stop for the whole grid, per the grid pattern.
                tabIndex={isCursor ? 0 : -1}
                aria-label={`${rows} ${rows === 1 ? 'row' : 'rows'} by ${cols} ${cols === 1 ? 'column' : 'columns'}`}
                aria-selected={selected}
                onMouseEnter={() => setSize({ rows, cols })}
                onFocus={() => setSize({ rows, cols })}
                onClick={() => onSelect({ rows, cols })}
                className={cn(
                  'h-4 w-4 rounded-[2px] border transition-colors',
                  selected
                    ? 'border-docs-active-icon bg-docs-active'
                    : 'border-docs-outline bg-surface hover:bg-docs-hover',
                )}
              />
            )
          }),
        )}
      </div>

      {/*
        Polite rather than assertive: the size changes on every cell crossed
        while sweeping, and an assertive region would interrupt the screen
        reader continuously on the way to the intended size.
      */}
      <p
        aria-live="polite"
        className="pt-2 text-center font-ui text-sm text-docs-text"
      >
        {size.rows} × {size.cols}
      </p>
    </div>
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
