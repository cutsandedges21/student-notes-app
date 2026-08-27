import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Button } from './ui/Button'

export function AppHeader() {
  const { profile, signOut } = useAuth()

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
        <Link to="/classes" className="text-sm font-medium tracking-tight text-ink">
          Student Notes
        </Link>
        <div className="flex items-center gap-4">
          {profile?.display_name && (
            <span className="text-sm text-ink-muted">{profile.display_name}</span>
          )}
          <Button variant="ghost" size="sm" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </div>
    </header>
  )
}
