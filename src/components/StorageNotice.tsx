import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { downloadGuestBackup } from '../services/guestBackup'
import { type StorageFailureReason } from '../services/guestStore'

/** What the caller knows about the last failed guest write, if any. */
export interface StorageFailure {
  reason: StorageFailureReason
  message: string
}

/**
 * Explains where the user's work actually lives.
 *
 * Guests get a real, fully-working app, so nothing else on screen signals that
 * their notes are tied to this one browser. Saying so plainly is the honest
 * thing to do — losing a semester of notes to a cleared cache would be far
 * worse than one line of UI.
 *
 * `failure` escalates that from a note to an alarm: storage has actively
 * refused a write, so the browser is no longer keeping anything, and the only
 * useful things to offer are a file to download and an account to sign up for.
 */
export function StorageNotice({
  hasContent,
  failure = null,
}: {
  hasContent: boolean
  failure?: StorageFailure | null
}) {
  const { session, migration, dismissMigration } = useAuth()

  // Checked before everything else: a failed write outranks any other message
  // this component might be showing, including the migration confirmation.
  if (failure) {
    return (
      <div
        role="alert"
        className="mt-6 rounded border border-red-300 bg-red-50 px-4 py-3"
      >
        <p className="text-sm font-medium text-red-700">
          Your notes aren&rsquo;t being saved
        </p>
        <p className="mt-1 text-sm text-red-700">{failure.message}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={downloadGuestBackup}
            className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-700"
          >
            Download a backup
          </button>
          <Link
            to="/signup"
            className="text-sm font-medium text-red-700 underline hover:no-underline"
          >
            Create an account instead
          </Link>
        </div>
      </div>
    )
  }

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
        with you.{' '}
        {/*
          Offered before anything has gone wrong, not only after. Browser
          storage is cleared by things the app never sees — a privacy sweep, a
          reinstall, a "clear site data" click — and by then there is nothing
          left to export.
        */}
        <button
          type="button"
          onClick={downloadGuestBackup}
          className="font-medium text-accent underline hover:no-underline"
        >
          Download a backup
        </button>
      </p>
    </div>
  )
}
