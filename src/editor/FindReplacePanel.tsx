import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { findMatches, nextMatchIndex, replacementOrder } from './findReplace'
import { cn } from '../lib/cn'

/**
 * Find and replace.
 *
 * Replaces a `window.prompt` that could only find, showed no count, could not
 * step between hits, and blocked the page while it was open. This is a panel
 * rather than a dialog on purpose: the whole task is looking at the document
 * while typing a query, which a modal makes impossible.
 *
 * Matches are recomputed from the live document on every keystroke rather than
 * cached. On a long note that is still a single pass over the text, and a
 * cache would have to be invalidated by every edit, every undo and every
 * incoming collaborative change -- more machinery than the scan it saves.
 */

export function FindReplacePanel({
  editor,
  open,
  onClose,
}: {
  editor: Editor | null
  open: boolean
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [current, setCurrent] = useState(0)
  /** Bumped after each replacement so the match list is recomputed. */
  const [revision, setRevision] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const matches = useMemo(() => {
    if (!editor || !query) return []
    return findMatches(editor.state.doc, query, { caseSensitive, wholeWord })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, query, caseSensitive, wholeWord, revision, open])

  // Opening focuses the field, and seeds it with the selection -- searching
  // for the thing you just highlighted is the common case.
  useEffect(() => {
    if (!open || !editor) return
    const { from, to } = editor.state.selection
    if (from !== to) {
      const selected = editor.state.doc.textBetween(from, to, ' ').trim()
      if (selected && selected.length <= 80) setQuery(selected)
    }
    inputRef.current?.focus()
    inputRef.current?.select()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const show = useCallback(
    (index: number) => {
      if (!editor || matches.length === 0) return
      const wrapped = ((index % matches.length) + matches.length) % matches.length
      setCurrent(wrapped)
      const match = matches[wrapped]
      editor.commands.setSearchMatches(matches, wrapped)
      // Selecting is what scrolls it into view, and it leaves the caret where
      // a subsequent Replace should act.
      editor.commands.setTextSelection({ from: match.from, to: match.to })
      editor.commands.scrollIntoView()
    },
    [editor, matches],
  )

  // Re-highlight whenever the result set changes, keeping the current index in
  // range as the list shrinks.
  useEffect(() => {
    if (!editor || !open) return
    if (matches.length === 0) {
      editor.commands.setSearchMatches([], -1)
      setCurrent(0)
      return
    }
    const index = Math.min(current, matches.length - 1)
    setCurrent(index)
    editor.commands.setSearchMatches(matches, index)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches, editor, open])

  // Clear the highlights when the panel goes away; leaving them up would look
  // like the document had been marked.
  useEffect(() => {
    if (open || !editor || editor.isDestroyed) return
    editor.commands.clearSearchMatches()
  }, [open, editor])

  const step = (direction: 'forward' | 'backward') => {
    if (!editor || matches.length === 0) return
    const caret =
      direction === 'forward' ? editor.state.selection.to : editor.state.selection.from
    show(nextMatchIndex(matches, caret, direction))
  }

  const replaceCurrent = () => {
    if (!editor || matches.length === 0) return
    const match = matches[Math.min(current, matches.length - 1)]
    editor
      .chain()
      .focus()
      .insertContentAt({ from: match.from, to: match.to }, replacement)
      .run()
    setRevision((n) => n + 1)
  }

  /*
   * Back to front, so no replacement moves a range that has not been used yet.
   * One chain, so the whole thing is a single undo step: a student who
   * replaces 200 occurrences and regrets it should press Ctrl+Z once.
   */
  const replaceAll = () => {
    if (!editor || matches.length === 0) return
    const chain = editor.chain().focus()
    for (const match of replacementOrder(matches)) {
      chain.insertContentAt({ from: match.from, to: match.to }, replacement)
    }
    chain.run()
    setRevision((n) => n + 1)
  }

  if (!open) return null

  const count = matches.length

  return (
    <div
      role="search"
      aria-label="Find and replace"
      // Escape closes from anywhere inside, which is where the hand already is.
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
        }
      }}
      className="sticky top-0 z-30 flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2 shadow-pill"
    >
      <div className="flex items-center gap-1.5">
        <label htmlFor="find-query" className="sr-only">
          Find
        </label>
        <input
          id="find-query"
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              step(event.shiftKey ? 'backward' : 'forward')
            }
          }}
          placeholder="Find"
          className="h-8 w-44 rounded border border-line-strong bg-surface px-2 text-sm text-ink placeholder:text-ink-faint"
        />
        {/*
          Announced politely so a screen reader hears the count settle rather
          than every intermediate value while the query is still being typed.
        */}
        <span
          role="status"
          aria-live="polite"
          className="min-w-[5.5rem] text-xs text-ink-muted"
        >
          {query ? (count ? `${current + 1} of ${count}` : 'No matches') : ''}
        </span>
      </div>

      <div className="flex items-center gap-1">
        <Button
          size="sm"
          aria-label="Previous match"
          disabled={count === 0}
          onClick={() => step('backward')}
        >
          <ChevronUp size={14} aria-hidden="true" />
        </Button>
        <Button
          size="sm"
          aria-label="Next match"
          disabled={count === 0}
          onClick={() => step('forward')}
        >
          <ChevronDown size={14} aria-hidden="true" />
        </Button>
      </div>

      <div className="flex items-center gap-1.5">
        <label htmlFor="replace-with" className="sr-only">
          Replace with
        </label>
        <input
          id="replace-with"
          value={replacement}
          onChange={(event) => setReplacement(event.target.value)}
          placeholder="Replace with"
          className="h-8 w-44 rounded border border-line-strong bg-surface px-2 text-sm text-ink placeholder:text-ink-faint"
        />
        <Button size="sm" disabled={count === 0} onClick={replaceCurrent}>
          Replace
        </Button>
        <Button size="sm" disabled={count === 0} onClick={replaceAll}>
          Replace all
        </Button>
      </div>

      <div className="flex items-center gap-3 text-xs text-ink-muted">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(event) => setCaseSensitive(event.target.checked)}
          />
          Match case
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={wholeWord}
            onChange={(event) => setWholeWord(event.target.checked)}
          />
          Whole word
        </label>
      </div>

      <button
        type="button"
        aria-label="Close find and replace"
        onClick={onClose}
        className={cn(
          'ml-auto grid h-7 w-7 place-items-center rounded',
          'text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink',
        )}
      >
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  )
}
