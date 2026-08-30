import { useEffect, useState } from 'react'

/**
 * Tracks a CSS media query from JavaScript.
 *
 * Needed where a breakpoint has to change behaviour rather than only
 * appearance: the AI panel is rendered twice (docked and as a drawer) and
 * hidden with `lg:` classes, so both copies exist in the DOM at every width.
 * That is fine for layout and wrong for anything that fires a request, which
 * is why the panels ask which of them is actually on screen.
 *
 * Guarded for jsdom, which does not implement matchMedia.
 */
export function useMediaQuery(query: string): boolean {
  const supported = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  const [matches, setMatches] = useState(() => (supported ? window.matchMedia(query).matches : false))

  useEffect(() => {
    if (!supported) return

    const list = window.matchMedia(query)
    const update = () => setMatches(list.matches)

    update()
    list.addEventListener('change', update)
    return () => list.removeEventListener('change', update)
  }, [query, supported])

  return matches
}
