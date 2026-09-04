import { useCallback, useEffect, useLayoutEffect, useRef, type MouseEvent } from 'react'
import { cn } from '../lib/cn'
import { useTheme } from './useTheme'
import { willUseViewTransition } from './themeTransition'

/**
 * The sun/moon switch.
 *
 * Animated from JavaScript rather than with the CSS classes the rest of the app
 * uses for motion, and deliberately so: the sun does not fade into a moon, it
 * *becomes* one. The rays spin as they retract into the disc, the disc grows,
 * and a second circle slides across it to carve the crescent out of a mask.
 * None of that is expressible as a transition between two declared states,
 * because the crescent is a geometric relationship between two moving circles
 * rather than a property with a start and an end value.
 *
 * The cost is understood. index.css argues -- correctly -- that transform and
 * opacity animations belong in CSS where the compositor can run them off the
 * main thread. This one is the exception rather than the new rule: it is a
 * single 20px icon, it writes attributes on ten nodes, and the loop stops the
 * moment the spring settles, so it is not competing with the editor for frames
 * except during the ~500ms somebody is watching it.
 *
 * Every value below is driven by one spring rather than a set of timed
 * keyframes, which is what makes an interrupted toggle behave: click twice
 * quickly and the disc reverses from wherever it had got to, at whatever speed
 * it was already moving, instead of snapping and restarting.
 */

/* Spring constants. Chosen for a small overshoot -- the disc rotates a little
   past its mark and settles back, which is what makes the flip feel thrown
   rather than driven. */
const STIFFNESS = 210
const DAMPING = 21
const REST_DISTANCE = 0.0005
const REST_VELOCITY = 0.0005

/* A frame after a stall (tab restored, long GC pause) can carry a dt of several
   seconds, which would fire the spring across the screen. Clamped to ~2 frames. */
const MAX_STEP = 1 / 30

const SUN = { r: 249, g: 171, b: 0 }
const MOON = { r: 174, g: 203, b: 250 }

const RAY_COUNT = 8
const CENTRE = 12

interface Spring {
  value: number
  velocity: number
  target: number
}

function stepSpring(spring: Spring, dt: number): boolean {
  const displacement = spring.value - spring.target
  const acceleration = -STIFFNESS * displacement - DAMPING * spring.velocity

  spring.velocity += acceleration * dt
  spring.value += spring.velocity * dt

  const settled =
    Math.abs(spring.value - spring.target) < REST_DISTANCE &&
    Math.abs(spring.velocity) < REST_VELOCITY

  if (settled) {
    spring.value = spring.target
    spring.velocity = 0
  }

  return settled
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value)

/** Eases the tail of a 0..1 window so stars arrive softly rather than popping. */
const easeOut = (t: number) => 1 - (1 - t) * (1 - t)

function mixColour(t: number): string {
  const clamped = clamp01(t)
  const r = Math.round(lerp(SUN.r, MOON.r, clamped))
  const g = Math.round(lerp(SUN.g, MOON.g, clamped))
  const b = Math.round(lerp(SUN.b, MOON.b, clamped))
  return `rgb(${r} ${g} ${b})`
}

/*
 * The four-point sparkle, drawn once at unit size and scaled per star. Quadratic
 * shoulders rather than straight edges: a diamond reads as a diamond, and it is
 * the pinched waist that reads as a twinkle.
 */
const SPARKLE =
  'M 0 -1 Q 0.16 -0.16 1 0 Q 0.16 0.16 0 1 Q -0.16 0.16 -1 0 Q -0.16 -0.16 0 -1 Z'

/* Position, size and phase per star. The phases are deliberately unrelated so
   the three never pulse in step, which is what would make them read as one
   flashing object rather than as a sky. */
const STARS = [
  { x: 4.6, y: 5.4, scale: 1.15, delay: 0.0, phase: 0.0 },
  { x: 19.2, y: 7.4, scale: 0.8, delay: 0.12, phase: 2.1 },
  { x: 18.1, y: 17.9, scale: 1.0, delay: 0.24, phase: 4.0 },
]

interface ThemeToggleProps {
  className?: string
  /** Rendered size in px. The geometry is a 24-unit viewBox, so this only scales. */
  size?: number
}

export function ThemeToggle({ className, size = 20 }: ThemeToggleProps) {
  const { isDark, toggle } = useTheme()

  const discRef = useRef<SVGCircleElement>(null)
  const biteRef = useRef<SVGCircleElement>(null)
  const haloRef = useRef<SVGCircleElement>(null)
  const rippleRef = useRef<SVGCircleElement>(null)
  const raysRef = useRef<SVGGElement>(null)
  const rayRefs = useRef<(SVGLineElement | null)[]>([])
  const starRefs = useRef<(SVGPathElement | null)[]>([])

  /* Animation state lives in refs, not React state: this loop writes attributes
     sixty times a second and a re-render per frame would be the one thing
     guaranteed to make it stutter. */
  const flip = useRef<Spring>({ value: isDark ? 1 : 0, velocity: 0, target: isDark ? 1 : 0 })
  const press = useRef<Spring>({ value: 0, velocity: 0, target: 0 })
  const ripple = useRef(0)
  const twinkle = useRef(0)
  const frame = useRef<number | null>(null)
  const lastTime = useRef(0)

  const reducedMotion =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false

  /**
   * Writes one frame of the animation.
   *
   * Everything is derived from `p` (0 = sun, 1 = moon) so the two halves can
   * never disagree about how far through the flip they are.
   */
  const paint = useCallback(() => {
    const p = flip.current.value
    const squash = press.current.value
    const colour = mixColour(p)

    /* Rays are gone by p = 0.62, well before the crescent finishes forming.
       Overlapping the two would give a spiked moon for a few frames. */
    const rayFade = clamp01(1 - p * 1.62)
    const spin = p * 205

    const rays = raysRef.current
    if (rays) {
      rays.setAttribute('transform', `rotate(${spin.toFixed(2)} ${CENTRE} ${CENTRE})`)
      rays.setAttribute('opacity', rayFade.toFixed(3))
      rays.setAttribute('stroke', colour)
    }

    /* Rays retract into the disc as they fade rather than only dimming: a ray
       that shortens is being drawn in, one that dims has been switched off. */
    const inner = lerp(7.4, 5.6, 1 - rayFade)
    const outer = lerp(10.1, 6.0, 1 - rayFade)

    for (let i = 0; i < RAY_COUNT; i += 1) {
      const line = rayRefs.current[i]
      if (!line) continue

      const angle = (i * (360 / RAY_COUNT) * Math.PI) / 180
      const sin = Math.sin(angle)
      const cos = Math.cos(angle)

      line.setAttribute('x1', (CENTRE + sin * inner).toFixed(2))
      line.setAttribute('y1', (CENTRE - cos * inner).toFixed(2))
      line.setAttribute('x2', (CENTRE + sin * outer).toFixed(2))
      line.setAttribute('y2', (CENTRE - cos * outer).toFixed(2))
    }

    const disc = discRef.current
    if (disc) {
      /*
       * Scaled about the centre, and deliberately not rotated.
       *
       * A circle is rotationally symmetric, so spinning the disc would spin
       * nothing except the crescent cut out of it -- which at the spring's
       * 205 degrees would leave the finished moon opening down and to the left.
       * The rays carry the spin instead, which is where it is visible anyway.
       */
      const scale = 1 - squash * 0.12
      disc.setAttribute('r', lerp(5.0, 6.45, clamp01(p)).toFixed(3))
      disc.setAttribute('fill', colour)
      disc.setAttribute(
        'transform',
        `translate(${CENTRE} ${CENTRE}) scale(${scale.toFixed(4)}) translate(${-CENTRE} ${-CENTRE})`,
      )
    }

    /*
     * The crescent.
     *
     * A second circle punched out of the disc's mask. At rest it sits far off
     * the icon, so the sun is a whole disc; as p rises it slides in from the
     * upper right until it has eaten most of the disc. Moving the *cutter*
     * rather than morphing a path is what makes the crescent thicken smoothly.
     */
    const bite = biteRef.current
    if (bite) {
      const t = easeOut(clamp01((p - 0.18) / 0.82))
      bite.setAttribute('cx', lerp(30, 16.4, t).toFixed(2))
      bite.setAttribute('cy', lerp(-4, 7.9, t).toFixed(2))
      bite.setAttribute('r', lerp(7.4, 5.75, t).toFixed(2))
    }

    /* A glow the sun has and the moon mostly does not. */
    const halo = haloRef.current
    if (halo) {
      halo.setAttribute('r', lerp(8.6, 10.4, p).toFixed(2))
      halo.setAttribute('opacity', (lerp(0.26, 0.13, p) * (1 - squash * 0.5)).toFixed(3))
      halo.setAttribute('fill', colour)
    }

    /* The ring thrown off by a click. Independent of the spring so it reads as
       a consequence of the press, not of the disc arriving. */
    const ring = rippleRef.current
    if (ring) {
      const r = ripple.current
      ring.setAttribute('r', lerp(6.5, 15.5, 1 - r).toFixed(2))
      ring.setAttribute('opacity', (r * 0.5).toFixed(3))
      ring.setAttribute('stroke', colour)
    }

    for (let i = 0; i < STARS.length; i += 1) {
      const node = starRefs.current[i]
      const star = STARS[i]
      if (!node || !star) continue

      /* Staggered: each star waits its turn, so three arrive as a sequence
         rather than as one three-pointed shape appearing at once. */
      const entry = easeOut(clamp01((p - 0.52 - star.delay) / (0.48 - star.delay)))
      const pulse = 1 + Math.sin(twinkle.current * 3.1 + star.phase) * 0.18 * entry
      const scale = star.scale * entry * pulse

      node.setAttribute(
        'transform',
        `translate(${star.x} ${star.y}) rotate(${(entry * 90 - 90).toFixed(1)}) scale(${scale.toFixed(3)})`,
      )
      node.setAttribute('opacity', entry.toFixed(3))
      node.setAttribute('fill', colour)
    }
  }, [])

  /** Starts the loop if it is not already running. */
  const ensureRunning = useCallback(() => {
    if (frame.current !== null) return

    lastTime.current = performance.now()

    const tick = (now: number) => {
      const dt = Math.min((now - lastTime.current) / 1000, MAX_STEP)
      lastTime.current = now

      const flipSettled = stepSpring(flip.current, dt)
      const pressSettled = stepSpring(press.current, dt)

      ripple.current = Math.max(0, ripple.current - dt * 1.9)
      twinkle.current += dt

      /* The twinkle is not a permanent loop. Left running it would hold a
         requestAnimationFrame open for as long as the app was dark, on a page
         whose whole job is to stay responsive while somebody types. It runs for
         a beat after the moon lands and then the icon goes still. */
      const twinkling = flip.current.target === 1 && twinkle.current < 2.6

      paint()

      if (flipSettled && pressSettled && ripple.current === 0 && !twinkling) {
        frame.current = null
        return
      }

      frame.current = requestAnimationFrame(tick)
    }

    frame.current = requestAnimationFrame(tick)
  }, [paint])

  /*
   * Drive the spring from the store, so the icon is correct even when the theme
   * changes somewhere else -- the View menu, or the OS at sunset.
   *
   * A layout effect rather than a passive one. The store performs the change
   * inside a view transition and flushes React synchronously so the "after"
   * texture contains the new icon; only layout effects are guaranteed to have
   * run by the time that flush returns.
   */
  useLayoutEffect(() => {
    const target = isDark ? 1 : 0
    if (flip.current.target === target) return

    flip.current.target = target
    twinkle.current = 0

    /* Snap, in the two cases where springing would be wrong: somebody who has
       asked for less motion, and a page sweep that is about to photograph this
       icon and would catch it mid-flight. */
    if (reducedMotion || willUseViewTransition()) {
      flip.current.value = target
      flip.current.velocity = 0
      ripple.current = 0
      paint()
      return
    }

    ripple.current = 1
    ensureRunning()
  }, [isDark, ensureRunning, paint, reducedMotion])

  /* First paint: put the icon in the right state before anybody sees it. */
  useEffect(() => {
    paint()
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
    }
  }, [paint])

  const setPress = (down: boolean) => {
    if (reducedMotion) return
    press.current.target = down ? 1 : 0
    ensureRunning()
  }

  /**
   * Hands the page reveal the centre of this button, so the new theme sweeps
   * out from under the pointer rather than from an arbitrary corner. Measured
   * at click time rather than cached: the toolbar scrolls sideways on a narrow
   * screen, so the button's position is not fixed for the life of the page.
   */
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    toggle({ x: box.left + box.width / 2, y: box.top + box.height / 2 })
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label="Dark mode"
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      onClick={handleClick}
      onPointerDown={() => setPress(true)}
      onPointerUp={() => setPress(false)}
      onPointerLeave={() => setPress(false)}
      onPointerCancel={() => setPress(false)}
      className={cn(
        /* `theme-toggle` is a hook for index.css, not a style: it is how the
           button opts out of the blanket colour transition during a theme
           change, and how it gets its own view-transition name. */
        'theme-toggle',
        'grid h-9 w-9 shrink-0 place-items-center rounded-full',
        'text-docs-icon transition-colors hover:bg-docs-chrome-hover',
        className,
      )}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        /* Overflow is visible so the ripple can leave the icon's own box
           without being clipped by the viewBox. */
        style={{ overflow: 'visible' }}
      >
        <defs>
          {/*
            White shows the disc, black punches the crescent out of it. The mask
            has to be bigger than the disc or the bite would be clipped on its
            way in from off-canvas.
          */}
          <mask id="theme-toggle-crescent">
            <rect x="-6" y="-6" width="36" height="36" fill="black" />
            <circle cx={CENTRE} cy={CENTRE} r="11" fill="white" />
            <circle ref={biteRef} cx="30" cy="-4" r="7.4" fill="black" />
          </mask>
        </defs>

        <circle ref={haloRef} cx={CENTRE} cy={CENTRE} r="8.6" opacity="0.26" />

        <circle
          ref={rippleRef}
          cx={CENTRE}
          cy={CENTRE}
          r="6.5"
          fill="none"
          strokeWidth="1.4"
          opacity="0"
        />

        <g ref={raysRef} strokeWidth="1.9" strokeLinecap="round">
          {Array.from({ length: RAY_COUNT }, (_, i) => (
            <line
              key={i}
              ref={(node) => {
                rayRefs.current[i] = node
              }}
            />
          ))}
        </g>

        <circle
          ref={discRef}
          cx={CENTRE}
          cy={CENTRE}
          r="5"
          mask="url(#theme-toggle-crescent)"
        />

        {STARS.map((star, i) => (
          <path
            key={i}
            ref={(node) => {
              starRefs.current[i] = node
            }}
            d={SPARKLE}
            opacity="0"
            transform={`translate(${star.x} ${star.y}) scale(0)`}
          />
        ))}
      </svg>
    </button>
  )
}
