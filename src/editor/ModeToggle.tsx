import { Eye, Pencil } from 'lucide-react'
import { useSpring } from '../lib/useSpring'
import { cn } from '../lib/cn'

/**
 * Editing or viewing, as one rolling label.
 *
 * It was a dropdown, which is three interactions -- open, read two options,
 * choose -- for a control with two states and no third one coming.
 *
 * Only the current state is shown. A switch with both labels visible has to be
 * read before it can be understood: which of the two is the state, and which is
 * the thing that would happen if you pressed it? One label cannot be misread,
 * and the roll is what says the other one exists.
 *
 * The roll is driven by a spring rather than a transition because this is a
 * control people flip back and forth. A transition restarts at its declared
 * duration however far it had travelled, so flipping straight back crawls; a
 * spring keeps its velocity and whips back, because it was already moving that
 * way.
 */

/** Sized for "Viewing", the longer label, so the pill never resizes. */
const WIDTH = 104
const HEIGHT = 30

interface ModeToggleProps {
  editable: boolean
  onChange: (editable: boolean) => void
}

const MODES = [
  { icon: Pencil, label: 'Editing' },
  { icon: Eye, label: 'Viewing' },
]

export function ModeToggle({ editable, onChange }: ModeToggleProps) {
  // 0 is editing, 1 is viewing. The roll is this value times the row height,
  // so the label and the icon can never disagree about which state is showing.
  const position = useSpring(editable ? 0 : 1)

  return (
    <button
      type="button"
      role="switch"
      aria-checked={!editable}
      aria-label={editable ? 'Editing — switch to viewing' : 'Viewing — switch to editing'}
      title={editable ? 'Switch to viewing' : 'Switch to editing'}
      onClick={() => onChange(!editable)}
      className={cn(
        'pointer-events-auto relative overflow-hidden rounded-full border border-line',
        'bg-surface px-3 shadow-pill transition-colors hover:bg-docs-chrome-hover',
      )}
      style={{ width: WIDTH, height: HEIGHT }}
    >
      {/*
        Both rows exist at all times and the column is moved. Swapping the
        contents instead would give the roll nothing to travel between: there
        would be one row, changing, rather than two passing each other.
      */}
      <span
        className="absolute left-0 top-0 flex w-full flex-col"
        style={{ transform: `translateY(${-position * HEIGHT}px)` }}
      >
        {MODES.map(({ icon: Icon, label }, index) => (
          <span
            key={label}
            className="flex shrink-0 items-center justify-center gap-1.5 font-ui text-sm text-ink"
            style={{
              height: HEIGHT,
              /*
               * Fades toward the edges of the travel. Without this the outgoing
               * label is still at full strength as it clips against the pill,
               * which reads as text being cut in half rather than leaving.
               */
              opacity: 1 - Math.min(1, Math.abs(position - index)),
            }}
          >
            <Icon size={15} className="shrink-0 text-docs-icon" />
            {label}
          </span>
        ))}
      </span>
    </button>
  )
}
