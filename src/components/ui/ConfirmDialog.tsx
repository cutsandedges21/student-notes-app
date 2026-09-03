import { useEffect, useRef } from 'react'
import { Button } from './Button'
import { cn } from '../../lib/cn'

/**
 * Asks before doing something that cannot be taken back.
 *
 * Replaces `window.confirm`, which the app used for deleting notes and
 * classes. The native dialog is not a styling problem so much as a behaviour
 * one: it blocks the main thread, so a pending autosave cannot complete while
 * it is up; it cannot say which note is about to go beyond what fits in one
 * line; some browsers let a user suppress it permanently, after which
 * destructive actions happen with no prompt at all; and it is unstyleable, so
 * "delete" and "cancel" look identical.
 *
 * Built on `<dialog showModal()>` rather than a div, which brings the focus
 * trap, the inert background, Escape-to-close and focus restoration from the
 * platform instead of from a hand-written effect that gets one of them wrong.
 */
export function ConfirmDialog({
  open,
  title,
  /** What will happen, in the user's terms. Name the thing being acted on. */
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  /** Red button and an assertive role, for anything irreversible. */
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (open && !node.open) {
      node.showModal()
      // Focus starts on Cancel, not Confirm. Enter is the most likely reflex
      // on a dialog that appeared unexpectedly, and on a destructive action
      // the safe answer should be the one it lands on.
      cancelRef.current?.focus()
    }
    if (!open && node.open) node.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      // Fires for Escape as well as close(), so both routes out are a cancel.
      onClose={onCancel}
      onClick={(event) => {
        if (event.target === ref.current) onCancel()
      }}
      aria-labelledby="confirm-title"
      aria-describedby="confirm-message"
      className="w-full max-w-md rounded-lg border border-line bg-surface p-0 shadow-sheet backdrop:bg-ink/30"
    >
      <div className="p-6">
        <h2 id="confirm-title" className="text-lg font-medium text-ink">
          {title}
        </h2>
        <p id="confirm-message" className="mt-2 text-sm text-ink-muted">
          {message}
        </p>

        <div className="mt-6 flex justify-end gap-2">
          <Button ref={cancelRef} onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={onConfirm}
            className={cn(
              /* `text-danger-on` overrides the primary variant's own label
                 colour, which is tuned for the accent fill this replaces. */
              destructive &&
                'bg-danger text-danger-on hover:bg-danger-strong disabled:bg-danger/50',
            )}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  )
}
