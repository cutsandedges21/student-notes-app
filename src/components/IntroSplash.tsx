import { useEffect, useState } from 'react'
import { AppDocIcon } from '../editor/DocsIcons'

/**
 * The mark and the name, shown once when the app is first opened in a browser
 * session.
 *
 * Once per session rather than once per page: the app is a single-page router,
 * so navigating between notes must not replay it, and a returning visitor in
 * the same tab has already seen it. Closing the browser is what makes it new
 * again -- which is also what makes a shared link feel like an arrival rather
 * than a redirect.
 *
 * Deliberately holds nothing back: it renders over the app while the app is
 * already mounting behind it, so the wait it adds is the animation and nothing
 * more.
 */

const SESSION_KEY = 'margin:intro-seen'

/** Long enough to read the name, short enough not to be in the way. */
const HOLD_MS = 900
const FADE_MS = 320

/**
 * Whether the splash should play, decided once on mount.
 *
 * Read synchronously in the initial state rather than in an effect: doing it
 * after the first paint would flash the app for a frame before covering it.
 */
function shouldPlay(): boolean {
  try {
    if (sessionStorage.getItem(SESSION_KEY)) return false
    sessionStorage.setItem(SESSION_KEY, '1')
    return true
  } catch {
    // Private modes can refuse session storage. Skipping the splash is the
    // safe failure: showing it on every navigation would be worse than never.
    return false
  }
}

export function IntroSplash() {
  const [phase, setPhase] = useState<'visible' | 'leaving' | 'done'>(() =>
    shouldPlay() ? 'visible' : 'done',
  )

  useEffect(() => {
    if (phase !== 'visible') return
    const timer = window.setTimeout(() => setPhase('leaving'), HOLD_MS)
    return () => window.clearTimeout(timer)
  }, [phase])

  useEffect(() => {
    if (phase !== 'leaving') return
    const timer = window.setTimeout(() => setPhase('done'), FADE_MS)
    return () => window.clearTimeout(timer)
  }, [phase])

  if (phase === 'done') return null

  return (
    <div
      // Not a dialog and not an alert: it says nothing the reader must act on
      // or acknowledge, and announcing it would interrupt a screen reader on
      // its way to the note.
      aria-hidden="true"
      className={[
        'fixed inset-0 z-[100] grid place-items-center bg-surface',
        'transition-opacity duration-300 ease-out',
        phase === 'leaving' ? 'pointer-events-none opacity-0' : 'opacity-100',
      ].join(' ')}
    >
      <div className="flex flex-col items-center">
        <AppDocIcon className="h-12 w-[38px] text-ink" />
        <p className="mt-4 font-ui text-sm font-medium uppercase tracking-[0.42em] text-ink">
          {/* The tracking adds a trailing gap; the indent puts the word back
              on the centre line rather than a few pixels left of it. */}
          <span className="ml-[0.42em] inline-block">Margin</span>
        </p>
      </div>
    </div>
  )
}
