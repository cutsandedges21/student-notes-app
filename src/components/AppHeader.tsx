import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Button } from './ui/Button'

export function AppHeader() {
  const { profile, session, signOut } = useAuth()
  const signedIn = Boolean(session)

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
        {/* Tracking opens up rather than tightening: the negative tracking
            below was set for lowercase, and caps need room between them. */}
        <Link to="/classes" className="text-sm font-medium uppercase tracking-wide text-ink">
          Margin
        </Link>

        <div className="flex items-center gap-3">
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
                className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
              >
                Sign up
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
