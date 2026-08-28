import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { JSONContent } from '@tiptap/react'
import { DocumentEditor } from '../editor/DocumentEditor'
import { SaveStatus, type SaveState } from '../components/SaveStatus'
import { AppDocIcon } from '../editor/DocsIcons'
import { useAuth } from '../contexts/AuthContext'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { createAutosaveScheduler } from '../lib/autosave'
import {
  copySharedDocument,
  fetchSharedDocument,
  saveSharedDocument,
  type SharedDocument,
} from '../services/sharing'
import { cn } from '../lib/cn'

const AUTOSAVE_DELAY_MS = 1000

interface DraftPayload {
  title: string
  content: JSONContent
}

/**
 * A note opened through a share link.
 *
 * Access is decided by two things together: the owner's chosen mode, and
 * whether the visitor is signed in. An editable link is still read-only until
 * they sign in -- the database enforces that too, so the UI and the row-level
 * rule agree rather than the UI being the only guard.
 */
export default function SharedDocumentPage() {
  const { token } = useParams<{ token: string }>()
  const { session, user } = useAuth()
  const navigate = useNavigate()
  const online = useOnlineStatus()

  const [shared, setShared] = useState<SharedDocument | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [title, setTitle] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [copying, setCopying] = useState(false)
  const versionRef = useRef(1)
  const contentRef = useRef<JSONContent | null>(null)

  const isOwner = Boolean(user && shared && user.id === shared.owner_id)
  const canEdit = Boolean(shared && shared.share_mode === 'edit' && session)

  useEffect(() => {
    if (!token) return
    let cancelled = false

    void fetchSharedDocument(token)
      .then((row) => {
        if (cancelled) return
        setShared(row)
        setTitle(row?.title ?? '')
        versionRef.current = row?.version ?? 1
      })
      .catch((caught) => console.error('[SharedDocumentPage] failed to load:', caught))
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })

    return () => {
      cancelled = true
    }
  }, [token])

  const persist = useCallback(
    async ({ title: nextTitle, content }: DraftPayload) => {
      if (!token || !canEdit) return
      setSaveState('saving')
      try {
        const result = await saveSharedDocument({
          token,
          title: nextTitle,
          content,
          expectedVersion: versionRef.current,
        })

        if (result.status === 'stale') {
          const fresh = await fetchSharedDocument(token)
          if (fresh) {
            versionRef.current = fresh.version
            contentRef.current = fresh.content as JSONContent
            setShared(fresh)
            setTitle(fresh.title)
          }
          setSaveState('saved')
          return
        }

        versionRef.current = result.version
        setSaveState('saved')
      } catch (caught) {
        console.error('[SharedDocumentPage] save failed:', caught)
        setSaveState('error')
      }
    },
    [token, canEdit],
  )

  const scheduler = useMemo(
    () => createAutosaveScheduler<DraftPayload>({ delayMs: AUTOSAVE_DELAY_MS, save: persist }),
    [persist],
  )

  useEffect(() => () => void scheduler.flush(), [scheduler])

  async function handleCopy() {
    if (!user || !shared) return
    setCopying(true)
    try {
      const { classId, documentId } = await copySharedDocument(user.id, shared)
      navigate(`/classes/${classId}/documents/${documentId}`)
    } catch (caught) {
      console.error('[SharedDocumentPage] copy failed:', caught)
      setCopying(false)
    }
  }

  if (!loaded) return null

  if (!shared) {
    return (
      <div className="grid min-h-full place-items-center px-6">
        <div className="text-center">
          <h1 className="text-lg font-medium text-ink">This link isn&rsquo;t available</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm text-ink-muted">
            The link may be wrong, or sharing may have been turned off for this note.
          </p>
          <Link
            to="/classes"
            className="mt-6 inline-block rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
          >
            Go to my notes
          </Link>
        </div>
      </div>
    )
  }

  const displayState: SaveState = online ? saveState : 'offline'

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-4 py-2">
        <Link to="/classes" title="Margin" className="shrink-0">
          <AppDocIcon className="h-8 w-[26px] text-ink" />
        </Link>

        <div className="min-w-0">
          <p className="truncate font-ui text-base text-docs-text">
            {shared.title || 'Untitled document'}
          </p>
          <p className="truncate font-ui text-xs text-ink-faint">
            {shared.class_name}
            {canEdit ? ' · You can edit' : ' · View only'}
          </p>
        </div>

        {canEdit && <SaveStatus state={displayState} />}

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {!session && (
            <>
              {/*
                An edit link is read-only until the visitor signs in, which is
                otherwise invisible: the page would just refuse their typing.
              */}
              <span className="hidden text-sm text-ink-muted sm:inline">
                {shared.share_mode === 'edit'
                  ? 'Sign in to edit'
                  : 'Sign in to save a copy'}
              </span>
              <Link
                to="/login"
                className="rounded-full bg-docs-chip px-4 py-2 font-ui text-sm font-medium text-docs-chip-text transition-colors hover:bg-docs-chip-hover"
              >
                Sign in
              </Link>
            </>
          )}

          {session && !isOwner && (
            <button
              type="button"
              onClick={() => void handleCopy()}
              disabled={copying}
              className={cn(
                'rounded-full bg-docs-chip px-4 py-2 font-ui text-sm font-medium text-docs-chip-text',
                'transition-colors hover:bg-docs-chip-hover disabled:opacity-60',
              )}
            >
              {copying ? 'Copying…' : 'Make a copy'}
            </button>
          )}

          {isOwner && (
            <Link
              to={`/classes/${shared.class_id}/documents/${shared.id}`}
              className="rounded-full bg-docs-chip px-4 py-2 font-ui text-sm font-medium text-docs-chip-text transition-colors hover:bg-docs-chip-hover"
            >
              Open in my notes
            </Link>
          )}
        </div>
      </header>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <DocumentEditor
          documentId={shared.id}
          version={shared.version}
          initialContent={shared.content as JSONContent}
          editable={canEdit}
          onChange={(content) => {
            contentRef.current = content
            if (canEdit) scheduler.schedule({ title, content })
          }}
        />
      </main>
    </div>
  )
}
