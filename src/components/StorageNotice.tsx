import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

/**
 * Explains where the user's work actually lives.
 *
 * Guests get a real, fully-working app, so nothing else on screen signals that
 * their notes are tied to this one browser. Saying so plainly is the honest
 * thing to do — losing a semester of notes to a cleared cache would be far
 * worse than one line of UI.
 */
export function StorageNotice({ hasContent }: { hasContent: boolean }) {
  const { session, migration, dismissMigration } = useAuth()

  if (migration) {
    const { classes, documents } = migration
    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

    return (
      <div className="mt-6 flex items-start justify-between gap-4 rounded border border-accent/30 bg-accent-subtle px-4 py-3">
        <p className="text-sm text-ink">
          Moved {plural(classes, 'class')} and {plural(documents, 'note')} into your
          account. They&rsquo;re synced now.
        </p>
        <button
          type="button"
          onClick={dismissMigration}
          className="shrink-0 text-sm font-medium text-accent hover:underline"
        >
          Dismiss
        </button>
      </div>
    )
  }

  if (session || !hasContent) return null

  return (
    <div className="mt-6 rounded border border-line bg-surface px-4 py-3">
      <p className="text-sm text-ink-muted">
        Your notes are saved in this browser only.{' '}
        <Link to="/signup" className="font-medium text-accent hover:underline">
          Create an account
        </Link>{' '}
        to keep them safe and reach them from any device — your existing notes come
        with you.
      </p>
    </div>
  )
}
