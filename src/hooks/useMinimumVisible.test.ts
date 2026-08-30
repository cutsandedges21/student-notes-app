import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useMinimumVisible } from './useMinimumVisible'

describe('useMinimumVisible', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows immediately, so nothing is ever delayed by the hold', () => {
    const { result } = renderHook(() => useMinimumVisible(true, 300))
    expect(result.current).toBe(true)
  })

  it('holds on after the work finishes, so a fast load does not flicker', () => {
    const { result, rerender } = renderHook(
      ({ active }) => useMinimumVisible(active, 300),
      { initialProps: { active: true } },
    )

    // Resolved after 40ms: without the hold this would be a flash.
    act(() => {
      vi.advanceTimersByTime(40)
    })
    rerender({ active: false })
    expect(result.current).toBe(true)

    act(() => {
      vi.advanceTimersByTime(259)
    })
    expect(result.current).toBe(true)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe(false)
  })

  it('hides at once when the work already outlasted the minimum', () => {
    const { result, rerender } = renderHook(
      ({ active }) => useMinimumVisible(active, 300),
      { initialProps: { active: true } },
    )

    act(() => {
      vi.advanceTimersByTime(900)
    })
    rerender({ active: false })

    expect(result.current).toBe(false)
  })

  it('never shows anything when the work was never active', () => {
    const { result } = renderHook(() => useMinimumVisible(false, 300))
    expect(result.current).toBe(false)

    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(result.current).toBe(false)
  })

  it('restarts the hold when work begins again', () => {
    const { result, rerender } = renderHook(
      ({ active }) => useMinimumVisible(active, 300),
      { initialProps: { active: true } },
    )

    rerender({ active: false })
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(result.current).toBe(false)

    rerender({ active: true })
    expect(result.current).toBe(true)

    rerender({ active: false })
    act(() => {
      vi.advanceTimersByTime(299)
    })
    expect(result.current).toBe(true)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe(false)
  })
})
