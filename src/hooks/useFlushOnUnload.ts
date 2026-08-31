import { useEffect } from 'react'

/**
 * Saves anything still pending when the page is going away.
 *
 * Autosave debounces for a second, so everything typed inside that window
 * lives only in the editor until the timer fires. React's unmount cleanup
 * covers navigating between notes, but a browser reload, a closed tab, or a
 * closed laptop tears the page down without running any of it -- so a sentence
 * finished a moment before Ctrl+R was simply gone. That is the moment a
 * student is most likely to reload, which made it a real way to lose work
 * rather than a theoretical one.
 *
 * Two events, because neither is sufficient alone:
 *
 * - `visibilitychange` to hidden is the one that reliably fires on mobile,
 *   where a backgrounded tab may be killed without further warning. It is also
 *   the earliest signal, which matters because it is the only one with any
 *   time left to finish work.
 * - `pagehide` covers the desktop reload and close, including a
 *   back/forward-cache eviction, which `beforeunload` does not.
 *
 * `beforeunload` is deliberately not used: registering it can disable the
 * back/forward cache in some browsers, and its only unique power -- blocking
 * navigation with a dialog -- is not something a notes app should do.
 *
 * ## What this can and cannot promise
 *
 * For guest notes it is a real guarantee: localStorage is synchronous, so the
 * write completes inside the handler.
 *
 * For signed-in notes it is best effort. The save is a network round trip, and
 * a browser tearing the page down will not wait for a promise. It usually
 * lands, because the request is already dispatched by the time the handler
 * returns, but it is not a promise the UI should make. Closing the gap
 * properly needs the request to survive the page, which means `sendBeacon` or
 * `fetch(..., { keepalive: true })` against an endpoint that accepts it --
 * tracked as follow-up work, not pretended at here.
 */
export function useFlushOnUnload(flush: () => Promise<void> | void): void {
  useEffect(() => {
    const run = () => {
      void flush()
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') run()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', run)

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', run)
    }
  }, [flush])
}
