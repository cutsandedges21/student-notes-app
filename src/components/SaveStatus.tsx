export type SaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'error'

const LABELS: Record<SaveState, string> = {
  idle: '',
  saving: 'Saving…',
  saved: 'Saved',
  offline: 'Offline',
  error: "Couldn't save",
}

export function SaveStatus({ state }: { state: SaveState }) {
  return (
    <span
      // Announced to screen readers when it changes, without stealing focus.
      role="status"
      aria-live="polite"
      className="text-sm text-ink-faint"
    >
      {LABELS[state]}
    </span>
  )
}
