import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ErrorBoundary } from './ErrorBoundary'

/**
 * The boundary that turns a crash into a message.
 *
 * There was none anywhere in the app, so any error thrown during render
 * unmounted the whole tree and left an empty document. The cause could be one
 * missing field in an API response; the symptom was a white screen with no
 * indication of whether the student's work still existed.
 */

function Boom({ message = 'kaboom' }: { message?: string }): never {
  throw new Error(message)
}

beforeEach(() => {
  // React logs the caught error itself; the test output is not the subject.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => vi.restoreAllMocks())

describe('ErrorBoundary', () => {
  it('renders its children when nothing is wrong', () => {
    render(
      <ErrorBoundary>
        <p>The note</p>
      </ErrorBoundary>,
    )

    expect(screen.getByText('The note')).toBeVisible()
  })

  it('shows a message instead of an empty page', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )

    expect(screen.getByRole('alert')).toBeVisible()
    expect(screen.getByText(/Something went wrong/)).toBeVisible()
  })

  /**
   * The first question a notes app has to answer. Notes are written on a
   * debounce and flushed before unload, so a crash in the interface is not a
   * crash in the document -- and the student has no way to know that unless
   * they are told.
   */
  it('says the notes are safe, because that is what is actually being asked', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )

    expect(screen.getByText(/Your notes are saved/)).toBeVisible()
  })

  it('offers a way out rather than a dead end', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )

    expect(screen.getByRole('button', { name: 'Reload' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Back to my notes' })).toBeVisible()
  })

  it('names what stopped, so the message is not "something, somewhere"', () => {
    render(
      <ErrorBoundary label="the assistant">
        <Boom />
      </ErrorBoundary>,
    )

    expect(screen.getByText(/Something went wrong in the assistant/)).toBeVisible()
  })

  /** Enough to paste into a report; the stack is already in the console. */
  it('shows the error message', () => {
    render(
      <ErrorBoundary>
        <Boom message="Cannot read properties of undefined (reading 'length')" />
      </ErrorBoundary>,
    )

    expect(screen.getByText(/reading 'length'/)).toBeVisible()
  })

  it('logs the failure for whoever has to find it', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )

    expect(console.error).toHaveBeenCalledWith(
      '[ErrorBoundary] render failed',
      expect.any(Error),
      expect.anything(),
    )
  })
})
