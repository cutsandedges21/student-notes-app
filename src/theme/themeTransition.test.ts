import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runThemeChange, willUseViewTransition } from './themeTransition'

/**
 * Three paths, and which one runs is the whole of this module's job. The
 * animations themselves are CSS and are not asserted here.
 */

const root = () => document.documentElement

/**
 * How far past the furthest corner the circle is expected to grow.
 *
 * Mirrors REVEAL_OVERSHOOT in themeTransition.ts. Deliberately restated rather
 * than imported: the point of the assertion is that the reveal overshoots at
 * all, and importing the constant would make the test agree with the source no
 * matter what the source said.
 */
const EXPECTED_OVERSHOOT = 1.25

function mockMotion(reduced: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? reduced : false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia
}

/**
 * Stands in for the API, which jsdom does not implement.
 *
 * Installed with defineProperty rather than by assignment: lib.dom types
 * `startViewTransition` as a required method with a wider signature than the
 * one this module needs, so a plain assignment does not typecheck and a plain
 * `delete` is rejected outright.
 */
function mockViewTransitions() {
  const skipTransition = vi.fn()
  const start = vi.fn().mockImplementation((cb: () => void) => {
    cb()
    return { finished: Promise.resolve(), skipTransition }
  })

  Object.defineProperty(document, 'startViewTransition', {
    value: start,
    configurable: true,
    writable: true,
  })

  return { start, skipTransition }
}

beforeEach(() => {
  mockMotion(false)
  vi.useFakeTimers()
  root().className = ''
  root().removeAttribute('data-theme-transition')
  root().removeAttribute('style')
})

afterEach(() => {
  vi.useRealTimers()
  Reflect.deleteProperty(document, 'startViewTransition')
})

describe('willUseViewTransition', () => {
  it('is false without the API, true with it', () => {
    expect(willUseViewTransition()).toBe(false)
    mockViewTransitions()
    expect(willUseViewTransition()).toBe(true)
  })

  it('is false under reduced motion even where the API exists', () => {
    mockViewTransitions()
    mockMotion(true)
    expect(willUseViewTransition()).toBe(false)
  })
})

describe('runThemeChange', () => {
  it('applies immediately under reduced motion, with no animation hooks', () => {
    mockViewTransitions()
    mockMotion(true)
    const apply = vi.fn()

    runThemeChange(apply, { x: 10, y: 10 })

    expect(apply).toHaveBeenCalledTimes(1)
    expect(root().hasAttribute('data-theme-transition')).toBe(false)
    expect(root().classList.contains('theme-transitioning')).toBe(false)
  })

  it('sweeps from the given origin when the API is available', () => {
    const { start } = mockViewTransitions()
    const apply = vi.fn()

    runThemeChange(apply, { x: 100, y: 50 })

    expect(start).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledTimes(1)
    expect(root().hasAttribute('data-theme-transition')).toBe(true)
    expect(root().style.getPropertyValue('--theme-origin-x')).toBe('100px')
    expect(root().style.getPropertyValue('--theme-origin-y')).toBe('50px')
  })

  it('grows past the furthest corner rather than stopping on it', () => {
    mockViewTransitions()
    /* From (0, 0) the furthest corner is the opposite one, so the distance to
       cover is the full diagonal of jsdom's 1024x768 viewport. */
    runThemeChange(() => undefined, { x: 0, y: 0 })

    const corner = Math.hypot(window.innerWidth, window.innerHeight)
    const actual = Number(root().style.getPropertyValue('--theme-reveal-r').replace('px', ''))

    /*
     * The overshoot is the fix for a measured stall: sized exactly to the
     * corner, the circle reached 96% of its radius in the first three quarters
     * of the animation and then crept the last forty pixels, so the sweep
     * appeared to stop just short and jump the rest when the transition ended.
     * Growing past the corner puts full coverage at a point where the edge is
     * still moving.
     */
    expect(actual).toBeGreaterThan(corner)
    expect(actual).toBeCloseTo(corner * EXPECTED_OVERSHOOT, 5)
  })

  it('cleans up after the sweep finishes', async () => {
    mockViewTransitions()
    runThemeChange(() => undefined, { x: 1, y: 1 })
    expect(root().hasAttribute('data-theme-transition')).toBe(true)

    await vi.waitFor(() => {
      expect(root().hasAttribute('data-theme-transition')).toBe(false)
    })
    expect(root().style.getPropertyValue('--theme-origin-x')).toBe('')
  })

  it('finishes a sweep still running when a second change arrives', () => {
    const { skipTransition } = mockViewTransitions()

    /* Back to back, with no chance to settle in between: toggling twice quickly
       should land on the second theme rather than queue behind the first
       animation. */
    runThemeChange(() => undefined, { x: 2, y: 2 })
    expect(skipTransition).not.toHaveBeenCalled()

    runThemeChange(() => undefined, { x: 3, y: 3 })
    expect(skipTransition).toHaveBeenCalledTimes(1)
  })

  it('falls back to a blanket colour transition without the API', () => {
    const apply = vi.fn()

    runThemeChange(apply, { x: 5, y: 5 })

    expect(apply).toHaveBeenCalledTimes(1)
    expect(root().classList.contains('theme-transitioning')).toBe(true)
    expect(root().hasAttribute('data-theme-transition')).toBe(false)

    /* Removed afterwards, or every hover in the app would inherit a 420ms
       colour transition for the rest of the session. */
    vi.advanceTimersByTime(500)
    expect(root().classList.contains('theme-transitioning')).toBe(false)
  })
})
