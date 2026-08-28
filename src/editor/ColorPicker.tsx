import { cn } from '../lib/cn'

/**
 * Google Docs-style swatch grid: a small fixed palette rather than a full
 * colour wheel. A student picking a highlight colour wants five options and
 * one click, not a hex field.
 */
const PALETTE = [
  ['#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#ffffff'],
  ['#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8'],
  ['#0000ff', '#9900ff', '#ff00ff', '#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc'],
  ['#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc', '#a2c4c9'],
]

interface ColorPickerProps {
  value?: string
  onSelect: (color: string) => void
  onClear: () => void
  clearLabel: string
}

export function ColorPicker({ value, onSelect, onClear, clearLabel }: ColorPickerProps) {
  return (
    <div className="p-2">
      <div className="flex flex-col gap-1">
        {PALETTE.map((row, rowIndex) => (
          <div key={rowIndex} className="flex gap-1">
            {row.map((color) => (
              <button
                key={color}
                type="button"
                title={color}
                aria-label={color}
                onClick={() => onSelect(color)}
                style={{ backgroundColor: color }}
                className={cn(
                  'h-5 w-5 rounded-sm border transition-transform hover:scale-110',
                  value?.toLowerCase() === color
                    ? 'border-accent ring-1 ring-accent'
                    : 'border-line-strong',
                )}
              />
            ))}
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={onClear}
        className="mt-2 w-full rounded px-2 py-1 text-left text-sm text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
      >
        {clearLabel}
      </button>
    </div>
  )
}
