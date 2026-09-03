import { useEffect, useRef, useState } from 'react'
import { Button } from './ui/Button'
import type { ClassWithCount } from '../types/database'

/**
 * Choosing where a note should be filed.
 *
 * The classes are loaded when the dialog opens rather than held by the page.
 * A student can create a class in another tab, and a list fetched when the
 * class page loaded would be missing it -- which reads as the app having lost
 * a class rather than as a stale cache.
 *
 * The note's current class is shown and cannot be chosen: "move it to where it
 * already is" is not an option, and offering it invites the click that does
 * nothing.
 */

export function MoveNoteDialog({
  open,
  noteTitle,
  currentClassId,
  loadClasses,
  onMove,
  onClose,
}: {
  open: boolean
  noteTitle: string
  currentClassId: string
  loadClasses: () => Promise<ClassWithCount[]>
  onMove: (classId: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [classes, setClasses] = useState<ClassWithCount[] | null>(null)
  const [chosen, setChosen] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (open && !node.open) {
      setClasses(null)
      setChosen('')
      setError(null)
      node.showModal()
    }
    if (!open && node.open) node.close()
  }, [open])

  useEffect(() => {
    if (!open) return

    let cancelled = false
    loadClasses()
      .then((rows) => {
        if (!cancelled) setClasses(rows)
      })
      .catch((caught) => {
        if (cancelled) return
        console.error('[MoveNoteDialog] could not load classes:', caught)
        setError('Your classes could not be loaded.')
        setClasses([])
      })

    return () => {
      cancelled = true
    }
  }, [open, loadClasses])

  const destinations = (classes ?? []).filter((klass) => klass.id !== currentClassId)

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose()
      }}
      aria-labelledby="move-note-title"
      className="w-full max-w-md rounded-lg border border-line bg-surface p-0 shadow-sheet backdrop:bg-ink/30"
    >
      <form
        className="p-6"
        onSubmit={(event) => {
          event.preventDefault()
          if (chosen) onMove(chosen)
        }}
      >
        <h2 id="move-note-title" className="text-lg font-medium text-ink">
          Move “{noteTitle || 'Untitled note'}”
        </h2>

        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}

        {classes === null ? (
          <p className="mt-4 text-sm text-ink-muted">Loading your classes…</p>
        ) : destinations.length === 0 ? (
          /* One class is the ordinary case for a new account, and "move" then
             has no meaning. Said plainly rather than shown as an empty list. */
          <p className="mt-4 text-sm text-ink-muted">
            There is nowhere else to put it yet. Make another class first.
          </p>
        ) : (
          <div className="mt-4">
            <label htmlFor="move-destination" className="block text-sm font-medium text-ink">
              Move to
            </label>
            <select
              id="move-destination"
              value={chosen}
              onChange={(event) => setChosen(event.target.value)}
              className="mt-1 w-full rounded border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
            >
              <option value="">Choose a class…</option>
              {destinations.map((klass) => (
                <option key={klass.id} value={klass.id}>
                  {klass.name}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-ink-subtle">
              The note keeps its link, its comments and its history. Only where it
              is filed changes.
            </p>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!chosen}>
            Move
          </Button>
        </div>
      </form>
    </dialog>
  )
}
