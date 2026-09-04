/**
 * The handful of chrome icons lucide doesn't carry, plus the two that have to
 * render a live colour swatch underneath the glyph.
 *
 * Everything here is drawn from scratch on a 24x24 grid so it lines up with
 * the lucide icons it sits beside in the toolbar. Nothing is copied from
 * Google's icon set -- these are our own paths in the same silhouette.
 */

import { useId } from 'react'

interface IconProps {
  className?: string
  size?: number
}

/**
 * The app mark, shaped like the document icon that anchors the title row.
 */
export function AppDocIcon({ className }: { className?: string }) {
  // Same geometry as public/icon.svg, so the tab favicon and the in-app mark
  // are one design rather than two drifting copies.
  return (
    <svg
      viewBox="0 0 512 512"
      className={className}
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {/*
        The mark inverts in dark mode: a dark sheet drawn in light strokes,
        rather than the light sheet in dark strokes it is on a white page.

        Its three colours are their own tokens rather than the app's, and they
        are the only ones the mark uses. `currentColor` is deliberately not used
        for the strokes -- inheriting the bar's icon colour is what made the
        outline all but vanish against the sheet behind it.

        To go back to one fixed mark in both themes, set the three `--c-mark-*`
        values in the `.dark` block of index.css to the same values as the ones
        on `:root`. Nothing else has to change.
      */}
      <path
        d="M88 24h258l82 82v382a24 24 0 0 1-24 24H88a24 24 0 0 1-24-24V48a24 24 0 0 1 24-24Z"
        fill="rgb(var(--c-mark-sheet))"
      />
      <path d="M346 24l82 82h-82V24Z" fill="rgb(var(--c-mark-fold))" />
      <g
        stroke="rgb(var(--c-mark-line))"
        strokeWidth="22"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M282 24H88a24 24 0 0 0-24 24v440a24 24 0 0 0 24 24h84" />
        <path d="M224 512h192a24 24 0 0 0 24-24V310" />
        <path d="M440 248V106l-82-82h-42" />
        <path d="M346 24v58a24 24 0 0 0 24 24h58" />
        <path d="M134 24v198" />
        <path d="M134 288v224" />
        <path d="M64 82h282" />
        <path d="M64 448h376" />
        <path d="M380 106v342" />
      </g>
    </svg>
  )
}

/** Line spacing: a vertical double arrow beside stacked text lines. */
export function LineSpacingIcon({ size = 18, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 5v14" />
      <path d="m1.5 7.5 2.5-2.5 2.5 2.5" />
      <path d="m1.5 16.5 2.5 2.5 2.5-2.5" />
      <path d="M10 6h11M10 12h11M10 18h11" />
    </svg>
  )
}

/**
 * The four-point spark that opens the AI panel.
 *
 * Concave sides come from pulling each cubic's control points back towards the
 * centre; a plain diamond would read as a generic shape rather than a spark.
 */
export function SparkIcon({ size = 20, className }: IconProps) {
  /*
   * A gradient is referenced by id, and ids are global to the document. With a
   * fixed one, every spark on the page pointed at whichever definition the
   * browser met first -- so a star rendered from a gradient belonging to a
   * different, possibly hidden, instance, and painted as nothing.
   */
  const gradientId = `margin-spark-${useId()}`

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#4285f4" />
          <stop offset="45%" stopColor="#9b72cb" />
          <stop offset="100%" stopColor="#d96570" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${gradientId})`}
        d="M12 2C12.6 7.2 16.8 11.4 22 12C16.8 12.6 12.6 16.8 12 22C11.4 16.8 7.2 12.6 2 12C7.2 11.4 11.4 7.2 12 2Z"
      />
    </svg>
  )
}

/** The capital A used by the text-colour control. */
function LetterA({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      fillRule="evenodd"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 4 5.9 18h2.3l1.3-3.1h5l1.3 3.1h2.3L12 4Zm0 3.5 1.7 4.2h-3.4L12 7.5Z" />
    </svg>
  )
}

/**
 * Text colour and highlight both show the colour they would apply as a bar
 * under the glyph, which is the only thing that tells you what the button is
 * currently set to without opening it.
 */
export function TextColorIcon({ color }: { color?: string }) {
  return (
    <span className="flex flex-col items-center justify-center">
      <LetterA size={16} />
      <span
        style={{ backgroundColor: color ?? '#1f1f1f' }}
        className="mt-[1px] h-[3px] w-[15px] rounded-[1px]"
      />
    </span>
  )
}

export function HighlightColorIcon({ color }: { color?: string }) {
  return (
    <span className="flex flex-col items-center justify-center">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="m9 11-6 6v3h3l6-6" />
        <path d="m14.5 5.5 4 4" />
        <path d="M16 3.5 20.5 8 12 16.5 7.5 12 16 3.5Z" />
      </svg>
      <span
        style={{ backgroundColor: color ?? '#fff475' }}
        className="mt-[1px] h-[3px] w-[15px] rounded-[1px]"
      />
    </span>
  )
}
