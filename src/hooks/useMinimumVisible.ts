import { useEffect, useRef, useState } from 'react'

/**
 * Keeps a transient indicator on screen for a minimum stretch once it appears.
 *
 * A loading state that resolves in 40ms is worse than none at all: it reads as
 * a flicker rather than as feedback, and on a fast connection it fires on every
 * navigation. Holding it briefly turns the flicker into a deliberate beat, at
 * the cost of a few tens of milliseconds on loads that were already quick.
 *
 * Only the *tail* is padded. The indicator still appears the instant `active`
 * turns true, so nothing is ever delayed by this.
 *
 * @param active     Whether the underlying work is still in flight.
 * @param minimumMs  How long the indicator stays up once it has appeared.
 */
export function useMinimumVisible(active: boolean, minimumMs: number): boolean {
  /** True only during the tail, after the work finished but before the hold. */
  const [held, setHeld] = useState(false)
  /** When the current showing began, or null while nothing is showing. */
  const shownAt = useRef<number | null>(null)

  useEffect(() => {
    if (active) {
      // Clocks are read here rather than during render: the ref initialiser
      // runs on every render, so reading the time there would make the
      // component impure for a value only the first render can use.
      shownAt.current ??= Date.now()
      return
    }

    const startedAt = shownAt.current
    // Never shown, so there is nothing to hold.
    if (startedAt === null) return

    const remaining = minimumMs - (Date.now() - startedAt)
    if (remaining <= 0) {
      shownAt.current = null
      setHeld(false)
      return
    }

    setHeld(true)
    const timer = setTimeout(() => {
      shownAt.current = null
      setHeld(false)
    }, remaining)
    return () => clearTimeout(timer)
  }, [active, minimumMs])

  // Derived rather than stored, so turning `active` on shows the indicator in
  // the same render instead of one paint later.
  return active || held
}
