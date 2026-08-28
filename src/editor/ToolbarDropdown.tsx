import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { cn } from '../lib/cn'

interface ToolbarDropdownProps {
  /** Accessible name, also used as the tooltip. */
  label: string
  /** What shows on the closed trigger — e.g. the current font name. */
  trigger: ReactNode
  /** Fixed trigger width, so choosing a longer value doesn't shift the toolbar. */
  width?: number
  /** Set when the control's value is applied to the selection. */
  active?: boolean
  /**
   * Renders as a bare chevron. Used for the half of a split control that only
   * opens the menu, where the icon lives in the button beside it.
   */
  chevronOnly?: boolean
  children: (close: () => void) => ReactNode
}

const VIEWPORT_MARGIN = 8

/**
 * Popover used by the formatting toolbar.
 *
 * The panel is rendered through a portal with fixed positioning rather than as
 * an absolutely-positioned child. The toolbar scrolls horizontally, and
 * `overflow-x: auto` forces `overflow-y` to compute to `auto` as well — which
 * clips any descendant that escapes the toolbar's box. Positioned inline, the
 * menu was invisible.
 *
 * Shares the dismissal contract with MenuButton (outside mousedown + Escape)
 * so every transient surface in the app closes the same way.
 */
export function ToolbarDropdown({
  label,
  trigger,
  width,
  active,
  chevronOnly,
  children,
}: ToolbarDropdownProps) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Measured before paint so the panel never appears at the wrong spot first.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return

    const rect = triggerRef.current.getBoundingClientRect()
    const panelWidth = panelRef.current?.offsetWidth ?? 224
    const maxLeft = window.innerWidth - panelWidth - VIEWPORT_MARGIN

    setPosition({
      top: rect.bottom + 4,
      left: Math.max(VIEWPORT_MARGIN, Math.min(rect.left, maxLeft)),
    })
  }, [open])

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (triggerRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      setOpen(false)
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    // A fixed panel would drift away from its trigger when the page scrolls,
    // so close instead of continuously repositioning. Scrolling *inside* the
    // panel must be ignored: the font list is scrollable, and closing on its
    // own scroll would make the list impossible to browse. The listener is
    // capturing (scroll doesn't bubble), hence the explicit containment check.
    function handleScroll(event: Event) {
      if (panelRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    function handleResize() {
      setOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', handleResize)
    window.addEventListener('scroll', handleScroll, true)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        title={label}
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        style={width ? { width } : undefined}
        className={cn(
          'flex h-7 shrink-0 items-center rounded-full font-ui text-sm',
          width ? 'justify-between gap-1 px-2' : 'justify-center',
          !width && (chevronOnly ? 'w-[18px]' : 'gap-1 px-1'),
          'transition-colors hover:bg-docs-hover',
          active ? 'bg-docs-active text-docs-active-icon' : 'text-docs-text',
          open && 'bg-docs-hover',
        )}
      >
        <span className="flex min-w-0 items-center truncate">{trigger}</span>
        <ChevronDown size={14} className="shrink-0 text-docs-icon" />
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              top: position?.top ?? -9999,
              left: position?.left ?? -9999,
              // Hidden until measured, so it never flashes in the wrong place.
              visibility: position ? 'visible' : 'hidden',
            }}
            className="fixed z-50 min-w-[180px] rounded-lg border border-line bg-surface py-2 shadow-menu"
          >
            {children(() => setOpen(false))}
          </div>,
          document.body,
        )}
    </>
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
        'block w-full px-4 py-1.5 text-left font-ui text-sm transition-colors',
        'hover:bg-docs-chrome-hover',
        active ? 'bg-docs-active text-docs-active-icon' : 'text-docs-text',
      )}
    >
      {children}
    </button>
  )
}
