import { useSyncExternalStore } from 'react'
import {
  getServerSnapshot,
  getSnapshot,
  setPreference,
  subscribe,
  toggleTheme,
  type ThemePreference,
  type ResolvedTheme,
} from './themeStore'

export interface UseTheme {
  /** What the user asked for, including `system`. */
  preference: ThemePreference
  /** What is actually on screen right now. */
  resolved: ResolvedTheme
  isDark: boolean
  setPreference: (preference: ThemePreference) => void
  toggle: () => void
}

export function useTheme(): UseTheme {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  return {
    preference: snapshot.preference,
    resolved: snapshot.resolved,
    isDark: snapshot.resolved === 'dark',
    setPreference,
    toggle: () => void toggleTheme(),
  }
}
