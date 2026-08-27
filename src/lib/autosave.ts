export interface AutosaveScheduler<T> {
  /** Queue a save. Resets the debounce window and replaces any pending payload. */
  schedule: (payload: T) => void
  /** Save any pending payload immediately. */
  flush: () => Promise<void>
  /** Drop any pending payload without saving. */
  cancel: () => void
}

interface Options<T> {
  delayMs: number
  save: (payload: T) => Promise<void>
}

/**
 * Debounced, coalescing autosave.
 *
 * Two properties matter and are covered by tests:
 *
 * 1. Coalescing — rapid edits collapse into one save carrying the newest
 *    payload. Intermediate keystrokes are never written.
 * 2. No overlap — while a save is in flight, a newly scheduled payload waits
 *    for it to settle instead of racing it. Without this, two concurrent
 *    requests could land out of order and the older content would win.
 */
export function createAutosaveScheduler<T>({
  delayMs,
  save,
}: Options<T>): AutosaveScheduler<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: { payload: T } | null = null
  let inFlight: Promise<void> | null = null

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  async function run(): Promise<void> {
    // Wait out any save already in progress, then take the newest payload.
    if (inFlight) await inFlight
    if (!pending) return

    const { payload } = pending
    pending = null

    inFlight = save(payload).finally(() => {
      inFlight = null
    })

    await inFlight

    // An edit that arrived mid-save is now waiting; save it too.
    if (pending) await run()
  }

  return {
    schedule(payload) {
      pending = { payload }
      clearTimer()
      timer = setTimeout(() => {
        timer = null
        void run()
      }, delayMs)
    },

    async flush() {
      clearTimer()
      await run()
    },

    cancel() {
      clearTimer()
      pending = null
    },
  }
}
