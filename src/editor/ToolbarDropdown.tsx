import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '../lib/cn'

interface ToolbarDropdownProps {
  /** Accessible name, also used as the tooltip. */
  label: string
  /** What shows on the closed trigger — e.g. the current font name. */
  trigger: ReactNode
  /** Fixed trigger width, so choosing a longer value doesn't shift the toolbar. */
  width?: number
  children: (close: () => void) => ReactNode
}

/**
 * Popover used by the formatting toolbar.
 *
 * Shares the dismissal contract with MenuButton (outside mousedown + Escape)
 * so every transient surface in the app closes the same way. The panel is
 * rendered only while open, which keeps the toolbar's roving-tabindex sweep
 * from picking up hidden controls.
 */
export function ToolbarDropdown({
  label,
  trigger,
  width,
  children,
}: ToolbarDropdownProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        title={label}
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        style={width ? { width } : undefined}
        className={cn(
          'flex h-7 items-center justify-between gap-1 rounded px-2 text-sm',
          'text-ink transition-colors hover:bg-surface-hover',
          open && 'bg-surface-hover',
        )}
      >
        <span className="truncate">{trigger}</span>
        <ChevronDown size={14} className="shrink-0 text-ink-faint" />
      </button>

      {open && (
        <div className="absolute left-0 z-20 mt-1 min-w-[180px] rounded border border-line bg-surface py-1 shadow-sheet">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

interface DropdownItemProps {
  active?: boolean
  onSelect: () => void
  children: ReactNode
  style?: React.CSSProperties
}

export function DropdownItem({ active, onSelect, children, style }: DropdownItemProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      style={style}
      className={cn(
        'block w-full px-3 py-1.5 text-left text-sm transition-colors hover:bg-surface-hover',
        active ? 'bg-accent-subtle text-accent' : 'text-ink',
      )}
    >
      {children}
    </button>
  )
}
