/**
 * Trailing debounce with a ceiling, run inside an animation frame.
 *
 * Pagination has to keep up with typing without measuring on every keystroke.
 * A plain debounce would do the first part and fail the second: hold a key
 * down and the trailing edge never arrives, so the page count would freeze
 * until the writer paused. `maxWait` puts a floor under how often it refreshes
 * during a continuous burst.
 *
 * The final hop through `requestAnimationFrame` keeps the measuring read out
 * of the input handler, so a pass can never lengthen the keystroke that
 * triggered it.
 */

export interface Scheduler {
  /** Ask for a pass. Repeated calls collapse into one. */
  schedule(): void
  /** Run any pending pass immediately, on the current task. */
  flush(): void
  /** Drop any pending pass. */
  cancel(): void
}

export interface SchedulerOptions {
  /** Quiet period after the last request before a pass runs. */
  wait: number
  /** Longest a pass will be deferred while requests keep arriving. */
  maxWait: number
}

const raf: (callback: () => void) => number =
  typeof requestAnimationFrame === 'function'
    ? (callback) => requestAnimationFrame(callback)
    : (callback) => setTimeout(callback, 16) as unknown as number

const cancelRaf: (handle: number) => void =
  typeof cancelAnimationFrame === 'function'
    ? (handle) => cancelAnimationFrame(handle)
    : (handle) => clearTimeout(handle)

export function createScheduler(run: () => void, options: SchedulerOptions): Scheduler {
  let timer: ReturnType<typeof setTimeout> | null = null
  let frame: number | null = null
  /** When the deferred pass stops being deferrable. 0 means nothing pending. */
  let deadline = 0

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function fire() {
    clearTimer()
    deadline = 0
    if (frame !== null) return
    frame = raf(() => {
      frame = null
      run()
    })
  }

  return {
    schedule() {
      const now = Date.now()
      if (deadline === 0) deadline = now + options.maxWait
      clearTimer()
      timer = setTimeout(fire, Math.max(0, Math.min(options.wait, deadline - now)))
    },

    flush() {
      const pending = timer !== null || frame !== null
      this.cancel()
      if (pending) run()
    },

    cancel() {
      clearTimer()
      deadline = 0
      if (frame !== null) {
        cancelRaf(frame)
        frame = null
      }
    },
  }
}
