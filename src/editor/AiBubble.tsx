import { createPortal } from 'react-dom'
import { SparkIcon } from './DocsIcons'
import { cn } from '../lib/cn'

interface AiBubbleProps {
  open: boolean
  onClick: () => void
}

/**
 * The AI assistant's only entry point in full screen.
 *
 * Full screen removes every bar, so the docked panel goes with them. A single
 * floating control keeps the assistant reachable without putting a strip of
 * chrome back on screen -- which would defeat the point of the mode.
 *
 * Portalled to the body so it cannot be clipped by the scroll container it
 * visually sits over.
 */
export function AiBubble({ open, onClick }: AiBubbleProps) {
  return createPortal(
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      title="AI assistant (Ctrl+Shift+A)"
      aria-label="AI assistant"
      className={cn(
        'fixed bottom-6 left-6 z-50 grid h-12 w-12 place-items-center rounded-full',
        'border border-line bg-surface text-docs-icon shadow-pill transition-colors',
        'hover:bg-docs-chrome-hover',
        open && 'bg-docs-chrome-hover',
      )}
    >
      <SparkIcon size={22} />
    </button>,
    document.body,
  )
}
