/**
 * A quiet full-height loading state.
 *
 * Deliberately just a spinner on the page backdrop rather than a skeleton of
 * the editor: the note's own chrome appears the moment it loads, and a fake
 * toolbar that then swapped for a real one would read as a flash of its own.
 */
interface LoadingScreenProps {
  /** Announced to assistive technology; never drawn. */
  label?: string
}

export function LoadingScreen({ label = 'Loading' }: LoadingScreenProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      // The save indicator is also a `role="status"` region, so this carries a
      // marker of its own rather than leaving the two indistinguishable.
      data-loading-screen=""
      className="grid min-h-full place-items-center bg-surface-backdrop px-6"
    >
      <span className="sr-only">{label}</span>
      {/*
        A ring with one coloured quarter. `motion-reduce` swaps the rotation for
        a fade rather than removing the animation outright -- a spinner frozen
        mid-turn reads as a hung page, which is the opposite of reassuring.
      */}
      <span
        aria-hidden="true"
        className="h-7 w-7 animate-spin rounded-full border-2 border-line-strong border-t-accent motion-reduce:animate-pulse"
      />
    </div>
  )
}
