/**
 * The light/dark change itself, as an animation.
 *
 * Flipping the `dark` class rewrites every colour variable at once, so without
 * this the whole app snaps between two states in a single frame. That snap is
 * the jarring part of a theme switch -- not the icon, the page.
 *
 * Two strategies, because they are good at different things:
 *
 * 1. The View Transitions API, where supported. The browser takes a GPU texture
 *    of the page before and after, and we reveal the new one through a circle
 *    growing from the button that was clicked. Nothing is re-rendered while it
 *    plays, so it runs at full frame rate on a document of any size -- and it
 *    animates things CSS transitions cannot reach, like an <img> or an SVG fill
 *    written as an attribute.
 *
 * 2. A transition on every colour property, everywhere, for the duration of the
 *    change. This is the fallback for browsers without the API (Firefox, Safari
 *    before 18). It is genuinely smooth but it is main-thread work proportional
 *    to the size of the DOM, which is why it is second choice rather than first.
 *
 * Reduced motion gets neither. A theme change is a change of state, and it
 * still happens; it simply happens immediately.
 */

/*
 * How far past the furthest corner the circle keeps growing.
 *
 * Sized exactly to the corner, the screen is only fully covered on the very
 * last frame -- and with any decelerating ease the circle spends its final
 * stretch creeping the last few pixels while a sliver of the old theme is still
 * showing in the corner. It reads as the sweep stopping just short and then
 * jumping the rest of the way when the transition tears down.
 *
 * Growing past the corner means coverage is complete while the circle is still
 * moving at speed. The extra travel happens off-screen, where there is nothing
 * left to reveal and nothing to see.
 */
const REVEAL_OVERSHOOT = 1.25

/* The sweep's own duration and easing live in index.css, next to the keyframes
   they belong to. Only the fallback's is needed here, to time the class off. */
const FALLBACK_MS = 420

/** Marks the document while a themed view transition is running, so the CSS
 *  below applies to this transition and not to any other the app might add. */
const TRANSITION_ATTR = 'data-theme-transition'
const FALLBACK_CLASS = 'theme-transitioning'

export interface TransitionOrigin {
  x: number
  y: number
}

/*
 * `startViewTransition` is newer than the DOM types this project builds
 * against, so it is declared rather than cast away at each call site.
 */
interface ViewTransition {
  finished: Promise<void>
  skipTransition: () => void
}

type StartViewTransition = (callback: () => void | Promise<void>) => ViewTransition

function viewTransitionApi(): StartViewTransition | null {
  if (typeof document === 'undefined') return null
  const start = (document as Document & { startViewTransition?: StartViewTransition })
    .startViewTransition
  return typeof start === 'function' ? start.bind(document) : null
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * How big the circle grows: past the furthest corner of the viewport, by
 * REVEAL_OVERSHOOT.
 *
 * The corner has to be the reference rather than the nearest edge, or the sweep
 * would finish with a wedge of the old theme still showing.
 */
function revealRadius({ x, y }: TransitionOrigin): number {
  const w = window.innerWidth
  const h = window.innerHeight
  return Math.hypot(Math.max(x, w - x), Math.max(y, h - y)) * REVEAL_OVERSHOOT
}

let active: ViewTransition | null = null
let fallbackTimer: ReturnType<typeof setTimeout> | null = null

/** True while a themed view transition is on screen. */
export function isTransitioning(): boolean {
  return active !== null
}

/**
 * Whether the next theme change will be carried by a view transition.
 *
 * The toggle asks before deciding how to move its own icon: during a sweep the
 * icon is a still frame in two GPU textures, so a spring would be captured
 * mid-flight and then jump. Answering this before the change starts -- rather
 * than checking whether one is currently running -- is what lets the icon be in
 * its final state by the time the "after" texture is taken.
 */
export function willUseViewTransition(): boolean {
  return !prefersReducedMotion() && viewTransitionApi() !== null
}

/**
 * Applies a theme change, animated.
 *
 * `apply` must do the whole change synchronously -- the API captures the "after"
 * texture the moment it returns, so anything left until later is captured in its
 * old state and then pops when the transition ends.
 */
export function runThemeChange(apply: () => void, origin?: TransitionOrigin): void {
  if (typeof document === 'undefined' || prefersReducedMotion()) {
    apply()
    return
  }

  const start = viewTransitionApi()
  if (!start) {
    runFallback(apply)
    return
  }

  const root = document.documentElement

  /*
   * Centre of the control that was clicked, defaulting to the top-right corner
   * where both toggles live. A wipe has to come from somewhere; starting it
   * under the pointer is what makes it read as caused by the click rather than
   * as something the page decided to do.
   */
  const point = origin ?? { x: window.innerWidth - 80, y: 56 }

  root.style.setProperty('--theme-origin-x', `${point.x}px`)
  root.style.setProperty('--theme-origin-y', `${point.y}px`)
  root.style.setProperty('--theme-reveal-r', `${revealRadius(point)}px`)
  root.setAttribute(TRANSITION_ATTR, '')

  /* A second click mid-sweep finishes the first immediately rather than
     queueing behind it. Without this, toggling twice quickly leaves the second
     change waiting on an animation the user has already moved past. */
  active?.skipTransition()

  const transition = start(apply)
  active = transition

  void transition.finished
    .catch(() => undefined)
    .finally(() => {
      if (active === transition) {
        active = null
        root.removeAttribute(TRANSITION_ATTR)
        root.style.removeProperty('--theme-origin-x')
        root.style.removeProperty('--theme-origin-y')
        root.style.removeProperty('--theme-reveal-r')
      }
    })
}

/**
 * No View Transitions: cross-fade every colour instead.
 *
 * The class is added before the change and removed after, rather than left on
 * permanently. A blanket colour transition that never comes off would apply to
 * every hover and focus in the app as well -- turning a 150ms button hover into
 * a 420ms one, everywhere.
 */
function runFallback(apply: () => void): void {
  const root = document.documentElement

  root.classList.add(FALLBACK_CLASS)
  apply()

  if (fallbackTimer !== null) clearTimeout(fallbackTimer)
  fallbackTimer = setTimeout(() => {
    root.classList.remove(FALLBACK_CLASS)
    fallbackTimer = null
  }, FALLBACK_MS)
}

