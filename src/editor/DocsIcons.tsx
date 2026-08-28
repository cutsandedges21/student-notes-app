/**
 * The handful of chrome icons lucide doesn't carry, plus the two that have to
 * render a live colour swatch underneath the glyph.
 *
 * Everything here is drawn from scratch on a 24x24 grid so it lines up with
 * the lucide icons it sits beside in the toolbar. Nothing is copied from
 * Google's icon set -- these are our own paths in the same silhouette.
 */

interface IconProps {
  className?: string
  size?: number
}

/**
 * The app mark, shaped like the document icon that anchors the title row.
 */
export function AppDocIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 32" className={className} aria-hidden="true" focusable="false">
      <path
        d="M3 0h12l9 9v20a3 3 0 0 1-3 3H3a3 3 0 0 1-3-3V3a3 3 0 0 1 3-3Z"
        fill="#1a73e8"
      />
      <path d="M15 0l9 9h-9V0Z" fill="#a8c7fa" />
      <rect x="5" y="14" width="14" height="1.8" rx=".9" fill="#fff" />
      <rect x="5" y="18" width="14" height="1.8" rx=".9" fill="#fff" />
      <rect x="5" y="22" width="9" height="1.8" rx=".9" fill="#fff" />
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
        <linearGradient id="margin-spark" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#4285f4" />
          <stop offset="45%" stopColor="#9b72cb" />
          <stop offset="100%" stopColor="#d96570" />
        </linearGradient>
      </defs>
      <path
        fill="url(#margin-spark)"
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
