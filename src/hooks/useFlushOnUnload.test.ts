import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useFlushOnUnload } from './useFlushOnUnload'

/*
 * Autosave debounces for a second, and React's unmount cleanup does not run
 * when a browser reloads or a tab closes. So everything typed in that last
 * second was simply gone -- which an E2E test caught by typing and reloading
 * with no wait in between, exactly what a student does after finishing a
 * sentence.
 */

/** jsdom's visibilityState is read-only; this is the supported way to move it. */
function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    value: state,
    configurable: true,
  })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('useFlushOnUnload', () => {
  it('does not flush while nothing is happening', () => {
    const flush = vi.fn()
    renderHook(() => useFlushOnUnload(flush))

    expect(flush).not.toHaveBeenCalled()
  })

  // The desktop reload and close.
  it('flushes on pagehide', () => {
    const flush = vi.fn()
    renderHook(() => useFlushOnUnload(flush))

    window.dispatchEvent(new Event('pagehide'))

    expect(flush).toHaveBeenCalledOnce()
  })

  // The mobile case: a backgrounded tab can be killed with no further warning,
  // so hidden is the last reliable moment to write anything.
  it('flushes when the page becomes hidden', () => {
    const flush = vi.fn()
    renderHook(() => useFlushOnUnload(flush))

    setVisibility('hidden')

    expect(flush).toHaveBeenCalledOnce()
  })

  it('does not flush when the page becomes visible again', () => {
    const flush = vi.fn()
    renderHook(() => useFlushOnUnload(flush))

    setVisibility('visible')

    expect(flush).not.toHaveBeenCalled()
  })

  it('stops listening once unmounted, so a stale scheduler is never called', () => {
    const flush = vi.fn()
    const { unmount } = renderHook(() => useFlushOnUnload(flush))

    unmount()
    window.dispatchEvent(new Event('pagehide'))
    setVisibility('hidden')

    expect(flush).not.toHaveBeenCalled()
  })

  // The flush is async for signed-in notes. A rejection during teardown must
  // not become an unhandled rejection that takes something else down with it.
  it('survives a flush that rejects', () => {
    const flush = vi.fn().mockRejectedValue(new Error('network down'))
    renderHook(() => useFlushOnUnload(flush))

    expect(() => window.dispatchEvent(new Event('pagehide'))).not.toThrow()
    expect(flush).toHaveBeenCalledOnce()
  })

  it('uses the latest flush after it changes', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(({ fn }) => useFlushOnUnload(fn), {
      initialProps: { fn: first },
    })

    rerender({ fn: second })
    window.dispatchEvent(new Event('pagehide'))

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
  })
})
