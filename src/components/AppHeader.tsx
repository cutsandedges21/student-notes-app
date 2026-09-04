import { Link } from 'react-router-dom'
import { Search } from 'lucide-react'
import { AppDocIcon } from '../editor/DocsIcons'
import { useAuth } from '../contexts/AuthContext'
import { Button } from './ui/Button'
import { SearchDialog } from './SearchDialog'
import { useSearchShortcut } from './useSearchShortcut'
import { ThemeToggle } from '../theme/ThemeToggle'

export function AppHeader() {
  const { profile, session, signOut, user } = useAuth()
  const signedIn = Boolean(session)
  const { searchOpen, openSearch, closeSearch } = useSearchShortcut()

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
        {/*
          The mark and the wordmark together, as every other header in the app
          already has them -- the intro splash, the editor title bar, the
          shared-note page and the plans page all pair them, and this was the
          one place showing the name alone.

          Sized to match the plans page, which is the closest thing to this: a
          page header rather than the editor's taller chrome.

          Tracking opens up rather than tightening: the negative tracking in
          the type scale was set for lowercase, and caps need room between
          them.
        */}
        <Link
          to="/classes"
          aria-label="Margin — go to my classes"
          className="flex items-center gap-2 rounded text-sm font-medium uppercase tracking-wide text-ink"
        >
          {/* Already `aria-hidden` inside the component, which is right: the
              link is named, and a second announcement of "Margin" is noise. */}
          <AppDocIcon className="h-7 w-[22px]" />
          Margin
        </Link>

        <div className="flex items-center gap-3">
          {/* The editor has its own copy in the Docs chrome. The class list and
              the auth pages are a separate shell, and somebody who never opens
              a note still needs a way to turn the lights down. */}
          <ThemeToggle className="text-ink-muted hover:bg-surface-hover" />

          <button
            type="button"
            onClick={openSearch}
            title="Search your notes (Ctrl+Shift+F)"
            aria-label="Search your notes"
            className="flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-sm text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
          >
            <Search size={15} />
            <span className="hidden sm:inline">Search</span>
          </button>

          {signedIn ? (
            <>
              {profile?.display_name && (
                <span className="hidden text-sm text-ink-muted sm:inline">
                  {profile.display_name}
                </span>
              )}
              <Button variant="ghost" size="sm" onClick={() => void signOut()}>
                Sign out
              </Button>
            </>
          ) : (
            <>
              <span className="hidden text-sm text-ink-faint sm:inline">
                Saved on this device
              </span>
              <Link
                to="/login"
                className="rounded px-3 py-1.5 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
              >
                Sign in
              </Link>
              <Link
                to="/signup"
                className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-on transition-colors hover:bg-accent-hover"
              >
                Sign up
              </Link>
            </>
          )}
        </div>
      </div>

      <SearchDialog
        open={searchOpen}
        userId={user?.id ?? null}
        onClose={closeSearch}
      />
    </header>
  )
}
