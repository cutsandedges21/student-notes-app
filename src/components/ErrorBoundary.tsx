import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * The difference between a bug and a blank page.
 *
 * There was no boundary anywhere in this app, so any error thrown during
 * render unmounted the entire tree and left an empty document. A student saw
 * white. Nothing named the note, nothing offered to reload, and nothing said
 * whether their work was still there -- which, for a notes app, is the first
 * question they would ask.
 *
 * That is how a one-field mistake in an API response became "the screen just
 * turns white": the cause was small and the symptom was total.
 *
 * A class component because this is the one thing hooks still cannot do.
 *
 * It does not try to recover the tree it lost. Re-rendering a component that
 * just threw usually throws again, and a loop of crashes is worse than a
 * stopped page. Reload is offered instead, because the state that caused it is
 * almost always in memory rather than on disk.
 */

interface Props {
  children: ReactNode
  /** Named so the message can say which part stopped, not just that it did. */
  label?: string
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The component stack is the useful half and React only passes it here.
    console.error('[ErrorBoundary] render failed', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    const what = this.props.label ?? 'this page'

    return (
      <div
        role="alert"
        className="grid min-h-[60vh] place-items-center p-6 text-center"
      >
        <div className="max-w-md">
          <h1 className="text-lg font-medium text-ink">Something went wrong in {what}.</h1>

          {/*
            Said first, because it is the question a notes app has to answer
            before any other. Notes are written on a debounce and flushed
            before unload, so what reached storage is still there -- a crash
            in the interface is not a crash in the document.
          */}
          <p className="mt-2 text-sm text-ink-muted">
            Your notes are saved. This is a problem with the page, not with what
            you wrote.
          </p>

          <div className="mt-5 flex justify-center gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-on transition-colors hover:bg-accent-hover"
            >
              Reload
            </button>
            <a
              href="/classes"
              className="rounded border border-line-strong px-3 py-1.5 text-sm text-ink transition-colors hover:bg-surface-hover"
            >
              Back to my notes
            </a>
          </div>

          {/*
            The message, not the stack. It is what somebody can paste into a
            report, and it is already in the console for anyone who can read a
            stack.
          */}
          <p className="mt-4 break-words font-mono text-xs text-ink-faint">
            {error.message}
          </p>
        </div>
      </div>
    )
  }
}
