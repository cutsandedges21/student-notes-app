import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { ProfileRow } from '../types/database'
import { migrateGuestData } from '../services/migrateGuestData'

type AuthState = {
  session: Session | null
  user: User | null
  profile: ProfileRow | null
  loading: boolean
  /** Set once after guest work is copied into the account. */
  migration: { classes: number; documents: number } | null
  dismissMigration: () => void
  /**
   * Resolves with `needsEmailConfirmation: true` when Supabase created the
   * account but withheld a session pending email verification.
   */
  signUp: (
    email: string,
    password: string,
    displayName: string,
  ) => Promise<{ needsEmailConfirmation: boolean }>
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  requestPasswordReset: (email: string) => Promise<void>
  updatePassword: (password: string) => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

async function fetchProfile(userId: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    console.error('[AuthContext] failed to fetch profile:', error)
    return null
  }
  return data as ProfileRow | null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [migration, setMigration] = useState<{ classes: number; documents: number } | null>(
    null,
  )

  useEffect(() => {
    let cancelled = false

    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setSession(data.session)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession)
      setLoading(false)

      // Anything created while signed out lives in browser storage. On the way
      // in, copy it into the account. migrateGuestData is a no-op when there is
      // nothing local, and keeps the local copy if any write fails, so a failed
      // migration never costs the user their notes.
      if (event === 'SIGNED_IN' && nextSession?.user) {
        void migrateGuestData(nextSession.user.id).then((result) => {
          if (result.migrated) {
            setMigration({ classes: result.classes, documents: result.documents })
          }
        })
      }
    })

    return () => {
      cancelled = true
      listener.subscription.unsubscribe()
    }
  }, [])

  const userId = session?.user.id ?? null

  useEffect(() => {
    if (!userId) {
      setProfile(null)
      return
    }
    let cancelled = false
    void fetchProfile(userId).then((row) => {
      if (!cancelled) setProfile(row)
    })
    return () => {
      cancelled = true
    }
  }, [userId])

  const value = useMemo<AuthState>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      migration,
      dismissMigration: () => setMigration(null),

      signUp: async (email, password, displayName) => {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          // Read by the handle_new_user trigger to populate profiles.display_name.
          options: { data: { display_name: displayName } },
        })
        if (error) throw error

        // When "Confirm email" is enabled, Supabase returns a user but NO
        // session -- the account exists yet cannot sign in until the emailed
        // link is clicked. Navigating to the app here would drop the user into
        // a signed-out view with no explanation, which is exactly how the
        // confirmation requirement gets mistaken for a broken login.
        return { needsEmailConfirmation: Boolean(data.user) && !data.session }
      },

      signIn: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      },

      signOut: async () => {
        const { error } = await supabase.auth.signOut()
        if (error) throw error
      },

      requestPasswordReset: async (email) => {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        })
        if (error) throw error
      },

      updatePassword: async (password) => {
        const { error } = await supabase.auth.updateUser({ password })
        if (error) throw error
      },
    }),
    [session, profile, loading, migration],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within an AuthProvider')
  return context
}
