import { useEffect, useMemo, useRef, useState } from 'react'
import katex from 'katex'
import { Button } from '../components/ui/Button'
import { MathPalette } from './MathPalette'
import type { MathSymbol } from './mathSymbols'

/**
 * Write an equation: type the source, see it set, accept it.
 *
 * A dialog rather than typing LaTeX straight into the page, because the node
 * renders as soon as it is valid: `\frac{a}{b}` becomes a fraction the moment
 * the last brace lands, and there is then nothing left on screen to edit. The
 * source has to live somewhere a student can get back to it.
 *
 * Which is also why this doubles as the editor for an existing equation.
 * Selecting a formula and opening this fills the box with its source; without
 * that, fixing a typo in a derivation means deleting the formula and typing it
 * again from the beginning.
 *
 * The preview renders through `katex.render` into a ref rather than through
 * `dangerouslySetInnerHTML`. Same DOM either way, but the markup never becomes
 * a string this component is responsible for, so there is no sanitisation
 * question to answer -- KaTeX builds the nodes from its own parse of the
 * source, and with `trust` left at its default it will not emit a link or a
 * URL from user input.
 */

/** Renders `latex`, or explains why it cannot be rendered. */
function useKatex(latex: string, display: boolean) {
  return useMemo(() => {
    const source = latex.trim()
    if (!source) return { html: '', error: null as string | null, empty: true }

    try {
      return {
        html: katex.renderToString(source, { displayMode: display, throwOnError: true }),
        error: null,
        empty: false,
      }
    } catch (caught) {
      /*
       * Thrown deliberately, rather than KaTeX's default of rendering the
       * broken source in red. The red output is useful inside a document,
       * where it is the only way to show something went wrong; here there is a
       * whole panel to say so in words, and the message names the token it
       * choked on.
       */
      const message = caught instanceof Error ? caught.message : 'Not a valid equation.'
      return {
        html: '',
        error: message.replace(/^KaTeX parse error:\s*/, ''),
        empty: false,
      }
    }
  }, [latex, display])
}

export function EquationDialog({
  open,
  initialLatex = '',
  initialDisplay = false,
  editing = false,
  onSubmit,
  onClose,
}: {
  open: boolean
  /** The source of the equation being edited, empty when inserting. */
  initialLatex?: string
  /** True for a block equation on its own line, false for one set in the text. */
  initialDisplay?: boolean
  editing?: boolean
  onSubmit: (equation: { latex: string; display: boolean }) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const [latex, setLatex] = useState(initialLatex)
  const [display, setDisplay] = useState(initialDisplay)

  const { html, error, empty } = useKatex(latex, display)
  const canAccept = !empty && !error

  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (open && !node.open) {
      setLatex(initialLatex)
      setDisplay(initialDisplay)
      node.showModal()
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    if (!open && node.open) node.close()
  }, [open, initialLatex, initialDisplay])

  useEffect(() => {
    if (previewRef.current) previewRef.current.innerHTML = html
  }, [html])

  /**
   * Writes a picked symbol into the source at the caret.
   *
   * Replaces the selection rather than ignoring it, so a wrong symbol can be
   * swapped by highlighting it and picking another. The caret then goes where
   * the entry says -- inside a structure's first slot, or after a plain
   * symbol -- and focus returns to the box, so a formula can be built by
   * alternating picks and typing without reaching for the mouse in between.
   */
  function insertSymbol(item: MathSymbol) {
    const field = inputRef.current
    const start = field?.selectionStart ?? latex.length
    const end = field?.selectionEnd ?? latex.length

    const next = latex.slice(0, start) + item.insert + latex.slice(end)
    const caret = start + (item.caret ?? item.insert.length)

    setLatex(next)

    // After the value lands, or the browser puts the caret at the end.
    requestAnimationFrame(() => {
      const node = inputRef.current
      if (!node) return
      node.focus()
      node.setSelectionRange(caret, caret)
    })
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!canAccept) return
    onSubmit({ latex: latex.trim(), display })
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose()
      }}
      aria-labelledby="equation-dialog-title"
      // Wide enough for the widest palette to open inside it. At the previous
      // width the Math grid ran past the right edge and put a scrollbar on the
      // dialog.
      className="w-full max-w-2xl rounded-lg border border-line bg-surface p-0 shadow-sheet backdrop:bg-ink/30"
    >
      <form onSubmit={submit} className="p-6">
        <h2 id="equation-dialog-title" className="text-lg font-medium text-ink">
          {editing ? 'Edit equation' : 'Insert equation'}
        </h2>

        <div className="mt-4">
          <label htmlFor="equation-latex" className="mb-1 block text-sm font-medium text-ink">
            Equation
          </label>
          <MathPalette onInsert={insertSymbol} />

          <textarea
            id="equation-latex"
            ref={inputRef}
            rows={3}
            value={latex}
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby="equation-hint"
            onChange={(event) => setLatex(event.target.value)}
            // Enter belongs to the equation; Ctrl+Enter accepts, as it does in
            // every other multi-line field people have used.
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                submit(event)
              }
            }}
            className="mt-2 w-full rounded border border-line bg-surface px-3 py-2 font-mono text-sm text-ink focus:border-accent focus:outline-none"
            placeholder="Pick symbols above, and type the numbers and letters."
          />
          <p id="equation-hint" className="mt-1 text-xs text-ink-subtle">
            Pick symbols from the menus above. Ctrl+Enter to accept.
          </p>
        </div>

        <div className="mt-4">
          <span className="block text-sm font-medium text-ink">Preview</span>
          <div
            data-testid="equation-preview"
            className={sheet(error)}
            /*
             * The preview is announced as a whole when it settles rather than
             * per keystroke: a live region firing on every character would read
             * a formula being typed one fragment at a time.
             */
            aria-live="polite"
            aria-atomic="true"
          >
            {error ? (
              <p className="font-mono text-xs text-danger">{error}</p>
            ) : empty ? (
              <p className="text-xs text-ink-faint">
                Type an equation above to see it here.
              </p>
            ) : (
              <div ref={previewRef} aria-label={`Equation: ${latex.trim()}`} />
            )}
          </div>
        </div>

        <label className="mt-4 flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={display}
            onChange={(event) => setDisplay(event.target.checked)}
            className="rounded border-line"
          />
          Set on its own line
        </label>

        <div className="mt-6 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!canAccept}>
            {editing ? 'Update' : 'Insert'}
          </Button>
        </div>
      </form>
    </dialog>
  )
}

function sheet(error: string | null): string {
  return [
    'mt-1 grid min-h-[72px] place-items-center overflow-x-auto rounded border px-3 py-3',
    error ? 'border-danger/40 bg-danger/5' : 'border-line bg-surface-backdrop',
  ].join(' ')
}
