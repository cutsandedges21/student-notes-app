import { describe, expect, it } from 'vitest'
import { DisplacementIndex } from './displacement'

describe('DisplacementIndex', () => {
  const index = new DisplacementIndex([
    { pos: 100, delta: 50 },
    { pos: 20, delta: 10 },
    { pos: 60, delta: 25 },
  ])

  it('sums every spacer at or before a position', () => {
    expect(index.before(0)).toBe(0)
    expect(index.before(19)).toBe(0)
    // A spacer anchored exactly here renders before the content and pushes it.
    expect(index.before(20)).toBe(10)
    expect(index.before(59)).toBe(10)
    expect(index.before(60)).toBe(35)
    expect(index.before(1000)).toBe(85)
  })

  it('counts only the spacers strictly inside a block when correcting height', () => {
    // A break anchored at the block's own start sits outside it.
    expect(index.within(20, 100)).toBe(25)
    expect(index.within(0, 200)).toBe(85)
    expect(index.within(20, 60)).toBe(0)
    expect(index.within(61, 99)).toBe(0)
  })

  it('is empty and free of displacement before the first pass', () => {
    const empty = new DisplacementIndex()
    expect(empty.isEmpty).toBe(true)
    expect(empty.before(500)).toBe(0)
    expect(empty.within(0, 500)).toBe(0)
  })
})
