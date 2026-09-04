import { useLayoutEffect, useRef, type ReactNode } from 'react'

/**
 * Height that glides open and shut.
 *
 * Switching to viewing strips the chrome -- title bar, toolbar, ruler -- and
 * mounting or unmounting those makes the page jump by a couple of hundred
 * pixels. What should read as furniture getting out of the way instead reads
 * as a reload.
 *
 * Animated from JavaScript rather than by transitioning a CSS property, which
 * was the first attempt and did not work here. A transition needs the browser
 * to have seen a previous value on that exact element, and these elements are
 * recreated as the surrounding chrome re-renders -- so every switch handed the
 * browser a fresh node with nothing to move from, and it snapped. Driving the
 * animation explicitly does not care: the effect runs after the node exists,
 * measures it, and animates it whether or not it is the same node as last time.
 *
 * The child stays mounted while closed. That is deliberate for the toolbar: it
 * holds the editor's live state, and remounting it on every mode change would
 * throw away every dropdown, measurement and observer inside it.
 */

const DURATION_MS = 320
/** The same curve as `--ease-out`, so this matches the rest of the app. */
const EASING = 'cubic-bezier(0.2, 0, 0, 1)'

export function Collapse({
  open,
  children,
  className,
}: {
  open: boolean
  children: ReactNode
  className?: string
}) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  /*
   * What the last run left the element showing.
   *
   * `undefined` means this node has not been animated yet, which is either the
   * first render or a fresh node after a remount. Either way it should settle
   * into position rather than animate from nothing, or the toolbar would slide
   * in every time something unrelated re-rendered.
   */
  const shown = useRef<boolean | undefined>(undefined)

  useLayoutEffect(() => {
    const node = outer.current
    const content = inner.current
    if (!node || !content) return

    const settle = () => {
      // `auto` once open, so the toolbar can still change height afterwards --
      // wrapping onto a second row on a narrow window, for instance.
      node.style.height = open ? 'auto' : '0px'
      node.style.opacity = open ? '1' : '0'
    }

    if (shown.current === open) {
      settle()
      return
    }

    const first = shown.current === undefined
    shown.current = open

    if (first) {
      settle()
      return
    }

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    if (reduced || typeof node.animate !== 'function') {
      settle()
      return
    }

    // Measured rather than assumed: `scrollHeight` is what the content wants,
    // and the current box is wherever an interrupted animation had got to.
    const from = node.getBoundingClientRect().height
    const to = open ? content.scrollHeight : 0

    const animation = node.animate(
      [
        { height: `${from}px`, opacity: open ? 0 : 1 },
        { height: `${to}px`, opacity: open ? 1 : 0 },
      ],
      { duration: DURATION_MS, easing: EASING, fill: 'both' },
    )

    animation.finished
      .then(() => {
        // Hand the box back to CSS, or it stays pinned at the pixel height it
        // was measured at and stops responding to its own content.
        animation.cancel()
        settle()
      })
      .catch(() => {
        // Cancelled by the next toggle, which has already taken over.
      })

    return () => animation.cancel()
  }, [open])

  return (
    <div
      ref={outer}
      // Hidden from assistive technology and from tabbing when closed: the
      // chrome is not merely invisible, it is unavailable in this mode.
      aria-hidden={!open}
      inert={!open ? true : undefined}
      className={className}
      style={{ overflow: 'hidden', height: open ? 'auto' : 0, opacity: open ? 1 : 0 }}
    >
      <div ref={inner}>{children}</div>
    </div>
  )
}
