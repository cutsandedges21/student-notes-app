import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, X } from 'lucide-react'
import { searchNotes } from '../services/search'
import type { SearchHit } from '../services/searchResults'
import { noteHref } from '../lib/noteRef'
import { describeDataError } from '../lib/dataErrors'
import { cn } from '../lib/cn'

/**
 * Search across every note.
 *
 * The question this answers is "which lecture was osmosis in?", which until
 * now had no answer short of opening classes one at a time. It is deliberately
 * not the AI panel: the answer has to arrive while you are still typing, be
 * the same every time, and not cost a model call.
 *
 * Results are keyboard-first. Someone who opened this by pressing a key is not
 * reaching for the mouse to choose from a list, so Up/Down move, Enter opens,
 * and Escape closes -- and the active row is scrolled into view rather than
 * only outlined, which matters once the list is longer than the box.
 */

/** Long enough that one letter does not fetch every note the student owns. */
const MIN_QUERY = 2

/** Typing settles before a request goes out. */
const DEBOUNCE_MS = 200

export function SearchDialog({
  open,
  userId,
  onClose,
}: {
  open: boolean
  userId: string | null
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const navigate = useNavigate()

  const [query, setQuery] = useState('')
  /*
   * Results carry the query they answer.
   *
   * Holding them apart needed an effect to clear the list whenever the query
   * changed, which is a render where the previous query's notes sit under the
   * new one -- and one Enter away from opening a note the student was no
   * longer looking at. Keyed, that state cannot be represented.
   */
  const [result, setResult] = useState<{ query: string; hits: SearchHit[] } | null>(null)
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmed = query.trim()
  const longEnough = trimmed.length >= MIN_QUERY
  const answered = longEnough && result?.query === trimmed
  const hits = answered ? result.hits : []
  /** True once a search for the query now in the box has come back. */
  const searched = answered

  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (open && !node.open) {
      setQuery('')
      setResult(null)
      setActive(0)
      setError(null)
      node.showModal()
      inputRef.current?.focus()
    }
    if (!open && node.open) node.close()
  }, [open])

  useEffect(() => {
    if (!open || !longEnough) return

    let cancelled = false
    const timer = setTimeout(() => {
      setBusy(true)
      searchNotes(userId, trimmed)
        .then((found) => {
          // A slower earlier request must not overwrite a newer answer.
          if (cancelled) return
          setResult({ query: trimmed, hits: found })
          setActive(0)
          setError(null)
        })
        .catch((caught) => {
          if (cancelled) return
          console.error('[SearchDialog] search failed:', caught)
          setError(describeDataError(caught))
        })
        .finally(() => {
          if (!cancelled) setBusy(false)
        })
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [trimmed, longEnough, userId, open])

  // Keeps the highlighted row on screen once the list is longer than the box.
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function go(hit: SearchHit) {
    navigate(noteHref(hit.classSlug, hit.slug, hit.documentId))
    onClose()
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (hits.length === 0) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((current) => (current + 1) % hits.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((current) => (current - 1 + hits.length) % hits.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      go(hits[active])
    }
  }

  const tooShort = trimmed.length > 0 && !longEnough

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose()
      }}
      aria-label="Search your notes"
      className="w-full max-w-xl rounded-lg border border-line bg-surface p-0 shadow-sheet backdrop:bg-ink/30"
    >
      <div className="flex items-center gap-2 border-b border-line px-4">
        <Search size={16} className="shrink-0 text-ink-faint" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search your notes"
          aria-label="Search your notes"
          aria-controls="search-results"
          className="min-w-0 flex-1 bg-transparent py-3 text-sm text-ink placeholder:text-ink-faint focus:outline-none"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close search"
          className="shrink-0 rounded p-1 text-ink-faint transition-colors hover:bg-surface-hover"
        >
          <X size={16} />
        </button>
      </div>

      {error && (
        <p role="alert" className="px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      <ul
        id="search-results"
        ref={listRef}
        className="max-h-80 overflow-y-auto"
        /*
         * A plain list, not a listbox. The rows are links to notes rather than
         * values being chosen, and claiming `role="listbox"` would promise an
         * interaction model -- selection, `aria-selected`, a controlled active
         * descendant -- that this does not implement.
         */
      >
        {hits.map((hit, index) => (
          <li key={hit.documentId}>
            <button
              type="button"
              onClick={() => go(hit)}
              onMouseEnter={() => setActive(index)}
              className={cn(
                'block w-full px-4 py-2.5 text-left transition-colors',
                index === active ? 'bg-surface-hover' : 'hover:bg-surface-hover',
              )}
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm font-medium text-ink">
                  {hit.title || 'Untitled document'}
                </span>
                <span className="shrink-0 text-xs text-ink-faint">{hit.className}</span>
              </span>
              {hit.snippet && (
                <span className="mt-0.5 block truncate text-xs text-ink-muted">
                  {hit.snippet}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>

      <p role="status" className="border-t border-line px-4 py-2 text-xs text-ink-faint">
        {tooShort
          ? `Type at least ${MIN_QUERY} characters.`
          : busy
            ? 'Searching…'
            : searched
              ? hits.length === 0
                ? `No notes match “${trimmed}”.`
                : `${hits.length} note${hits.length === 1 ? '' : 's'}. Up and down to move, Enter to open.`
              : 'Searches the title and the text of every note you can open.'}
      </p>
    </dialog>
  )
}
