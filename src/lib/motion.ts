/**
 * Scripted transitions, for the moves CSS cannot express.
 *
 * Most motion in the app is a CSS class, because a class is enough when an
 * element simply arrives or leaves. This is for the case that is not: the
 * assistant moving between the bar under the page and the column beside it.
 * Those are two different components in two different places in the tree, so
 * one unmounts as the other mounts. CSS can animate neither -- an element
 * removed from the DOM takes its animation with it, and the arriving one has
 * no idea where the departing one was.
 *
 * The Web Animations API is what makes it a move rather than two unrelated
 * fades: the exit can be awaited, so the entrance starts when the exit lands,
 * and the departing surface can be sent toward the place the new one will
 * appear. It also animates the same two compositor properties CSS would --
 * transform and opacity -- so this costs no more than a class would.
 */

/**
 * The on-screen element matching a selector.
 *
 * Surfaces here are mounted more than once -- the assistant's panel exists as
 * both a docked column and a drawer, and the breakpoint decides which is
 * showing. Animating the first match would as often as not animate the hidden
 * one, which looks from the outside like the animation simply not running.
 */
export function visible(selector: string): Element | null {
  for (const element of document.querySelectorAll(selector)) {
    const rect = element.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) return element
  }
  return null
}

/** Matches `--ease-out` in the stylesheet, so scripted moves share the curve. */
const EASE_OUT = 'cubic-bezier(0.2, 0, 0, 1)'

function reducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

/**
 * Plays an animation and resolves when it finishes.
 *
 * Resolves rather than rejects if the animation is cancelled -- a surface
 * unmounted mid-move is a normal outcome here, and the caller's next step
 * should still run. Under reduced motion it resolves immediately, having
 * animated nothing.
 */
async function play(
  element: Element | null | undefined,
  keyframes: Keyframe[],
  duration: number,
): Promise<void> {
  if (!element || reducedMotion() || typeof element.animate !== 'function') return

  try {
    await element.animate(keyframes, {
      duration,
      easing: EASE_OUT,
      fill: 'both',
    }).finished
  } catch {
    // Cancelled, which happens whenever the element goes away first.
  }
}

/**
 * Sends a surface off toward where its replacement will appear.
 *
 * The direction is the point: a bar that shrinks toward the side panel reads
 * as the same assistant moving, where a bar that simply faded would read as
 * one thing closing and an unrelated thing opening.
 */
export function flyOut(element: Element | null | undefined, towards: 'left' | 'right') {
  const x = towards === 'left' ? -40 : 40
  return play(
    element,
    [
      { opacity: 1, transform: 'translate(-50%, 0) scale(1)' },
      { opacity: 0, transform: `translate(-50%, 8px) scale(0.92) translateX(${x}px)` },
    ],
    180,
  )
}

/** Brings a surface in from the edge it came from. */
export function flyIn(element: Element | null | undefined, from: 'left' | 'right') {
  const x = from === 'left' ? -24 : 24
  return play(
    element,
    [
      { opacity: 0, transform: `translateX(${x}px)` },
      { opacity: 1, transform: 'none' },
    ],
    260,
  )
}

/** The docked bar arriving back under the page. */
export function riseIn(element: Element | null | undefined) {
  return play(
    element,
    [
      { opacity: 0, transform: 'translate(-50%, 14px) scale(0.94)' },
      { opacity: 1, transform: 'translate(-50%, 0) scale(1)' },
    ],
    260,
  )
}

/**
 * Waits for the browser to have laid out whatever React just rendered.
 *
 * Two frames, not one: the first is where React commits, and measuring or
 * animating in that same frame catches the element before it has a box.
 */
export function afterPaint(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  )
}
