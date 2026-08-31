/**
 * `failed` is not a louder `error`.
 *
 * `error` means a save attempt went wrong and the next one will probably work
 * -- a dropped request, a transient server fault. `failed` means the browser
 * refused to store the note at all: retrying changes nothing until the user
 * does something about it, and until they do, the note exists only in this
 * tab. That difference is worth a distinct state, because the copy and the
 * urgency are different.
 */
export type SaveState =
  | 'idle'
  | 'saving'
  | 'saved'
  | 'offline'
  | 'error'
  | 'failed'
  /** A newer version exists and the writer has not yet chosen between them. */
  | 'conflict'

const LABELS: Record<SaveState, string> = {
  idle: '',
  saving: 'Saving…',
  saved: 'Saved',
  offline: 'Offline',
  error: "Couldn't save",
  failed: 'Not saved',
  conflict: 'Changed elsewhere',
}

export function SaveStatus({
  state,
  /** What went wrong, in the user's terms. Shown on hover and to assistive tech. */
  message,
  /** Rendered as a Retry button when supplied and the save failed. */
  onRetry,
}: {
  state: SaveState
  message?: string
  onRetry?: () => void
}) {
  if (state === 'failed') {
    return (
      <span className="flex min-w-0 items-center gap-2">
        <span
          // `assertive`: this one interrupts. Everything else here is a
          // status update; this is the user being told their work is at risk.
          role="alert"
          aria-live="assertive"
          title={message}
          className="truncate text-sm font-medium text-red-600"
        >
          {LABELS.failed}
          {message ? <span className="sr-only"> — {message}</span> : null}
        </span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="shrink-0 rounded border border-red-600 px-2 py-0.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
          >
            Retry
          </button>
        )}
      </span>
    )
  }

  return (
    <span
      // Announced to screen readers when it changes, without stealing focus.
      role="status"
      aria-live="polite"
      title={state === 'error' ? message : undefined}
      className="text-sm text-ink-faint"
    >
      {LABELS[state]}
    </span>
  )
}
