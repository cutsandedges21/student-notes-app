import type { ReactNode } from 'react'

/**
 * Height that animates without anybody measuring anything.
 *
 * Switching to viewing strips the chrome -- title bar, toolbar, ruler -- and
 * mounting or unmounting those makes the page jump by a couple of hundred
 * pixels. What should read as the furniture getting out of the way instead
 * reads as a reload.
 *
 * A grid whose single row goes from `0fr` to `1fr` is what makes this work.
 * `height: auto` is famously not animatable, and the usual answers are a
 * hard-coded max-height that has to be kept larger than the content, or a
 * measuring pass in JavaScript that runs on every resize. A fractional row
 * resolves to the content's real height and interpolates, so the toolbar
 * collapses to exactly nothing and expands to exactly itself, whatever it
 * happens to contain.
 *
 * The child stays mounted while closed. That is deliberate for the toolbar: it
 * holds the editor's live state, and remounting it on every mode change would
 * throw away every dropdown, measurement and observer inside it.
 */
export function Collapse({
  open,
  children,
  className,
}: {
  open: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <div
      // Hidden from assistive technology and from tabbing when closed: the
      // chrome is not merely invisible, it is not available in this mode.
      aria-hidden={!open}
      inert={!open ? true : undefined}
      className={className}
      style={{
        display: 'grid',
        gridTemplateRows: open ? '1fr' : '0fr',
        opacity: open ? 1 : 0,
        transition:
          'grid-template-rows var(--dur-slow) var(--ease-out), opacity var(--dur) var(--ease-out)',
      }}
    >
      {/* The row's overflow has to be hidden here rather than on the parent,
          or the content keeps its own height and simply spills. */}
      <div style={{ overflow: 'hidden', minHeight: 0 }}>{children}</div>
    </div>
  )
}
