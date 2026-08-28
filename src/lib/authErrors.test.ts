import { describe, it, expect } from 'vitest'
import { describeAuthError } from './authErrors'

/** Mirrors the shape supabase-js throws (AuthApiError carries a `code`). */
function authError(message: string, code?: string) {
  return Object.assign(new Error(message), code ? { code } : {})
}

describe('describeAuthError', () => {
  // The bug this file exists to prevent: an unconfirmed email was reported as
  // a bad password, so the user retyped a correct password indefinitely.
  it('tells the user to confirm their email when that is the cause', () => {
    expect(describeAuthError(authError('Email not confirmed', 'email_not_confirmed'))).toBe(
      'Check your inbox and confirm your email address before signing in.',
    )
  })

  it('reports bad credentials distinctly from an unconfirmed email', () => {
    expect(
      describeAuthError(authError('Invalid login credentials', 'invalid_credentials')),
    ).toBe('That email and password combination did not work.')
  })

  it('points an existing user at sign-in', () => {
    expect(describeAuthError(authError('User already registered', 'user_already_exists'))).toBe(
      'An account with that email already exists. Try signing in instead.',
    )
  })

  it('recognises a network failure', () => {
    expect(describeAuthError(new TypeError('Failed to fetch'))).toBe(
      "Couldn't reach the server. Check your connection and try again.",
    )
  })

  it('falls back to a generic message for unknown causes', () => {
    expect(describeAuthError(authError('Some unmapped server explosion'))).toBe(
      'Something went wrong. Try again.',
    )
  })

  it('does not throw on non-Error values', () => {
    expect(describeAuthError(null)).toBe('Something went wrong. Try again.')
    expect(describeAuthError(undefined)).toBe('Something went wrong. Try again.')
  })
})
