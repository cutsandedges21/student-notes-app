import { createPortal } from 'react-dom'
import type { AiMode } from '../types/ai'

interface SelectionToolbarProps {
  /** Viewport coordinates of the selection's top edge. */
  position: { top: number; left: number } | null
  onAction: (mode: AiMode) => void
}

const ACTIONS: { mode: AiMode; label: string }[] = [
  { mode: 'IMPROVE_NOTES', label: 'Improve' },
  { mode: 'EXPLAIN', label: 'Explain' },
  { mode: 'CHECK_NOTES', label: 'Check' },
  { mode: 'CHAT', label: 'Ask AI' },
]

/**
 * The one element in the app that appears without being asked for — and only
 * in direct response to the student deliberately selecting text.
 *
 * Text labels rather than icons: four unlabelled glyphs above a selection would
 * be a guessing game.
 */
export function SelectionToolbar({ position, onAction }: SelectionToolbarProps) {
  if (!position) return null

  return createPortal(
    <div
      style={{ top: position.top, left: position.left }}
      className="fixed z-40 flex -translate-x-1/2 -translate-y-full items-center gap-0.5 rounded-full border border-line bg-surface px-1 py-1 shadow-pill"
      // Keeps the document selection alive: a mousedown here would otherwise
      // blur the editor and collapse the very selection being acted on.
      onMouseDown={(event) => event.preventDefault()}
    >
      {ACTIONS.map((action) => (
        <button
          key={action.mode}
          type="button"
          onClick={() => onAction(action.mode)}
          className="rounded-full px-2.5 py-1 text-sm text-ink transition-colors hover:bg-surface-hover"
        >
          {action.label}
        </button>
      ))}
    </div>,
    document.body,
  )
}
