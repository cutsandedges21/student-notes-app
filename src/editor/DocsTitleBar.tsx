import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Star, MessageSquareText } from 'lucide-react'
import { AppDocIcon, SparkIcon } from './DocsIcons'
import { ShareMenu } from './ShareMenu'
import type { ShareMode } from '../services/sharing'
import { deleteOwnAccount } from '../services/account'
import { SaveStatus, type SaveState } from '../components/SaveStatus'
import { useAuth } from '../contexts/AuthContext'
import { cn } from '../lib/cn'

/**
 * The title row of the editor chrome: document icon, title, star, menu bar,
 * and the cluster of controls on the right.
 *
 * The comment button carries the count of open threads. That is the whole
 * reason it is here rather than only in the formatting toolbar: the panel is
 * closed by default, so a note could hold a conversation and say nothing about
 * it anywhere on screen. A number in the chrome is what makes an existing
 * discussion discoverable without opening anything.
 */

interface DocsTitleBarProps {
  documentId: string
  title: string
  onTitleChange: (title: string) => void
  saveState: SaveState
  /** Why the last save failed, in the user's terms. Shown beside the state. */
  saveMessage?: string
  /** Reports the note's share mode upward; live editing is gated on it. */
  onShareModeChange?: (mode: ShareMode) => void
  /** Offered when a save was refused, so the state is not a dead end. */
  onRetrySave?: () => void
  /** Where the document icon navigates, i.e. the class this note belongs to. */
  backTo: string
  backLabel: string
  menubar: ReactNode
  aiOpen: boolean
  onToggleAi: () => void
  /** Open threads on this note. Rendered as a badge; hidden at zero. */
  commentCount?: number
  /** Absent where commenting is impossible, in which case no button appears. */
  onOpenComments?: () => void
}

const STAR_PREFIX = 'margin:starred:'

/** Round icon button sitting directly on the white chrome. */
function ChromeButton({
  label,
  onClick,
  unavailable,
  className,
  children,
}: {
  label: string
  onClick?: () => void
  unavailable?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={unavailable ? `${label} — not available in Margin` : label}
      aria-label={label}
      aria-disabled={unavailable || undefined}
      onClick={unavailable ? undefined : onClick}
      className={cn(
        'grid h-10 w-10 shrink-0 place-items-center rounded-full text-docs-icon transition-colors',
        unavailable ? 'cursor-default' : 'hover:bg-docs-chrome-hover',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function DocsTitleBar({
  documentId,
  title,
  onTitleChange,
  saveState,
  saveMessage,
  onShareModeChange,
  onRetrySave,
  backTo,
  backLabel,
  menubar,
  aiOpen,
  onToggleAi,
  commentCount = 0,
  onOpenComments,
}: DocsTitleBarProps) {
  const { profile, session, signOut } = useAuth()
  const navigate = useNavigate()
  const signedIn = Boolean(session)


  const [starOverrides, setStarOverrides] = useState<Record<string, boolean>>({})
  const [accountOpen, setAccountOpen] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleteInput, setDeleteInput] = useState('')
  const [deleting, setDeleting] = useState(false)
  const accountRef = useRef<HTMLDivElement>(null)

  // Starring is a local bookmark: there is no column for it on the document,
  // and inventing one just to light up an icon would be a schema change in
  // service of decoration.
  const starKey = STAR_PREFIX + documentId

  // Read straight through to storage during render, keyed by document, so
  // navigating between notes shows the right state without an effect that has
  // to chase the id.
  const starred = starOverrides[documentId] ?? window.localStorage.getItem(starKey) === '1'

  const toggleStar = () => {
    if (starred) window.localStorage.removeItem(starKey)
    else window.localStorage.setItem(starKey, '1')
    setStarOverrides((current) => ({ ...current, [documentId]: !starred }))
  }


  // Same dismissal contract as every other transient surface in the app.
  useEffect(() => {
    if (!accountOpen) return

    function handlePointerDown(event: MouseEvent) {
      if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false)
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setAccountOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [accountOpen])

  async function handleDeleteAccount() {
    setDeleting(true)
    try {
      await deleteOwnAccount()
      // The session is gone with the row; signing out clears it locally so the
      // app doesn't keep rendering as though someone were still logged in.
      await signOut().catch(() => undefined)
      navigate('/classes', { replace: true })
    } catch (caught) {
      console.error('[DocsTitleBar] account deletion failed:', caught)
      setDeleting(false)
    }
  }

  const displayName = profile?.display_name ?? session?.user.email ?? 'Guest'
  const initial = displayName.trim().charAt(0).toUpperCase() || 'G'

  return (
    <div className="bg-surface px-3 pt-1.5">
    <div className="flex items-start gap-1">
      <Link
        to={backTo}
        title={backLabel}
        aria-label={backLabel}
        className="mt-0.5 shrink-0 rounded p-1.5 transition-colors hover:bg-docs-chrome-hover"
      >
        <AppDocIcon className="h-9 w-[28px]" />
      </Link>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Nudged down so the title sits on the icon's vertical centre;
            the icon is taller than this row and spans the menus below. */}
        <div className="mt-[15px] flex min-w-0 items-center gap-1">
          <label htmlFor="doc-title" className="sr-only">
            Note title
          </label>
          <input
            id="doc-title"
            value={title}
            placeholder="Untitled document"
            onChange={(event) => onTitleChange(event.target.value)}
            className={cn(
              'min-w-0 max-w-full rounded border border-transparent bg-transparent px-1.5 py-0.5',
              'font-ui text-[18px] leading-6 text-docs-text placeholder:text-ink-faint',
              'hover:border-docs-outline focus:border-docs-active-icon',
            )}
            // Sized to the placeholder while empty, so an untitled note shows
            // "Untitled document" in full rather than clipping it.
            size={Math.max(12, Math.min(48, (title || 'Untitled document').length))}
          />

          <button
            type="button"
            title={starred ? 'Remove star' : 'Star'}
            aria-label={starred ? 'Remove star' : 'Star'}
            aria-pressed={starred}
            onClick={toggleStar}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-docs-icon transition-colors hover:bg-docs-chrome-hover"
          >
            <Star
              size={16}
              strokeWidth={1.8}
              className={cn(starred && 'fill-docs-active-icon text-docs-active-icon')}
            />
          </button>

          <SaveStatus state={saveState} message={saveMessage} onRetry={onRetrySave} />
        </div>

      </div>

      <div className="ml-auto flex shrink-0 items-center gap-3 pt-1">
        {onOpenComments && (
          <ChromeButton
            label={
              commentCount === 0
                ? 'Comments'
                : `Comments (${commentCount} open)`
            }
            onClick={onOpenComments}
            className="relative"
          >
            <MessageSquareText size={20} strokeWidth={1.8} />
            {commentCount > 0 && (
              /* Marked presentational: the count is already in the button's
                 accessible name, and announcing it twice reads as
                 "Comments 3 open, 3". */
              <span
                aria-hidden="true"
                className={cn(
                  'absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full px-1',
                  'bg-docs-active-icon font-ui text-[10px] font-medium leading-none text-white',
                )}
              >
                {commentCount > 9 ? '9+' : commentCount}
              </span>
            )}
          </ChromeButton>
        )}

        <ShareMenu documentId={documentId} onModeChange={onShareModeChange} />

        {/* The panel is permanently docked from `lg` up, so no trigger is
            needed there. Below that it opens as a drawer, which still has to
            be reachable from somewhere. */}
        <ChromeButton
          label="AI assistant (Ctrl+Shift+A)"
          onClick={onToggleAi}
          className={cn('lg:hidden', aiOpen && 'bg-docs-chrome-hover')}
        >
          <SparkIcon size={20} />
        </ChromeButton>

        <Link
          to="/upgrade"
          title="What Margin does, and what is still being built"
          className={cn(
            'hidden h-9 shrink-0 items-center rounded-full bg-docs-chip px-5 lg:flex',
            'font-ui text-sm font-medium text-docs-chip-text transition-colors hover:bg-docs-chip-hover',
          )}
        >
          Roadmap
        </Link>

        <div ref={accountRef} className="relative">
          <button
            type="button"
            title={displayName}
            aria-label={`Account: ${displayName}`}
            aria-haspopup="menu"
            aria-expanded={accountOpen}
            onClick={() => setAccountOpen((open) => !open)}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-docs-avatar font-ui text-sm font-medium text-white"
          >
            {initial}
          </button>

          {accountOpen && (
            <div
              role="menu"
              aria-label="Account"
              className="absolute right-0 z-40 mt-2 w-64 rounded-lg border border-line bg-surface p-4 shadow-menu"
            >
              <p className="truncate font-ui text-sm text-docs-text">{displayName}</p>
              <p className="mt-1 text-xs text-ink-faint">
                {signedIn ? 'Signed in' : 'Saved on this device'}
              </p>

              {/*
                Deletion is irreversible and cascades to every note, so it asks
                for the account name to be typed out. The confirmation replaces
                the buttons in place rather than opening a second surface, which
                keeps the menu the same size either way.
              */}
              {signedIn && confirmingDelete ? (
                <div className="mt-3">
                  <p className="text-xs text-ink-muted">
                    This deletes your account and every note. Type{' '}
                    <span className="font-medium text-docs-text">{displayName}</span> to
                    confirm.
                  </p>
                  <label htmlFor="delete-confirm" className="sr-only">
                    Type {displayName} to confirm
                  </label>
                  <input
                    id="delete-confirm"
                    value={deleteInput}
                    autoFocus
                    onChange={(event) => setDeleteInput(event.target.value)}
                    className="mt-2 h-8 w-full rounded border border-line-strong px-2 font-ui text-sm text-docs-text"
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmingDelete(false)
                        setDeleteInput('')
                      }}
                      className="rounded-full border border-line px-3 py-1.5 font-ui text-sm text-docs-text transition-colors hover:bg-docs-chrome-hover"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={deleteInput !== displayName || deleting}
                      onClick={() => void handleDeleteAccount()}
                      className="rounded-full bg-red-600 px-3 py-1.5 font-ui text-sm text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {deleting ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>
              ) : (
              <div className="mt-3 flex gap-2">
                {signedIn ? (
                  <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setAccountOpen(false)
                      void signOut()
                    }}
                    className="rounded-full border border-line px-4 py-1.5 font-ui text-sm text-docs-text transition-colors hover:bg-docs-chrome-hover"
                  >
                    Sign out
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => setConfirmingDelete(true)}
                    className="rounded-full border border-red-600 px-4 py-1.5 font-ui text-sm text-red-600 transition-colors hover:bg-red-50"
                  >
                    Delete
                  </button>
                  </>
                ) : (
                  <>
                    <Link
                      to="/login"
                      role="menuitem"
                      className="rounded-full border border-line px-4 py-1.5 font-ui text-sm text-docs-text transition-colors hover:bg-docs-chrome-hover"
                    >
                      Sign in
                    </Link>
                    <Link
                      to="/signup"
                      role="menuitem"
                      className="rounded-full bg-docs-chip px-4 py-1.5 font-ui text-sm text-docs-chip-text transition-colors hover:bg-docs-chip-hover"
                    >
                      Sign up
                    </Link>
                  </>
                )}
              </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>

      {/*
        The menus sit in their own full-width row rather than under the title.
        Nested in the title's column they would centre on that column's axis,
        which is offset from the toolbar's by the width of the document icon
        and the controls on the right -- close enough to look like a mistake.
      */}
      {/*
        Docked left, on the same line as the document-actions pill in the
        toolbar below. The pill sits at --chrome-gutter from the window edge;
        this wrapper is already inset by the row's own px-3, so it only has to
        add the difference. Below `lg` the pill loses its offset and both land
        on that px-3, which is why the padding is scoped to `lg`.

        The -ml-2 cancels the first menu button's own px-2. Aligning the button
        boxes puts the "F" of File 8px inside the pill's edge, which reads as a
        misalignment; what the eye lines up is the glyph, not the invisible
        hover target around it.
      */}
      <div className="-ml-2 flex min-w-0 items-center lg:pl-[calc(var(--chrome-gutter)-0.75rem)]">
        {menubar}
      </div>
    </div>
  )
}
