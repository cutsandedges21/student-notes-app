import { useEffect, useRef, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { Check, ChevronDown, Link2 } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import {
  SHARE_MODE_HINTS,
  SHARE_MODE_LABELS,
  fetchShareState,
  setShareMode,
  shareUrl,
  type ShareMode,
} from '../services/sharing'
import { cn } from '../lib/cn'

const MODES: ShareMode[] = ['private', 'view', 'edit']

/**
 * Share control.
 *
 * Sharing needs an account: the link points at a row in the database, so a
 * guest's browser-local note has nothing to share. Rather than failing after
 * the click, the menu says so and offers a way to sign in.
 */
export function ShareMenu({ documentId }: { documentId: string }) {
  const { session } = useAuth()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<ShareMode>('private')
  const [token, setToken] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || !session) return

    let cancelled = false
    void fetchShareState(documentId)
      .then((state) => {
        if (cancelled || !state) return
        setMode(state.mode)
        setToken(state.token)
      })
      .catch((caught) => console.error('[ShareMenu] failed to read share state:', caught))

    return () => {
      cancelled = true
    }
  }, [open, session, documentId])

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  async function choose(next: ShareMode) {
    setBusy(true)
    try {
      await setShareMode(documentId, next)
      setMode(next)
    } catch (caught) {
      console.error('[ShareMenu] failed to update sharing:', caught)
      setNote('Could not update sharing')
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!token) return
    try {
      await navigator.clipboard.writeText(shareUrl(token))
      setNote('Link copied')
    } catch {
      setNote('Copy failed')
    }
    window.setTimeout(() => setNote(null), 2000)
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Share this note"
        className={cn(
          'flex h-9 shrink-0 items-center gap-2 rounded-full bg-docs-chip px-3 sm:pl-4 sm:pr-3',
          'font-ui text-sm font-medium text-docs-chip-text transition-colors hover:bg-docs-chip-hover',
        )}
      >
        <Link2 size={15} strokeWidth={2} />
        <span className="hidden sm:inline">{note ?? 'Share'}</span>
        <span className="ml-1 hidden h-5 w-px bg-docs-chip-text/25 sm:block" aria-hidden="true" />
        <ChevronDown size={16} className="hidden sm:block" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Share"
          className="absolute right-0 z-40 mt-2 w-80 rounded-lg border border-line bg-surface p-2 shadow-sheet"
        >
          {!session ? (
            <div className="p-2">
              <p className="text-sm text-ink">Sign in to share this note.</p>
              <p className="mt-1.5 text-sm text-ink-muted">
                A share link points at your account, so notes saved only in this
                browser can&rsquo;t be shared yet.
              </p>
              <div className="mt-3 flex gap-2">
                <RouterLink
                  to="/signup"
                  className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
                >
                  Create account
                </RouterLink>
                <RouterLink
                  to="/login"
                  className="rounded border border-line-strong px-3 py-1.5 text-sm text-ink transition-colors hover:bg-surface-hover"
                >
                  Sign in
                </RouterLink>
              </div>
            </div>
          ) : (
            <>
              <p className="px-2 pb-1 pt-1 text-xs font-medium uppercase tracking-wide text-ink-faint">
                General access
              </p>

              {MODES.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="menuitemradio"
                  aria-checked={mode === option}
                  disabled={busy}
                  onClick={() => void choose(option)}
                  className={cn(
                    'flex w-full items-start gap-2 rounded px-2 py-2 text-left transition-colors',
                    'hover:bg-surface-hover disabled:opacity-60',
                  )}
                >
                  <span className="mt-0.5 w-4 shrink-0 text-accent">
                    {mode === option && <Check size={16} strokeWidth={2.5} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm text-ink">{SHARE_MODE_LABELS[option]}</span>
                    <span className="block text-xs text-ink-muted">
                      {SHARE_MODE_HINTS[option]}
                    </span>
                  </span>
                </button>
              ))}

              <div className="mt-1 border-t border-line pt-2">
                <button
                  type="button"
                  onClick={() => void copy()}
                  disabled={!token || mode === 'private'}
                  title={
                    mode === 'private'
                      ? 'Choose an access level before copying a link'
                      : 'Copy the share link'
                  }
                  className={cn(
                    'flex w-full items-center gap-2 rounded px-2 py-2 text-sm transition-colors',
                    'text-accent hover:bg-surface-hover disabled:cursor-not-allowed disabled:text-ink-faint disabled:hover:bg-transparent',
                  )}
                >
                  <Link2 size={15} />
                  Copy link
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
