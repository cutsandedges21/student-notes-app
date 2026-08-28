import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

/**
 * Whether accounts are available in this deployment.
 *
 * Previously a missing env var threw at module load, which took the entire app
 * down to a blank page — including guest mode, which needs no backend at all.
 * A deployment without credentials now degrades to local-only notes instead of
 * a white screen, and every service already routes to browser storage when
 * there is no signed-in user.
 */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey)

if (!isSupabaseConfigured) {
  console.warn(
    '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY are not set. ' +
      'Running in local-only mode: notes stay in this browser and sign-in is disabled.',
  )
}

// The Database generic is deliberately omitted. supabase-js v2's write-path
// type inference resolves Insert payloads to `never` against a hand-written
// schema type, which breaks the build. Type safety lives in src/services/*,
// which owns the row-shape contracts. Do not add the generic back.
//
// Null when unconfigured. Guard with `isSupabaseConfigured` before use; the
// only caller that touches it directly is AuthContext.
export const supabase: SupabaseClient = isSupabaseConfigured
  ? createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    })
  : (null as unknown as SupabaseClient)
