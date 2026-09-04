import { useEffect, useRef, useState } from 'react'

/**
 * A value that springs toward a target.
 *
 * For controls that can be hit again before they have settled. A CSS
 * transition restarts from wherever it was but always at its declared
 * duration, so a toggle flipped twice quickly moves back at the same speed it
 * moved out, which reads as sluggish. A spring carries its velocity: reverse it
 * mid-flight and it whips back, because it was already moving.
 *
 * The loop stops the moment the spring settles, so an idle control costs
 * nothing. Under reduced motion it does not animate at all -- the value simply
 * is the target.
 */

/* Tuned for a small overshoot: the knob passes its mark and settles back,
   which is what makes a switch feel thrown rather than driven. */
const STIFFNESS = 260
const DAMPING = 24
const REST_DISTANCE = 0.001
const REST_VELOCITY = 0.001

/**
 * A frame after a stall -- a restored tab, a long pause -- can carry a delta of
 * seconds, which would fire the spring off the screen. Clamped to about two
 * frames.
 */
const MAX_STEP = 1 / 30

export function useSpring(target: number): number {
  const [value, setValue] = useState(target)
  const state = useRef({ value: target, velocity: 0 })
  const frame = useRef<number | null>(null)

  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    if (reduced) {
      state.current = { value: target, velocity: 0 }
      setValue(target)
      return
    }

    let last = performance.now()

    const step = (now: number) => {
      const dt = Math.min((now - last) / 1000, MAX_STEP)
      last = now

      const spring = state.current
      const displacement = spring.value - target
      const acceleration = -STIFFNESS * displacement - DAMPING * spring.velocity

      spring.velocity += acceleration * dt
      spring.value += spring.velocity * dt

      const settled =
        Math.abs(spring.value - target) < REST_DISTANCE &&
        Math.abs(spring.velocity) < REST_VELOCITY

      if (settled) {
        spring.value = target
        spring.velocity = 0
        setValue(target)
        frame.current = null
        return
      }

      setValue(spring.value)
      frame.current = requestAnimationFrame(step)
    }

    frame.current = requestAnimationFrame(step)
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
    }
  }, [target])

  return value
}
