import { Button } from './ui/Button'

/**
 * What to do when a note was changed somewhere else.
 *
 * Saves are conditional on the version the client last read, so a save built
 * on stale state affects no rows and comes back refused. That check is sound;
 * what happened next was not. Both editors answered a refusal by re-reading
 * the note and adopting the other side's content -- which silently threw away
 * everything the person in front of them had just written.
 *
 * That is the failure mode the "Anyone with the link can edit" share mode
 * walked straight into: two people typing, and whoever saved second lost their
 * work with no message. Until real collaborative editing exists, the honest
 * behaviour is to keep both versions and let a person choose, because there is
 * no answer the app can pick here that is not somebody's work being discarded.
 *
 * Deliberately not dismissable by clicking away. Every route out of this
 * dialog is a decision about which text survives, so there is no "close" that
 * would be safe to treat as either answer.
 */
export function ConflictDialog({
  open,
  /** Who made the change, when it is known. */
  by,
  onKeepMine,
  onUseTheirs,
}: {
  open: boolean
  by?: string
  onKeepMine: () => void
  onUseTheirs: () => void
}) {
  if (!open) return null

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="conflict-title"
      aria-describedby="conflict-body"
      className="fixed inset-0 z-[60] grid place-items-center bg-ink/30 px-4"
    >
      <div className="w-full max-w-md rounded-lg border border-line bg-surface p-6 shadow-sheet">
        <h2 id="conflict-title" className="text-lg font-medium text-ink">
          This note changed somewhere else
        </h2>

        <p id="conflict-body" className="mt-3 text-sm text-ink-muted">
          {by ? `${by} saved a new version` : 'A newer version was saved'} while you
          were writing. Nothing has been overwritten — both versions still exist,
          and you decide which one this note keeps.
        </p>

        <div className="mt-5 flex flex-col gap-2">
          <Button variant="primary" onClick={onKeepMine}>
            Keep what I wrote
          </Button>
          <Button onClick={onUseTheirs}>Use the other version instead</Button>
        </div>

        <p className="mt-4 text-xs text-ink-faint">
          Keeping yours saves your text over theirs. Using theirs discards what you
          have written since your last save.
        </p>
      </div>
    </div>
  )
}
