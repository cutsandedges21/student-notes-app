import { useEffect, useRef, useState } from 'react'
import { Button } from '../components/ui/Button'
import { cn } from '../lib/cn'
import {
  DEFAULT_PAGE_SETUP,
  INCH,
  PAPER_LABELS,
  PAPER_SIZES,
  geometryFor,
  isUsable,
  type PageMargins,
  type PageSetup,
  type PaperSizeName,
} from './pagination/geometry'

/**
 * Paper size, orientation and margins.
 *
 * The geometry engine has understood Letter, Legal and A4 since it was
 * written; only Letter was ever reachable, with top and bottom margins nailed
 * at an inch. A4 is the paper almost everywhere outside the US, so for most
 * students this app has only ever printed onto the wrong sheet.
 *
 * Margins are entered in inches and stored in pixels. Inches are what the
 * ruler shows and what a coursework brief specifies ("one inch margins"); the
 * engine works in CSS pixels at 96 DPI, and it is better for one dialog to do
 * that conversion than for every reader of the stored value to.
 */

const SIDES: { key: keyof PageMargins; label: string }[] = [
  { key: 'top', label: 'Top' },
  { key: 'bottom', label: 'Bottom' },
  { key: 'left', label: 'Left' },
  { key: 'right', label: 'Right' },
]

/** Two decimals is the precision a ruler can express; more is noise. */
function toInches(pixels: number): string {
  return String(Math.round((pixels / INCH) * 100) / 100)
}

export function PageSetupDialog({
  open,
  setup,
  onApply,
  onClose,
}: {
  open: boolean
  setup: PageSetup
  onApply: (setup: PageSetup) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [paper, setPaper] = useState<PaperSizeName>(setup.paper)
  const [landscape, setLandscape] = useState(setup.landscape)
  /*
   * Margins are held as the strings that are in the boxes, not as numbers.
   * Parsing on every keystroke means clearing a field to retype it becomes 0
   * and the page jumps to full width under the cursor; and "0." on the way to
   * "0.5" is not a number yet.
   */
  const [margins, setMargins] = useState<Record<keyof PageMargins, string>>({
    top: toInches(setup.margins.top),
    right: toInches(setup.margins.right),
    bottom: toInches(setup.margins.bottom),
    left: toInches(setup.margins.left),
  })

  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (open && !node.open) {
      setPaper(setup.paper)
      setLandscape(setup.landscape)
      setMargins({
        top: toInches(setup.margins.top),
        right: toInches(setup.margins.right),
        bottom: toInches(setup.margins.bottom),
        left: toInches(setup.margins.left),
      })
      node.showModal()
    }
    if (!open && node.open) node.close()
  }, [open, setup])

  const parsed: PageMargins = {
    top: Number(margins.top) * INCH,
    right: Number(margins.right) * INCH,
    bottom: Number(margins.bottom) * INCH,
    left: Number(margins.left) * INCH,
  }

  const numbersValid = SIDES.every(({ key }) => {
    const value = Number(margins[key])
    return margins[key].trim() !== '' && Number.isFinite(value) && value >= 0
  })

  const candidate: PageSetup = { paper, landscape, margins: parsed }
  // Margins wider than the paper would render the note as blank sheets with
  // the writing nowhere, which reads as data loss rather than as a setting.
  const fits = numbersValid && isUsable(geometryFor(candidate))
  const error = !numbersValid
    ? 'Margins must be numbers, and cannot be negative.'
    : !fits
      ? 'Those margins leave no room for text on this paper.'
      : null

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!fits) return
    onApply(candidate)
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose()
      }}
      aria-labelledby="page-setup-title"
      className="w-full max-w-md rounded-lg border border-line bg-surface p-0 shadow-sheet backdrop:bg-ink/30"
    >
      <form onSubmit={submit} className="p-6">
        <h2 id="page-setup-title" className="text-lg font-medium text-ink">
          Page setup
        </h2>

        <div className="mt-4">
          <label htmlFor="page-paper" className="block text-sm font-medium text-ink">
            Paper size
          </label>
          <select
            id="page-paper"
            value={paper}
            onChange={(event) => setPaper(event.target.value as PaperSizeName)}
            className="mt-1 w-full rounded border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
          >
            {(Object.keys(PAPER_SIZES) as PaperSizeName[]).map((name) => (
              <option key={name} value={name}>
                {PAPER_LABELS[name]}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="mt-4">
          <legend className="text-sm font-medium text-ink">Orientation</legend>
          <div className="mt-1 flex gap-4">
            {[
              { value: false, label: 'Portrait' },
              { value: true, label: 'Landscape' },
            ].map((option) => (
              <label key={option.label} className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="radio"
                  name="orientation"
                  checked={landscape === option.value}
                  onChange={() => setLandscape(option.value)}
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-4">
          <legend className="text-sm font-medium text-ink">Margins (inches)</legend>
          <div className="mt-1 grid grid-cols-2 gap-3">
            {SIDES.map(({ key, label }) => (
              <div key={key}>
                <label
                  htmlFor={`margin-${key}`}
                  className="block text-xs text-ink-muted"
                >
                  {label}
                </label>
                <input
                  id={`margin-${key}`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.25}
                  value={margins[key]}
                  onChange={(event) =>
                    setMargins((current) => ({ ...current, [key]: event.target.value }))
                  }
                  className="mt-0.5 w-full rounded border border-line bg-surface px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
                />
              </div>
            ))}
          </div>
        </fieldset>

        {error && (
          <p role="alert" className={cn('mt-3 text-sm text-danger')}>
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button
            onClick={() => {
              setPaper(DEFAULT_PAGE_SETUP.paper)
              setLandscape(DEFAULT_PAGE_SETUP.landscape)
              setMargins({
                top: toInches(DEFAULT_PAGE_SETUP.margins.top),
                right: toInches(DEFAULT_PAGE_SETUP.margins.right),
                bottom: toInches(DEFAULT_PAGE_SETUP.margins.bottom),
                left: toInches(DEFAULT_PAGE_SETUP.margins.left),
              })
            }}
            className="mr-auto"
          >
            Reset
          </Button>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!fits}>
            Apply
          </Button>
        </div>
      </form>
    </dialog>
  )
}
