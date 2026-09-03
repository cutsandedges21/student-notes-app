import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ThemeToggle } from './ThemeToggle'
import { resetThemeStoreForTests } from './themeStore'

/**
 * The animation itself is not asserted here -- a spring settling over ~500ms of
 * requestAnimationFrame is not something jsdom can meaningfully run, and
 * pinning exact attribute values would only lock in the current easing.
 *
 * What is worth holding: the control is a switch, it reports the theme it is
 * showing, clicking it changes the document, and it does not throw while
 * painting a frame into jsdom's SVG implementation.
 */
function mockMatchMedia({ dark = false, reduced = false } = {}) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('prefers-reduced-motion')
      ? reduced
      : query.includes('dark')
        ? dark
        : false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia
}

beforeEach(() => {
  resetThemeStoreForTests()
  localStorage.clear()
  document.documentElement.classList.remove('dark')
  mockMatchMedia()
})

describe('ThemeToggle', () => {
  it('renders as a switch reporting the current theme', () => {
    render(<ThemeToggle />)

    const toggle = screen.getByRole('switch', { name: 'Dark mode' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(toggle).toHaveAttribute('title', 'Switch to dark mode')
  })

  it('turns the document dark when clicked, and back', () => {
    render(<ThemeToggle />)
    const toggle = screen.getByRole('switch', { name: 'Dark mode' })

    fireEvent.click(toggle)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect(toggle).toHaveAttribute('title', 'Switch to light mode')

    fireEvent.click(toggle)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(toggle).toHaveAttribute('aria-checked', 'false')
  })

  it('starts on the moon when the OS is already dark', () => {
    mockMatchMedia({ dark: true })
    render(<ThemeToggle />)

    expect(screen.getByRole('switch', { name: 'Dark mode' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('still switches with reduced motion, skipping the animation', () => {
    mockMatchMedia({ reduced: true })
    const raf = vi.spyOn(window, 'requestAnimationFrame')

    render(<ThemeToggle />)
    fireEvent.click(screen.getByRole('switch', { name: 'Dark mode' }))

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    /* The spring is skipped entirely rather than run fast: somebody who has
       asked for less motion should not get a 500ms icon, only a shorter one. */
    expect(raf).not.toHaveBeenCalled()

    raf.mockRestore()
  })

  it('writes valid geometry on every animated node', async () => {
    render(<ThemeToggle />)
    fireEvent.click(screen.getByRole('switch', { name: 'Dark mode' }))

    /* Two real frames through jsdom's SVG nodes, which is what surfaces a NaN
       in the geometry -- the failure mode of a spring driven by a bad dt, and
       one that renders as a silently invisible icon rather than as an error. */
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))

    const numeric = ['circle[mask]', 'line', 'path']
      .flatMap((selector) => [...document.querySelectorAll(selector)])
      .flatMap((node) => ['r', 'x1', 'y1', 'x2', 'y2', 'opacity']
        .map((attribute) => node.getAttribute(attribute))
        .filter((value): value is string => value !== null))

    expect(numeric.length).toBeGreaterThan(0)
    for (const value of numeric) expect(Number.isNaN(Number(value))).toBe(false)

    const disc = document.querySelector('circle[mask]')
    expect(Number(disc?.getAttribute('r'))).toBeGreaterThan(0)
    /* The crescent's cutter has started moving in from off-canvas. */
    const bite = document.querySelector('mask circle[fill="black"]')
    expect(Number(bite?.getAttribute('cx'))).toBeLessThan(30)
  })
})
