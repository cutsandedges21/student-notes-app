import type { ReactNode } from 'react'
import { AI_SIDEBAR_SIDE } from '../constants/layout'
import { cn } from '../lib/cn'

interface AiDrawerProps {
  open: boolean
  onClose: () => void
  /**
   * Renders the drawer at every width, not just below `lg`.
   *
   * Full screen hides the docked panel, so without this the assistant would
   * have no surface at all on a desktop -- the bubble would toggle state that
   * nothing displays.
   */
  alwaysOverlay?: boolean
  children: ReactNode
}

export function AiDrawer({ open, onClose, alwaysOverlay = false, children }: AiDrawerProps) {
  return (
    <div
      className={cn(
        'fixed inset-0 z-40',
        !alwaysOverlay && 'lg:hidden',
        open ? 'pointer-events-auto' : 'pointer-events-none',
      )}
      aria-hidden={!open}
    >
      <button
        type="button"
        tabIndex={open ? 0 : -1}
        aria-label="Close AI assistant"
        onClick={onClose}
        className={cn(
          'absolute inset-0 bg-ink/20 transition-opacity',
          open ? 'opacity-100' : 'opacity-0',
        )}
      />
      <aside
        aria-label="AI assistant"
        className={cn(
          'absolute inset-y-0 flex w-[min(var(--ai-panel-w),85vw)] flex-col bg-surface shadow-sheet transition-transform',
          AI_SIDEBAR_SIDE === 'left'
            ? ['left-0 border-r border-line', open ? 'translate-x-0' : '-translate-x-full']
            : ['right-0 border-l border-line', open ? 'translate-x-0' : 'translate-x-full'],
        )}
      >
        {children}
      </aside>
    </div>
  )
}
