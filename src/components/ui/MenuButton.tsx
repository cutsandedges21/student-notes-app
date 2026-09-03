import { useEffect, useRef, useState } from 'react'
import { MoreVertical } from 'lucide-react'
import { cn } from '../../lib/cn'

export interface MenuItem {
  label: string
  onSelect: () => void
  destructive?: boolean
  /**
   * Genuinely disabled, not merely styled as such.
   *
   * An item that is visible while an action it depends on is still running has
   * to refuse the click as well as look like it will -- a menu that closes and
   * does nothing reads as a broken app rather than a busy one.
   */
  disabled?: boolean
  /** A rule above, for separating an ordinary action from a destructive one. */
  separatorBefore?: boolean
}

interface MenuButtonProps {
  label: string
  items: MenuItem[]
}

export function MenuButton({ label, items }: MenuButtonProps) {
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
    <div ref={containerRef} className="relative">
      <button
        type="button"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="grid h-8 w-8 place-items-center rounded text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
      >
        <MoreVertical size={16} strokeWidth={2} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-10 mt-1 min-w-[160px] rounded border border-line bg-surface py-1 shadow-sheet"
        >
          {items.map((item) => (
            <div key={item.label}>
              {item.separatorBefore && <div className="my-1 h-px bg-line" />}
              <button
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false)
                  item.onSelect()
                }}
                className={cn(
                  'block w-full px-3 py-1.5 text-left text-sm transition-colors',
                  'enabled:hover:bg-surface-hover',
                  'disabled:cursor-not-allowed disabled:text-ink-faint',
                  item.destructive ? 'text-danger' : 'text-ink',
                )}
              >
                {item.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
