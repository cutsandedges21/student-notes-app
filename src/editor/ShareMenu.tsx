import { useCallback, useEffect, useRef, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { Check, ChevronDown, Link2, RotateCcw } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import {
  SHARE_MODE_HINTS,
  SHARE_MODE_LABELS,
  fetchShareState,
  listDocumentAccess,
  revokeDocumentAccess,
  rotateShareToken,
  setShareMode,
  shareUrl,
  type DocumentAccessEntry,
  type ShareMode,
} from '../services/sharing'
import { Button } from '../components/ui/Button'
import { Dialog } from '../components/ui/Dialog'
import { cn } from '../lib/cn'

const MODES: ShareMode[] = ['private', 'view', 'edit']

const ACCESS_MODE_LABELS: Record<DocumentAccessEntry['mode'], string> = {
  view: 'Can view',
  edit: 'Can edit',
}

function formatGrantedAt(iso: string): string {
  const when = new Date(iso)
  return Number.isNaN(when.getTime()) ? 'earlier' : when.toLocaleDateString()
}

/**
 * Share control.
 *
 * Sharing needs an account: the link points at a row in the database, so a
 * guest's browser-local note has nothing to share. Rather than failing after
 * the click, the menu says so and offers a way to sign in.
 *
 * Ownership is read rather than assumed. `documents_select_own` means
 * fetchShareState only ever returns a row to the note's owner, but the access
 * list is other people's names and the revoke button is destructive, so the
 * component compares the row's user_id against the session instead of relying
 * on where it happens to be mounted.
 */
export function ShareMenu({
  documentId,
  onModeChange,
}: {
  documentId: string
  /**
   * Reports the mode after a change, and after the first read.
   *
   * The menu used to keep the mode entirely to itself, which meant the page
   * hosting it never learned that a note had become collaborative. Live
   * editing is gated on exactly that fact, so turning sharing on did nothing
   * until the page was reloaded -- the switch flipped, the link worked, and
   * the owner's own editor stayed single-writer.
   */
  onModeChange?: (mode: ShareMode) => void
}) {
  const { session } = useAuth()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<ShareMode>('private')
  const [token, setToken] = useState<string | null>(null)
  const [ownerId, setOwnerId] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [access, setAccess] = useState<DocumentAccessEntry[] | null>(null)
  const [accessFailed, setAccessFailed] = useState(false)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [confirmingReset, setConfirmingReset] = useState(false)
  const [rotating, setRotating] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  /*
   * Held in a ref so the fetch effect does not depend on the callback's
   * identity. A caller passing an inline arrow would otherwise re-run the
   * share-state read on every one of its renders, which is a network request
   * per keystroke in the note's title.
   */
  const notifyModeRef = useRef(onModeChange)
  useEffect(() => {
    notifyModeRef.current = onModeChange
  }, [onModeChange])

  const isOwner = Boolean(session && ownerId && session.user.id === ownerId)

  useEffect(() => {
    if (!open || !session) return

    let cancelled = false
    void fetchShareState(documentId)
      .then((state) => {
        if (cancelled || !state) return
        setMode(state.mode)
        setToken(state.token)
        setOwnerId(state.ownerId)
        notifyModeRef.current?.(state.mode)
      })
      .catch((caught) => console.error('[ShareMenu] failed to read share state:', caught))

    return () => {
      cancelled = true
    }
  }, [open, session, documentId])

  const loadAccess = useCallback(
    () =>
      listDocumentAccess(documentId)
        .then((rows) => {
          setAccess(rows)
          setAccessFailed(false)
        })
        .catch((caught) => {
          // Deliberately not rendered as an empty list: "nobody has access"
          // and "we could not find out" are different answers, and only one of
          // them makes the reset button unnecessary.
          console.error('[ShareMenu] failed to read who has access:', caught)
          setAccessFailed(true)
        }),
    [documentId],
  )

  useEffect(() => {
    if (!open || !isOwner) return
    void loadAccess()
  }, [open, isOwner, loadAccess])

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function handleKeyDown(event: KeyboardEvent) {
      // While the reset confirmation is up, Escape belongs to it. Closing the
      // menu underneath would take the confirmation with it.
      if (confirmingReset) return
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, confirmingReset])

  function flash(message: string) {
    setNote(message)
    window.setTimeout(() => setNote(null), 2000)
  }

  async function choose(next: ShareMode) {
    setBusy(true)
    try {
      await setShareMode(documentId, next)
      setMode(next)
      // Tell the page, so an editor that is now collaborative becomes one
      // without waiting for a reload.
      notifyModeRef.current?.(next)
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
      flash('Link copied')
    } catch {
      flash('Copy failed')
    }
  }

  /**
   * Rotates the token, then shows the token that came back.
   *
   * Showing the returned value rather than re-reading is the point: the old
   * URL is dead the instant this resolves, and a menu still displaying it
   * would be handing out an address that no longer opens anything.
   */
  async function resetLink() {
    setRotating(true)
    setResetError(null)
    try {
      const fresh = await rotateShareToken(documentId)
      setToken(fresh)
      setConfirmingReset(false)
      flash('New link created')
      // The grants the old link handed out are gone with it; re-read rather
      // than assume, since the server decides what survived.
      await loadAccess()
    } catch (caught) {
      console.error('[ShareMenu] failed to reset the link:', caught)
      setResetError('Could not reset the link. The current link still works.')
    } finally {
      setRotating(false)
    }
  }

  async function revoke(userId: string) {
    setRevoking(userId)
    try {
      await revokeDocumentAccess(documentId, userId)
      await loadAccess()
    } catch (caught) {
      console.error('[ShareMenu] failed to remove access:', caught)
      flash('Could not remove access')
    } finally {
      setRevoking(null)
    }
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
                {token && mode !== 'private' && (
                  /*
                   * The link itself, on screen.
                   *
                   * Not decoration: resetting it replaces the secret, and a
                   * menu that only ever offered "Copy link" gave no way to
                   * tell whether the clipboard now holds the new address or
                   * the dead one.
                   */
                  <input
                    readOnly
                    aria-label="Share link"
                    value={shareUrl(token)}
                    onFocus={(event) => event.currentTarget.select()}
                    className={cn(
                      'mb-1 w-full rounded border border-line bg-surface-hover px-2 py-1.5',
                      'font-mono text-xs text-ink-muted',
                    )}
                  />
                )}

                <div className="flex items-center gap-1">
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
                      'flex flex-1 items-center gap-2 rounded px-2 py-2 text-sm transition-colors',
                      'text-accent hover:bg-surface-hover disabled:cursor-not-allowed disabled:text-ink-faint disabled:hover:bg-transparent',
                    )}
                  >
                    <Link2 size={15} />
                    Copy link
                  </button>

                  {/*
                    Enabled even while sharing is off, because that is the
                    sequence the old behaviour broke: turning sharing off and
                    on again restored the identical URL. Resetting it while
                    private is how the owner makes sure it does not.
                  */}
                  <button
                    type="button"
                    onClick={() => {
                      setResetError(null)
                      setConfirmingReset(true)
                    }}
                    disabled={!token}
                    title="Create a new link and stop the current one working"
                    className={cn(
                      'flex items-center gap-2 rounded px-2 py-2 text-sm transition-colors',
                      'text-ink-muted hover:bg-surface-hover hover:text-ink',
                      'disabled:cursor-not-allowed disabled:text-ink-faint disabled:hover:bg-transparent',
                    )}
                  >
                    <RotateCcw size={15} />
                    Reset link
                  </button>
                </div>
              </div>

              {isOwner && (
                <div className="mt-1 border-t border-line pt-2">
                  <p className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-ink-faint">
                    People with access
                  </p>

                  {accessFailed && (
                    <p className="px-2 py-1 text-xs text-ink-muted">
                      Couldn&rsquo;t load who has access.
                    </p>
                  )}

                  {!accessFailed && access?.length === 0 && (
                    <p className="px-2 py-1 text-xs text-ink-muted">
                      Nobody has opened the link yet. Signing in through it is what
                      puts somebody here.
                    </p>
                  )}

                  {!accessFailed && access && access.length > 0 && (
                    <ul>
                      {access.map((entry) => (
                        <li
                          key={entry.userId}
                          className="flex items-center gap-2 rounded px-2 py-1.5"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-ink">
                              {entry.displayName}
                            </span>
                            <span className="block text-xs text-ink-muted">
                              {ACCESS_MODE_LABELS[entry.mode]} &middot; since{' '}
                              {formatGrantedAt(entry.grantedAt)}
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={() => void revoke(entry.userId)}
                            disabled={revoking === entry.userId}
                            aria-label={`Remove ${entry.displayName}`}
                            className={cn(
                              'shrink-0 rounded px-2 py-1 text-xs text-ink-muted transition-colors',
                              'hover:bg-surface-hover hover:text-ink disabled:opacity-60',
                            )}
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/*
        Outside the `open &&` block on purpose: the confirmation has to survive
        the menu closing underneath it, and it is inside the container so the
        outside-click handler counts a click on the dialog as inside.
      */}
      {confirmingReset && (
        <Dialog
          open
          onClose={() => {
            if (!rotating) setConfirmingReset(false)
          }}
          title="Reset the share link?"
        >
          <p className="text-sm text-ink-muted">
            This makes a new link and kills the current one. Everyone who has
            opened the old link loses access straight away — including anyone
            reading or editing it right now — and the old address stops working
            for good.
          </p>
          <p className="mt-3 text-sm text-ink-muted">
            Nothing in the note changes, and nobody&rsquo;s work is deleted. You
            will need to send the new link to anyone who should still have it.
          </p>

          {resetError && (
            <p role="alert" className="mt-3 text-sm text-red-600">
              {resetError}
            </p>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={() => setConfirmingReset(false)} disabled={rotating}>
              Keep the current link
            </Button>
            <Button
              variant="primary"
              loading={rotating}
              onClick={() => void resetLink()}
            >
              Reset link and remove everyone
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  )
}
