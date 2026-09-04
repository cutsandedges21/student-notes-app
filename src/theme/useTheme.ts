import { useSyncExternalStore } from 'react'
import {
  getServerSnapshot,
  getSnapshot,
  setPreference,
  subscribe,
  toggleTheme,
  type ThemePreference,
  type ResolvedTheme,
  type TransitionOrigin,
} from './themeStore'

export interface UseTheme {
  /** What the user asked for, including `system`. */
  preference: ThemePreference
  /** What is actually on screen right now. */
  resolved: ResolvedTheme
  isDark: boolean
  setPreference: (preference: ThemePreference) => void
  /**
   * `origin` is where the reveal sweeps out from, in viewport coordinates --
   * normally the centre of the control that was clicked. Omitted, the sweep
   * starts from the top-right corner where both toggles sit.
   */
  toggle: (origin?: TransitionOrigin) => void
}

export function useTheme(): UseTheme {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  return {
    preference: snapshot.preference,
    resolved: snapshot.resolved,
    isDark: snapshot.resolved === 'dark',
    setPreference,
    toggle: (origin) => void toggleTheme(origin),
  }
}
