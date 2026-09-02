import { useEffect, useState } from 'react'

/**
 * Opens search from anywhere, on one binding.
 *
 * The app header only renders on the class pages, and "which lecture was
 * osmosis in?" is most often asked while writing -- so the editor needs the
 * same door. A hook rather than two copies of the listener: two surfaces
 * implementing the same action separately is how this codebase ended up with
 * a link prompt that meant one thing in the toolbar and another in the menu.
 *
 * Ctrl/Cmd+Shift+F, not Ctrl+K -- the editor uses that for Insert link -- and
 * not "/", which would fire on every slash typed into a note.
 */
export function useSearchShortcut(): {
  searchOpen: boolean
  openSearch: () => void
  closeSearch: () => void
} {
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === 'f'
      ) {
        event.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  return {
    searchOpen,
    openSearch: () => setSearchOpen(true),
    closeSearch: () => setSearchOpen(false),
  }
}
