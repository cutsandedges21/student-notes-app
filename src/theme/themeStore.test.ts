import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  THEME_STORAGE_KEY,
  applyTheme,
  getSnapshot,
  readStoredPreference,
  resetThemeStoreForTests,
  resolveTheme,
  setPreference,
  subscribe,
  toggleTheme,
} from './themeStore'

/**
 * jsdom has no matchMedia, and the store's whole job is to combine a stored
 * preference with the OS one. This stands in for the OS.
 */
function mockSystem(prefersDark: boolean) {
  const listeners: ((event: { matches: boolean }) => void)[] = []

  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('dark') ? prefersDark : false,
    media: query,
    addEventListener: (_: string, fn: (event: { matches: boolean }) => void) => {
      listeners.push(fn)
    },
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia

  return {
    /** Fires an OS-level theme change at whatever the store subscribed with. */
    change: (matches: boolean) => listeners.forEach((fn) => fn({ matches })),
  }
}

beforeEach(() => {
  resetThemeStoreForTests()
  localStorage.clear()
  document.documentElement.classList.remove('dark')
  document.documentElement.style.colorScheme = ''
  mockSystem(false)
})

describe('resolveTheme', () => {
  it('follows the system only when the preference is system', () => {
    expect(resolveTheme('system', 'dark')).toBe('dark')
    expect(resolveTheme('system', 'light')).toBe('light')
    expect(resolveTheme('light', 'dark')).toBe('light')
    expect(resolveTheme('dark', 'light')).toBe('dark')
  })
})

describe('readStoredPreference', () => {
  it('falls back to system for anything it does not recognise', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'chartreuse')
    expect(readStoredPreference()).toBe('system')
  })

  it('reads a stored preference back', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    expect(readStoredPreference()).toBe('dark')
  })
})

describe('applyTheme', () => {
  it('sets both the class and color-scheme', () => {
    applyTheme('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    /* Not decoration: this is what darkens the scrollbar and form controls. */
    expect(document.documentElement.style.colorScheme).toBe('dark')

    applyTheme('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.style.colorScheme).toBe('light')
  })
})

describe('the store', () => {
  it('starts from the OS when nothing is stored', () => {
    mockSystem(true)
    expect(getSnapshot().resolved).toBe('dark')
    expect(getSnapshot().preference).toBe('system')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('lets a stored preference beat the OS', () => {
    mockSystem(true)
    localStorage.setItem(THEME_STORAGE_KEY, 'light')

    expect(getSnapshot().resolved).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('keeps following the OS while the preference is system', () => {
    const system = mockSystem(false)
    subscribe(() => undefined)
    expect(getSnapshot().resolved).toBe('light')

    system.change(true)
    expect(getSnapshot().resolved).toBe('dark')
  })

  it('stops following the OS once the user has chosen', () => {
    const system = mockSystem(false)
    subscribe(() => undefined)
    setPreference('light')

    system.change(true)
    expect(getSnapshot().resolved).toBe('light')
  })

  it('returns an identical snapshot when nothing changed', () => {
    subscribe(() => undefined)
    const first = getSnapshot()
    setPreference('light')
    setPreference('light')

    /* useSyncExternalStore compares by identity: a fresh object per call would
       re-render forever. */
    expect(getSnapshot()).toBe(getSnapshot())
    expect(first).not.toBe(getSnapshot())
  })

  it('notifies subscribers once per real change', () => {
    const listener = vi.fn()
    subscribe(listener)

    setPreference('dark')
    expect(listener).toHaveBeenCalledTimes(1)

    setPreference('dark')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('toggles against what is on screen, not against the preference', () => {
    /* System-dark with no stored choice. Clicking the sun has to mean "light
       now", not "advance to the next of three states". */
    mockSystem(true)
    expect(getSnapshot().resolved).toBe('dark')

    expect(toggleTheme()).toBe('light')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
  })

  it('clears storage when returning to system', () => {
    setPreference('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')

    setPreference('system')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
  })

  it('survives a localStorage that throws', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })

    /* Safari private mode. The theme is decoration; it must never be why the
       app fails to start. */
    expect(() => readStoredPreference()).not.toThrow()
    expect(() => setPreference('dark')).not.toThrow()
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    getItem.mockRestore()
    setItem.mockRestore()
  })
})
