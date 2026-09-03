import { useState } from 'react'
import { ThumbsDown, ThumbsUp } from 'lucide-react'
import { Button } from '../components/ui/Button'
import type { FeedbackRating } from '../services/aiFeedback'

/**
 * Rating an answer.
 *
 * A thumbs-down asks why, and a thumbs-up does not. That asymmetry is the
 * whole design: "good" carries everything it needs, and "bad" carries nothing
 * without the reason. Asking after the rating rather than before means one
 * click is a complete action and the box is optional.
 *
 * What it says afterwards is "Noted", not "thanks, this helps improve the
 * assistant". Nothing here feeds back into the model. Somebody reads the rows
 * and writes an eval case, and the loop only closes if they do -- so the
 * wording promises a record, which is what actually happens.
 */

export function AnswerFeedback({
  onRate,
  disabled = false,
}: {
  onRate: (rating: FeedbackRating, note?: string) => Promise<void>
  /** True where there is nobody to attach a rating to. */
  disabled?: boolean
}) {
  const [given, setGiven] = useState<FeedbackRating | null>(null)
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (disabled) return null

  async function rate(rating: FeedbackRating, text?: string) {
    setBusy(true)
    setError(null)
    try {
      await onRate(rating, text)
      setGiven(rating)
      // Only a thumbs-down has anything more to say.
      setAsking(rating === 'down' && text === undefined)
    } catch (caught) {
      console.error('[AnswerFeedback] could not record feedback:', caught)
      // Said rather than swallowed: being thanked for a report that never
      // saved is worse than not being offered the button.
      setError('That could not be sent.')
    } finally {
      setBusy(false)
    }
  }

  if (given && !asking) {
    return (
      <p className="mt-2 text-xs text-ink-faint">
        {error ?? 'Noted.'}
      </p>
    )
  }

  if (asking) {
    return (
      <form
        className="mt-2"
        onSubmit={(event) => {
          event.preventDefault()
          void rate('down', note)
        }}
      >
        <label htmlFor="feedback-note" className="text-xs text-ink-muted">
          What was wrong with it? (optional)
        </label>
        <textarea
          id="feedback-note"
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          className="mt-1 w-full rounded border border-line bg-surface px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
        />
        <div className="mt-1.5 flex gap-2">
          <Button size="sm" type="submit" variant="primary" loading={busy}>
            Send
          </Button>
          <Button size="sm" onClick={() => setAsking(false)}>
            Skip
          </Button>
        </div>
      </form>
    )
  }

  return (
    <div className="mt-2 flex items-center gap-1">
      <button
        type="button"
        aria-label="Good answer"
        disabled={busy}
        onClick={() => void rate('up')}
        className="rounded p-1 text-ink-faint transition-colors hover:bg-surface-hover hover:text-ink disabled:opacity-50"
      >
        <ThumbsUp size={13} />
      </button>
      <button
        type="button"
        aria-label="Bad answer"
        disabled={busy}
        onClick={() => void rate('down')}
        className="rounded p-1 text-ink-faint transition-colors hover:bg-surface-hover hover:text-ink disabled:opacity-50"
      >
        <ThumbsDown size={13} />
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  )
}
