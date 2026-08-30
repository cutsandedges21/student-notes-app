/**
 * Maps Supabase data failures to messages that name the actual fix.
 *
 * Written after a live incident: the app shipped `slug` columns before the
 * schema was applied to the project, so every create returned PGRST204 and
 * every class lookup returned 42703. Because the pages only logged to the
 * console, the whole thing surfaced as buttons that did nothing -- creating a
 * class, opening a class, and deleting a note all appeared broken with no clue
 * why. The mapping below exists so that failure names itself next time.
 *
 * Unlike describeAuthError, the raw message is kept in the fallback. Auth
 * errors are deliberately vague (they leak account state to whoever is at the
 * keyboard); a Postgres error is a developer-facing fact about this project's
 * own schema, and hiding it is what cost the time.
 */

/** PostgREST/Postgres codes that all mean "the schema isn't what the app expects". */
const SCHEMA_DRIFT_CODES = new Set([
  '42703', // undefined_column
  '42P01', // undefined_table
  'PGRST204', // column not found in PostgREST's schema cache
  'PGRST202', // function not found in the schema cache
])

/** Supabase returns plain objects, not Error instances, so read both shapes. */
function read(error: unknown, key: 'code' | 'message'): string {
  if (typeof error === 'object' && error !== null && key in error) {
    const value = (error as Record<string, unknown>)[key]
    if (typeof value === 'string') return value
  }
  if (key === 'message' && error instanceof Error) return error.message
  return ''
}

export function describeDataError(error: unknown): string {
  const code = read(error, 'code')
  const raw = read(error, 'message') || String(error ?? '')
  const message = raw.toLowerCase()

  if (
    SCHEMA_DRIFT_CODES.has(code) ||
    message.includes('schema cache') ||
    message.includes('does not exist')
  ) {
    return 'Your database is missing changes this version of the app needs. Open the Supabase SQL editor and run supabase/schema.sql, then try again.'
  }

  if (code === '23505') {
    return 'Something with that name already exists here. Try a different name.'
  }

  if (code === '23503') {
    return 'That item no longer exists. Refresh the page and try again.'
  }

  if (code === '42501' || code === 'PGRST301' || message.includes('jwt')) {
    return 'Your session has expired. Sign in again and retry.'
  }

  if (message.includes('failed to fetch') || message.includes('network')) {
    return "Couldn't reach the server. Check your connection and try again."
  }

  return raw ? `Something went wrong: ${raw}` : 'Something went wrong. Try again.'
}
