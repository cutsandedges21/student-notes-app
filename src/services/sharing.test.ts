import { describe, it, expect } from 'vitest'
import { pickDestinationClass, type ClassCandidate } from './sharing'

/*
 * "Make a copy" used to resolve its destination class with
 * `.eq('name', …).maybeSingle()`. There is no unique constraint on
 * classes(user_id, name) and there cannot be one -- taking the same course in
 * two terms is ordinary -- so PostgREST answered a second same-named class
 * with PGRST116 and the copy failed outright for anyone it applied to.
 *
 * The resolver now returns every candidate and chooses between them by a total
 * order. These tests pin that order down, because the property that matters is
 * not which class wins but that the same one always does: copies taken from
 * one share link on different days, or on different devices, have to land
 * together rather than scattering across duplicates.
 */

const candidate = (id: string, created_at: string, slug = id): ClassCandidate => ({
  id,
  slug,
  created_at,
})

describe('pickDestinationClass', () => {
  it('returns null when the user has no class of that name', () => {
    expect(pickDestinationClass([])).toBeNull()
  })

  it('returns the only candidate when the name is unambiguous', () => {
    const only = candidate('class-1', '2026-01-01T00:00:00.000Z')
    expect(pickDestinationClass([only])).toEqual(only)
  })

  // The case that used to throw.
  it('chooses deterministically when several classes share a name', () => {
    const older = candidate('class-b', '2026-01-01T00:00:00.000Z')
    const newer = candidate('class-a', '2026-09-01T00:00:00.000Z')

    expect(pickDestinationClass([newer, older])).toEqual(older)
  })

  it('gives the same answer whatever order the rows arrive in', () => {
    const rows = [
      candidate('class-c', '2026-03-01T00:00:00.000Z'),
      candidate('class-a', '2026-01-01T00:00:00.000Z'),
      candidate('class-b', '2026-02-01T00:00:00.000Z'),
    ]

    const first = pickDestinationClass(rows)
    const reversed = pickDestinationClass([...rows].reverse())
    const shuffled = pickDestinationClass([rows[1], rows[2], rows[0]])

    expect(first?.id).toBe('class-a')
    expect(reversed).toEqual(first)
    expect(shuffled).toEqual(first)
  })

  // Two classes created in the same millisecond is unlikely but not impossible,
  // and a partial order would let the winner flip between calls.
  it('breaks a timestamp tie on id rather than leaving it to chance', () => {
    const sameInstant = '2026-01-01T00:00:00.000Z'
    const rows = [candidate('zzz', sameInstant), candidate('aaa', sameInstant)]

    expect(pickDestinationClass(rows)?.id).toBe('aaa')
    expect(pickDestinationClass([...rows].reverse())?.id).toBe('aaa')
  })

  it('does not mutate the caller’s array', () => {
    const rows = [
      candidate('class-c', '2026-03-01T00:00:00.000Z'),
      candidate('class-a', '2026-01-01T00:00:00.000Z'),
    ]
    const before = rows.map((row) => row.id)

    pickDestinationClass(rows)

    expect(rows.map((row) => row.id)).toEqual(before)
  })
})
