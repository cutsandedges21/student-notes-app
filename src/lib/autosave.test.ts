import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createAutosaveScheduler } from './autosave'

describe('createAutosaveScheduler', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('does not save until the debounce window elapses', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const scheduler = createAutosaveScheduler({ delayMs: 1000, save })

    scheduler.schedule('draft')
    await vi.advanceTimersByTimeAsync(999)
    expect(save).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(save).toHaveBeenCalledExactlyOnceWith('draft')
  })

  it('coalesces rapid edits into a single save with the latest payload', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const scheduler = createAutosaveScheduler({ delayMs: 1000, save })

    scheduler.schedule('a')
    await vi.advanceTimersByTimeAsync(500)
    scheduler.schedule('ab')
    await vi.advanceTimersByTimeAsync(500)
    scheduler.schedule('abc')
    await vi.advanceTimersByTimeAsync(1000)

    expect(save).toHaveBeenCalledExactlyOnceWith('abc')
  })

  it('waits for an in-flight save before starting the next one', async () => {
    const order: string[] = []
    let release: () => void = () => {}
    const save = vi
      .fn()
      .mockImplementationOnce(async (payload: string) => {
        order.push(`start:${payload}`)
        await new Promise<void>((resolve) => {
          release = resolve
        })
        order.push(`end:${payload}`)
      })
      .mockImplementationOnce(async (payload: string) => {
        order.push(`start:${payload}`)
      })

    const scheduler = createAutosaveScheduler({ delayMs: 1000, save })

    scheduler.schedule('first')
    await vi.advanceTimersByTimeAsync(1000)
    expect(order).toEqual(['start:first'])

    // Second edit arrives while the first save is still in flight.
    scheduler.schedule('second')
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenCalledTimes(1)

    release()
    await vi.advanceTimersByTimeAsync(0)

    expect(order).toEqual(['start:first', 'end:first', 'start:second'])
  })

  it('flush saves immediately without waiting for the debounce', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const scheduler = createAutosaveScheduler({ delayMs: 1000, save })

    scheduler.schedule('urgent')
    await scheduler.flush()

    expect(save).toHaveBeenCalledExactlyOnceWith('urgent')
  })

  it('cancel discards a pending save', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const scheduler = createAutosaveScheduler({ delayMs: 1000, save })

    scheduler.schedule('discarded')
    scheduler.cancel()
    await vi.advanceTimersByTimeAsync(1000)

    expect(save).not.toHaveBeenCalled()
  })
})
