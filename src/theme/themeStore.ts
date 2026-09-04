/**
 * Theme state.
 *
 * A module-level store rather than a React context, for two reasons. The theme
 * is genuinely global -- one `class` on one `<html>` element -- so a provider
 * would only be re-deriving a singleton and passing it down a tree that already
 * has the answer available from `document`. And a context would force every
 * component that reads it to be mounted under a provider, which would mean
 * wrapping every existing test that renders a piece of chrome in isolation.
 *
 * Three preferences, two outcomes: `system` follows the OS and re-resolves when
 * the OS changes, which is why the resolved value is stored separately from the
 * preference rather than computed at the call site.
 */

import { flushSync } from 'react-dom'
import {
  runThemeChange,
  willUseViewTransition,
  type TransitionOrigin,
} from './themeTransition'

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'
export type { TransitionOrigin }

/**
 * Shared with the pre-paint script in index.html, which reads the same key
 * before React exists. Change one and you must change the other, or the page
 * will paint light and then jump to dark on hydration.
 */
export const THEME_STORAGE_KEY = 'margin:theme'

const DARK_QUERY = '(prefers-color-scheme: dark)'

export interface ThemeSnapshot {
  preference: ThemePreference
  resolved: ResolvedTheme
}

function isPreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

export function readStoredPreference(): ThemePreference {
  if (typeof localStorage === 'undefined') return 'system'
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return isPreference(stored) ? stored : 'system'
  } catch {
    /* Safari in private mode throws on any localStorage access. The theme is
       decoration; it must never be the reason the app fails to start. */
    return 'system'
  }
}

export function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light'
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

export function resolveTheme(preference: ThemePreference, system: ResolvedTheme): ResolvedTheme {
  return preference === 'system' ? system : preference
}

/**
 * Writes the theme to the document.
 *
 * `color-scheme` is not cosmetic duplication of the class: it is what tells the
 * browser to render form controls, scrollbars and the `::-webkit` chrome dark.
 * Without it a dark page keeps a bright white scrollbar down its edge.
 */
export function applyTheme(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
  root.style.colorScheme = resolved
}

/*
 * The snapshot is cached rather than built per call. `useSyncExternalStore`
 * compares snapshots by identity, so returning a fresh object every time would
 * make React re-render forever.
 */
let snapshot: ThemeSnapshot = { preference: 'system', resolved: 'light' }
let initialised = false

const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

/** Writes the change and tells React, with no animation around it. */
function write(preference: ThemePreference, resolved: ResolvedTheme, sync: boolean) {
  snapshot = { preference, resolved }
  applyTheme(resolved)

  /*
   * A view transition captures the "after" texture the instant its callback
   * returns, and React's updates are asynchronous. Without flushSync the toggle
   * would re-render after that capture -- photographed still showing the old
   * icon, then popping to the new one when the sweep ended.
   *
   * Only on that path. flushSync is a real cost and, worse, throws if it lands
   * during a render; `settle` below is called from exactly that position.
   */
  if (sync) flushSync(emit)
  else emit()
}

/**
 * A theme change the user asked for, animated.
 *
 * Not used for the initial read: see `settle`.
 */
function commit(
  preference: ThemePreference,
  system: ResolvedTheme,
  origin?: TransitionOrigin,
) {
  const resolved = resolveTheme(preference, system)
  if (snapshot.preference === preference && snapshot.resolved === resolved) return

  runThemeChange(() => write(preference, resolved, willUseViewTransition()), origin)
}

/**
 * The first read of stored state, applied without animation.
 *
 * Deliberately not `commit`. `init` runs from `getSnapshot`, which
 * useSyncExternalStore calls *during render* -- and animating there would mean
 * calling flushSync mid-render, which React rejects outright. There is also
 * nothing to animate: the inline script in index.html has already put the right
 * class on <html> before the first paint, so this is only catching the store up
 * to a document that is already correct.
 */
function settle(preference: ThemePreference, system: ResolvedTheme) {
  const resolved = resolveTheme(preference, system)
  if (snapshot.preference === preference && snapshot.resolved === resolved) return

  write(preference, resolved, false)
}

function init() {
  if (initialised) return
  initialised = true

  settle(readStoredPreference(), systemTheme())

  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return

  /* A `system` preference has to keep following the OS after load: somebody who
     has never touched the toggle expects the app to turn dark when their laptop
     does at sunset. Listening always, and filtering in `commit`, keeps the
     listener count at one for the life of the page. */
  window.matchMedia(DARK_QUERY).addEventListener('change', (event) => {
    commit(snapshot.preference, event.matches ? 'dark' : 'light')
  })
}

export function subscribe(listener: () => void): () => void {
  init()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getSnapshot(): ThemeSnapshot {
  init()
  return snapshot
}

/** Server/prerender snapshot. There is no DOM to read, so light is the answer. */
export function getServerSnapshot(): ThemeSnapshot {
  return { preference: 'system', resolved: 'light' }
}

export function setPreference(
  preference: ThemePreference,
  origin?: TransitionOrigin,
): void {
  init()
  try {
    if (preference === 'system') localStorage.removeItem(THEME_STORAGE_KEY)
    else localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    /* See readStoredPreference: a blocked store costs persistence, not the app. */
  }
  commit(preference, systemTheme(), origin)
}

/**
 * Toggles to the opposite of what is currently *on screen*.
 *
 * Deliberately resolves against the rendered theme rather than cycling
 * light -> dark -> system: from `system`-dark, the useful meaning of clicking a
 * sun is "give me light now", not "advance to the next of three states nobody
 * can see".
 */
export function toggleTheme(origin?: TransitionOrigin): ResolvedTheme {
  init()
  const next: ResolvedTheme = snapshot.resolved === 'dark' ? 'light' : 'dark'
  setPreference(next, origin)
  return next
}

/** Test seam: drops all state so a spec can start from a known theme. */
export function resetThemeStoreForTests(): void {
  initialised = false
  listeners.clear()
  snapshot = { preference: 'system', resolved: 'light' }
}
