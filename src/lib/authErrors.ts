/**
 * Maps Supabase auth failures to messages a student can act on.
 *
 * Collapsing every failure into one generic string (the previous behaviour)
 * actively misleads: an unconfirmed email reads as a wrong password, so the
 * user retypes a correct password over and over. Distinguish the cases that
 * have different fixes, and fall back to the generic wording only when the
 * cause is genuinely unknown.
 */
export function describeAuthError(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : ''
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error ?? '').toLowerCase()

  if (code === 'email_not_confirmed' || message.includes('email not confirmed')) {
    return 'Check your inbox and confirm your email address before signing in.'
  }

  if (code === 'invalid_credentials' || message.includes('invalid login credentials')) {
    return 'That email and password combination did not work.'
  }

  if (code === 'user_already_exists' || message.includes('already registered')) {
    return 'An account with that email already exists. Try signing in instead.'
  }

  if (code === 'weak_password' || message.includes('password should be')) {
    return 'That password is too weak. Use at least 8 characters.'
  }

  if (code === 'over_email_send_rate_limit' || message.includes('rate limit')) {
    return 'Too many attempts. Wait a moment and try again.'
  }

  if (code === 'email_address_invalid' || message.includes('invalid')) {
    return 'That email address does not look valid.'
  }

  if (message.includes('failed to fetch') || message.includes('network')) {
    return "Couldn't reach the server. Check your connection and try again."
  }

  return 'Something went wrong. Try again.'
}
