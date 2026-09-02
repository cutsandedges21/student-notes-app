import { createPortal } from 'react-dom'
import { MessageSquarePlus } from 'lucide-react'
import type { AiMode } from '../types/ai'

interface SelectionToolbarProps {
  /** Viewport coordinates of the selection's top edge. */
  position: { top: number; left: number } | null
  onAction: (mode: AiMode) => void
  /**
   * Starts a comment on the selection.
   *
   * Absent where commenting is impossible -- a shared note opened by a
   * signed-out visitor -- in which case the button is not rendered.
   */
  onComment?: () => void
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
 *
 * Comment sits here because this is the moment commenting becomes possible at
 * all -- a thread has to anchor to a selection, so the bar that appears on
 * selection is the only place the action is always available. It was reachable
 * only from one icon among thirty in the formatting toolbar, which is a poor
 * place to discover a feature you have to already know exists.
 *
 * It is set apart from the four AI actions by a divider and its own styling.
 * Commenting is a thing the student does; the others are things the model
 * does, and grouping them would suggest the comment was going to be answered.
 */
export function SelectionToolbar({ position, onAction, onComment }: SelectionToolbarProps) {
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

      {onComment && (
        <>
          <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-line" />
          <button
            type="button"
            onClick={onComment}
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium text-ink transition-colors hover:bg-surface-hover"
          >
            <MessageSquarePlus size={15} strokeWidth={1.8} />
            Comment
          </button>
        </>
      )}
    </div>,
    document.body,
  )
}
