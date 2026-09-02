import { useEffect, useMemo, useRef, useState } from 'react'
import katex from 'katex'
import { ChevronDown } from 'lucide-react'
import { cn } from '../lib/cn'
import { MATH_GROUPS, type MathGroup, type MathSymbol } from './mathSymbols'

/**
 * The symbol palettes above the equation box.
 *
 * Five menus of glyphs, so an equation can be built by pointing at what it
 * should look like rather than by knowing what it is called. Nothing here
 * shows a command name: the buttons are the symbols, set the way they will
 * appear in the note.
 *
 * The popovers are positioned inside this component rather than portalled to
 * the body like the toolbar's menus are. A modal `<dialog>` renders in the top
 * layer, above everything in the page including a portal at the end of
 * `<body>`, so a portalled panel would open behind the dialog's own backdrop.
 */

/** One KaTeX render per distinct source, kept across opens and closes. */
const rendered = new Map<string, string>()

function mathHtml(latex: string): string {
  const cached = rendered.get(latex)
  if (cached !== undefined) return cached

  let html: string
  try {
    html = katex.renderToString(latex, { throwOnError: true })
  } catch {
    // A symbol that will not render is a mistake in the table rather than
    // anything the student did, so it falls back to its own source instead of
    // breaking the grid.
    html = `<span class="font-mono text-xs">${latex}</span>`
  }
  rendered.set(latex, html)
  return html
}

function SymbolButton({
  item,
  onPick,
}: {
  item: MathSymbol
  onPick: (item: MathSymbol) => void
}) {
  const html = useMemo(() => mathHtml(item.preview ?? item.insert), [item])

  return (
    <button
      type="button"
      title={item.label}
      aria-label={item.label}
      // Keeps the caret in the equation box: without this the press moves
      // focus, and the insertion point it is about to write to is lost.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onPick(item)}
      className="math-palette__key grid h-10 min-w-[40px] place-items-center rounded px-2 text-ink transition-colors hover:bg-docs-chrome-hover"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function PaletteMenu({
  group,
  onPick,
}: {
  group: MathGroup
  onPick: (item: MathSymbol) => void
}) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerHtml = useMemo(() => mathHtml(group.triggerLatex), [group.triggerLatex])

  // Same dismissal contract as every other transient surface in the app.
  useEffect(() => {
    if (!open) return

    function onPointerDown(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      /*
       * Both, and preventDefault is the one that matters. A modal `<dialog>`
       * closes on Escape through the browser's own cancel behaviour rather
       * than through a listener, so stopping propagation leaves it closing
       * anyway -- taking a half-built equation with it when all that was asked
       * for was to shut this menu.
       */
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown, { capture: true })
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown, { capture: true })
    }
  }, [open])

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={group.title}
        title={group.title}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'flex h-8 items-center gap-1 rounded px-2 text-ink transition-colors',
          'hover:bg-docs-chrome-hover',
          open && 'bg-docs-active',
        )}
      >
        <span dangerouslySetInnerHTML={{ __html: triggerHtml }} />
        <ChevronDown size={14} className="text-docs-icon" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={group.title}
          className="math-palette__menu absolute left-0 top-full z-10 mt-1 w-max rounded-lg border border-line bg-surface p-2 shadow-sheet"
        >
          <div
            className="grid gap-0.5"
            style={{ gridTemplateColumns: `repeat(${group.columns}, auto)` }}
          >
            {group.items.map((item) => (
              <SymbolButton
                key={item.insert + item.label}
                item={item}
                onPick={(picked) => {
                  onPick(picked)
                  setOpen(false)
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function MathPalette({ onInsert }: { onInsert: (item: MathSymbol) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1 rounded border border-line bg-surface-backdrop px-1 py-1">
      {MATH_GROUPS.map((group) => (
        <PaletteMenu key={group.title} group={group} onPick={onInsert} />
      ))}
    </div>
  )
}
