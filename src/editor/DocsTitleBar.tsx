import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, Link2, Redo2, Star, Undo2 } from 'lucide-react'
import { useEditorState, type Editor } from '@tiptap/react'
import { AppDocIcon, SparkIcon } from './DocsIcons'
import { SaveStatus, type SaveState } from '../components/SaveStatus'
import { useAuth } from '../contexts/AuthContext'
import { cn } from '../lib/cn'

/**
 * The title row of the editor chrome: document icon, title, star, menu bar,
 * and the cluster of controls on the right.
 *
 * Two of those controls -- comments and video calls -- have no counterpart in
 * this app. They are rendered because the row is a deliberate reproduction and
 * their absence would be conspicuous, but they carry `aria-disabled` and say
 * so on hover rather than silently doing nothing when clicked.
 */

interface DocsTitleBarProps {
  documentId: string
  title: string
  onTitleChange: (title: string) => void
  saveState: SaveState
  /** Where the document icon navigates, i.e. the class this note belongs to. */
  backTo: string
  backLabel: string
  menubar: ReactNode
  aiOpen: boolean
  onToggleAi: () => void
  /** Drives the undo/redo pair that sits beside the star. */
  editor: Editor | null
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
  backTo,
  backLabel,
  menubar,
  aiOpen,
  onToggleAi,
  editor,
}: DocsTitleBarProps) {
  const { profile, session, signOut } = useAuth()
  const signedIn = Boolean(session)

  // Subscribed rather than read during render: Tiptap 3 does not re-render
  // React per transaction, so the enabled state would otherwise go stale the
  // moment the caret moved.
  const history = useEditorState({
    editor,
    selector: ({ editor: instance }) =>
      instance
        ? { canUndo: instance.can().undo(), canRedo: instance.can().redo() }
        : { canUndo: false, canRedo: false },
  })

  const [starOverrides, setStarOverrides] = useState<Record<string, boolean>>({})
  const [shareNote, setShareNote] = useState<string | null>(null)
  const [accountOpen, setAccountOpen] = useState(false)
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

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setShareNote('Link copied')
    } catch {
      setShareNote('Copy failed')
    }
    window.setTimeout(() => setShareNote(null), 2000)
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

  const displayName = profile?.display_name ?? session?.user.email ?? 'Guest'
  const initial = displayName.trim().charAt(0).toUpperCase() || 'G'

  return (
    <div className="flex items-start gap-1 bg-surface px-3 pt-1.5">
      <Link
        to={backTo}
        title={backLabel}
        aria-label={backLabel}
        className="mt-0.5 shrink-0 rounded p-1.5 transition-colors hover:bg-docs-chrome-hover"
      >
        <AppDocIcon className="h-9 w-[28px]" />
      </Link>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-w-0 items-center gap-1">
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

          <button
            type="button"
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
            disabled={!history?.canUndo}
            onClick={() => editor?.chain().focus().undo().run()}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-docs-icon transition-colors hover:bg-docs-chrome-hover disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <Undo2 size={16} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            title="Redo (Ctrl+Shift+Z)"
            aria-label="Redo"
            disabled={!history?.canRedo}
            onClick={() => editor?.chain().focus().redo().run()}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-docs-icon transition-colors hover:bg-docs-chrome-hover disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <Redo2 size={16} strokeWidth={1.8} />
          </button>

          <SaveStatus state={saveState} />
        </div>

        <div className="-ml-1 flex min-w-0 items-center">{menubar}</div>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1 pt-1">
        <button
          type="button"
          onClick={() => void copyLink()}
          title="Copy a link to this note"
          className={cn(
            'flex h-9 shrink-0 items-center gap-2 rounded-full bg-docs-chip px-3 sm:pl-4 sm:pr-3',
            'font-ui text-sm font-medium text-docs-chip-text transition-colors hover:bg-docs-chip-hover',
          )}
        >
          <Link2 size={15} strokeWidth={2} />
          <span className="hidden sm:inline">{shareNote ?? 'Share'}</span>
          <span
            className="ml-1 hidden h-5 w-px bg-docs-chip-text/25 sm:block"
            aria-hidden="true"
          />
          <ChevronDown size={16} className="hidden sm:block" aria-hidden="true" />
        </button>

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
          to="/signup"
          title={
            signedIn
              ? 'You already have an account'
              : 'Create an account to sync these notes'
          }
          className={cn(
            'hidden h-9 shrink-0 items-center rounded-full bg-docs-chip px-5 lg:flex',
            'font-ui text-sm font-medium text-docs-chip-text transition-colors hover:bg-docs-chip-hover',
          )}
        >
          Upgrade
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

              <div className="mt-3 flex gap-2">
                {signedIn ? (
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
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
