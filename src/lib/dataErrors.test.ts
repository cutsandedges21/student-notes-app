import { describe, it, expect } from 'vitest'
import { describeDataError } from './dataErrors'

describe('describeDataError', () => {
  // The two shapes the live project actually returned while the slug columns
  // were missing. Both have to land on the "apply the schema" message, because
  // that -- not a retry -- is the fix.
  it.each([
    ['insert', { code: 'PGRST204', message: "Could not find the 'slug' column of 'classes' in the schema cache" }],
    ['select', { code: '42703', message: 'column classes.slug does not exist' }],
  ])('points at the schema when a column is missing on %s', (_case, error) => {
    expect(describeDataError(error)).toMatch(/run supabase\/schema\.sql/i)
  })

  it('names the conflict on a duplicate slug', () => {
    expect(describeDataError({ code: '23505', message: 'duplicate key value' })).toMatch(
      /already exists/i,
    )
  })

  it('tells an expired session to sign in again', () => {
    expect(describeDataError({ code: 'PGRST301', message: 'JWT expired' })).toMatch(
      /sign in again/i,
    )
  })

  it('recognises a dropped connection', () => {
    expect(describeDataError(new TypeError('Failed to fetch'))).toMatch(/connection/i)
  })

  // The fallback keeps the underlying text. Swallowing it is what made the
  // original failure invisible.
  it('keeps the original message when the cause is unrecognised', () => {
    expect(describeDataError({ code: 'XX000', message: 'boom' })).toContain('boom')
  })

  it('survives a non-object being thrown', () => {
    expect(describeDataError(undefined)).toBe('Something went wrong. Try again.')
  })
})
