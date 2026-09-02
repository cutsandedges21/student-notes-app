import { useEffect, useRef } from 'react'
import { Button } from '../components/ui/Button'
import type { Counts } from './wordCount'

/**
 * Word count.
 *
 * Replaces a `window.alert` holding three lines of text, which blocked the
 * main thread, could not be styled or read by the page's own assistive
 * semantics, and -- because an alert has no room for it -- never showed the
 * selection count, which is the number a student with a word limit on one
 * section is actually looking for.
 *
 * A dialog rather than a persistent status bar, deliberately. The count is
 * consulted occasionally and watched never; putting a number that changes on
 * every keystroke permanently on screen is a distraction in a writing surface,
 * and re-counting the document on every edit to keep it live is work done for
 * a figure nobody is reading.
 */

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between gap-8 py-1.5">
      <dt className="text-ink-subtle">{label}</dt>
      <dd className="tabular-nums font-medium text-ink">{value.toLocaleString()}</dd>
    </div>
  )
}

export function WordCountDialog({
  open,
  document: documentCounts,
  selection,
  onClose,
}: {
  open: boolean
  document: Counts
  /** Null when nothing is selected, which is not the same as a count of zero. */
  selection: Counts | null
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (open && !node.open) node.showModal()
    if (!open && node.open) node.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose()
      }}
      aria-labelledby="word-count-title"
      className="w-full max-w-xs rounded-lg border border-line bg-surface p-0 shadow-sheet backdrop:bg-ink/30"
    >
      <div className="p-6">
        <h2 id="word-count-title" className="text-lg font-medium text-ink">
          Word count
        </h2>

        <dl className="mt-4 text-sm">
          <Row label="Words" value={documentCounts.words} />
          <Row label="Characters" value={documentCounts.characters} />
          <Row label="Characters excluding spaces" value={documentCounts.charactersNoSpaces} />
        </dl>

        {selection && (
          <>
            <h3 className="mt-5 text-sm font-medium text-ink">Selection</h3>
            <dl className="mt-1 text-sm">
              <Row label="Words" value={selection.words} />
              <Row label="Characters" value={selection.characters} />
            </dl>
          </>
        )}

        <div className="mt-6 flex justify-end">
          <Button onClick={onClose} variant="primary">
            Done
          </Button>
        </div>
      </div>
    </dialog>
  )
}
