import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { Editor, JSONContent } from '@tiptap/react'
import { DocumentEditor } from '../editor/DocumentEditor'
import { SaveStatus, type SaveState } from '../components/SaveStatus'
import { AppDocIcon } from '../editor/DocsIcons'
import { useAuth } from '../contexts/AuthContext'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { useFlushOnUnload } from '../hooks/useFlushOnUnload'
import { useCollaboration } from '../collab/useCollaboration'
import { createAutosaveScheduler } from '../lib/autosave'
import {
  copySharedDocument,
  fetchSharedDocument,
  redeemShareToken,
  saveSharedDocument,
  type SharedDocument,
} from '../services/sharing'
import { cn } from '../lib/cn'
import { noteHref } from '../lib/noteRef'
import { ConflictDialog } from '../components/ConflictDialog'
import { CommentsSidebar } from '../comments/CommentsSidebar'
import { useComments } from '../comments/useComments'
import type { DocumentCollaboration } from '../editor/DocumentEditor'

const AUTOSAVE_DELAY_MS = 1000

const EMPTY_DOC: JSONContent = { type: 'doc', content: [] }

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
  const { session, user, profile } = useAuth()
  const navigate = useNavigate()
  const online = useOnlineStatus()

  const [shared, setShared] = useState<SharedDocument | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [title, setTitle] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveMessage, setSaveMessage] = useState<string | undefined>(undefined)
  const [copying, setCopying] = useState(false)
  /* The newer version somebody else saved, pending the writer's choice. */
  const [conflict, setConflict] = useState<SharedDocument | null>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const versionRef = useRef(1)
  const contentRef = useRef<JSONContent | null>(null)

  const isOwner = Boolean(user && shared && user.id === shared.owner_id)
  const canEdit = Boolean(shared && shared.share_mode === 'edit' && session)

  const visitorId = user?.id ?? null

  /*
   * The other side of collaborative editing.
   *
   * The owner gets it through EditorPage; this is the page everyone they
   * shared with actually lands on, so without it "collaboration" would mean
   * the owner's own tabs agreeing with each other. Two people is the case the
   * feature exists for.
   *
   * The conditions are the same ones EditorPage applies, and `canEdit` already
   * carries both: the link is an edit link, and the visitor is signed in. A
   * signed-out visitor stays on the read-only path -- which is not a UI
   * nicety, it is what the database enforces anyway, since both
   * redeem_share_token and update_shared_document refuse a null auth.uid().
   *
   * The grant this depends on was recorded by the redemption above, and it had
   * to be: Realtime authorises the channel against document_access, not
   * against the token in the address bar.
   */
  const collaboration = useCollaboration({
    documentId: shared?.id ?? null,
    userId: visitorId,
    displayName: profile?.display_name || user?.email || 'Guest',
    sharedForEditing: canEdit,
    content: (shared?.content as JSONContent | undefined) ?? EMPTY_DOC,
  })

  // Yjs updates are debounced before being written, exactly like autosave, so
  // the same "the tab is going away" signal has to reach both.
  useFlushOnUnload(collaboration.flush)

  /*
   * Read inside `persist`, which is memoised and would otherwise close over
   * whatever this was when the link first opened.
   *
   * Synced in an effect rather than assigned during render: writing a ref
   * while rendering is the thing that makes a component's output depend on
   * when it happened to run. The one render of lag is harmless here, because
   * the only reader is a debounced save a second away, by which point effects
   * have long since run.
   */
  const collaboratingRef = useRef(false)
  useEffect(() => {
    collaboratingRef.current = collaboration.active
  }, [collaboration.active])

  useEffect(() => {
    const shareToken = token
    if (!shareToken) return
    let cancelled = false

    // An arrow expression rather than a hoisted `function` declaration: the
    // latter is not narrowed by the guard above, since TypeScript cannot rule
    // out its being called before it.
    const open = async () => {
      /*
       * Two things happen on opening a link, and the redemption is the new one.
       *
       * Reading the note needs only the token. Joining the note's Realtime
       * channel does not: Realtime authorises a subscription with RLS on
       * realtime.messages, which sees a user and has no idea what link they
       * followed. So a signed-in visitor's token has to become a row in
       * document_access before the channel will have them, and that has to be
       * done before anything tries to subscribe -- hence awaiting it here
       * rather than firing it off beside the editor.
       *
       * Anonymous visitors are skipped entirely. redeem_share_token refuses a
       * null auth.uid(), which is the same rule update_shared_document already
       * enforces: an edit link is read-only until you sign in.
       */
      const [row] = await Promise.all([
        fetchSharedDocument(shareToken).catch((caught) => {
          console.error('[SharedDocumentPage] failed to load:', caught)
          return null
        }),
        visitorId
          ? redeemShareToken(shareToken).catch((caught) => {
              /*
               * A failed redemption is not a failed page. The note still opens
               * and still saves, because both go through the token; only live
               * collaboration would be missing. Reported to the console and
               * nowhere else -- an on-screen message here would say "this
               * token exists but something went wrong", which is exactly the
               * distinction between a revoked link and a private note that
               * the whole design refuses to leak.
               */
              console.error('[SharedDocumentPage] could not record access:', caught)
              return null
            })
          : Promise.resolve(null),
      ])

      if (cancelled) return
      setShared(row)
      setTitle(row?.title ?? '')
      versionRef.current = row?.version ?? 1
      setLoaded(true)
    }

    void open()


    return () => {
      cancelled = true
    }
  }, [token, visitorId])

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
          /*
           * The other side of "Anyone with the link can edit".
           *
           * Two people typing means one of them saves second and is refused.
           * This used to answer that by loading the other person's version
           * over the top, so whatever they had just written vanished with no
           * message and the pill still said "Saved". Both versions are kept
           * now and they choose; nothing here touches the editor.
           */
          const fresh = await fetchSharedDocument(token)
          if (fresh) {
            /*
             * While collaborating there is nothing to reconcile. Both writers
             * are editing one Yjs document and each merely rewrites
             * documents.content from it, so the versions racing is expected
             * rather than a conflict -- and offering "use theirs" would push
             * content into a Yjs-backed editor, duplicating it. Adopt the
             * version and carry on.
             */
            if (collaboratingRef.current) {
              versionRef.current = fresh.version
              setSaveState('saved')
              return
            }

            setConflict(fresh)
            setSaveState('conflict')
            return
          }
          setSaveState('error')
          return
        }

        // Shared saves go through Postgres, which throws rather than returning
        // a refusal -- but the type admits one, and a save that did not happen
        // must never read as "Saved" here either.
        if (result.status === 'failed') {
          setSaveMessage(result.message)
          setSaveState('failed')
          return
        }

        setSaveMessage(undefined)
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
  // React's cleanup above covers moving between notes. A browser reload or a
  // closed tab runs none of it, so the debounce window was a loss window.
  useFlushOnUnload(scheduler.flush)

  /** Keeps what is on screen and saves it over the newer stored version. */
  const keepMine = () => {
    if (!conflict) return
    versionRef.current = conflict.version
    setConflict(null)
    scheduler.schedule({ title, content: contentRef.current ?? (conflict.content as JSONContent) })
    void scheduler.flush()
  }

  /** Discards the local edits and loads the version somebody else saved. */
  const useTheirs = () => {
    if (!conflict) return
    versionRef.current = conflict.version
    contentRef.current = conflict.content as JSONContent
    setTitle(conflict.title)
    setShared(conflict)
    setConflict(null)
    setSaveState('saved')
  }

  async function handleCopy() {
    if (!user || !shared) return
    setCopying(true)
    try {
      const { classSlug, noteSlug, noteId } = await copySharedDocument(user.id, shared)
      navigate(noteHref(classSlug, noteSlug, noteId))
    } catch (caught) {
      console.error('[SharedDocumentPage] copy failed:', caught)
      setCopying(false)
    }
  }

  /*
   * `collaboration.pending` joins `loaded` because mounting the editor before
   * the session is decided mounts the wrong one: a single-writer editor for a
   * frame, whose keystrokes would land in a ProseMirror document about to be
   * replaced by one seeded from content read a moment earlier.
   */
  /*
   * Comments, for the people the note was shared with.
   *
   * This is the page a collaborator actually lands on, so a comment panel that
   * existed only in EditorPage was a comment panel only the owner could see --
   * which is most of the way to not having comments at all. The database
   * already allowed it: can_view_document covers anyone holding a
   * document_access grant, which is what redeeming the share link records.
   *
   * Above the early returns, because hooks cannot be called conditionally.
   */
  const comments = useComments({
    documentId: shared?.id ?? '',
    userId: visitorId,
    editor,
    ydoc: collaboration.active ? collaboration.ydoc : null,
  })

  if (!loaded || collaboration.pending) return null

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

  const displayState: SaveState =
    saveState === 'failed' ? 'failed' : online ? saveState : 'offline'

  /*
   * Plain constants rather than memoised values: this sits below the early
   * returns above, where a hook cannot go. `editorCollaboration` changes
   * identity when the channel drops, which is deliberate -- the presence bar
   * has to re-render to say so -- while `collaborationKey` stays put.
   */
  const editorCollaboration: DocumentCollaboration | undefined =
    collaboration.active && collaboration.ydoc && collaboration.provider && collaboration.user
      ? {
          ydoc: collaboration.ydoc,
          provider: collaboration.provider,
          user: collaboration.user,
          connected: collaboration.connected,
        }
      : undefined

  const collaborationKey = editorCollaboration ? `collab:${shared.id}` : 'solo'

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

        {canEdit && <SaveStatus state={displayState} message={saveMessage} />}

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
              to={noteHref(shared.class_slug, shared.slug, shared.id)}
              className="rounded-full bg-docs-chip px-4 py-2 font-ui text-sm font-medium text-docs-chip-text transition-colors hover:bg-docs-chip-hover"
            >
              Open in my notes
            </Link>
          )}
        </div>
      </header>

      <ConflictDialog
        open={conflict !== null}
        onKeepMine={keepMine}
        onUseTheirs={useTheirs}
      />

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <DocumentEditor
          // Keyed on the session, not the note: turning collaboration on
          // changes which extensions the editor was built with, and that is
          // not something Tiptap can be asked to swap in place. The key holds
          // still across a reconnect, so a dropped channel does not rebuild it.
          key={collaborationKey}
          collaboration={editorCollaboration}
          documentId={shared.id}
          version={shared.version}
          initialContent={shared.content as JSONContent}
          editable={canEdit}
          onReady={setEditor}
          onAddComment={visitorId ? () => comments.startDraft() : undefined}
          canAddComment={comments.canComment}
          onChange={(content) => {
            contentRef.current = content
            if (canEdit) scheduler.schedule({ title, content })
          }}
          sidebar={
            <CommentsSidebar
              threads={comments.threads}
              activeThreadId={comments.activeThreadId}
              currentUserId={visitorId}
              draft={comments.draft}
              onSubmitDraft={(body) => void comments.submitDraft(body)}
              onCancelDraft={comments.cancelDraft}
              busy={comments.loading}
              error={comments.error}
              onSelect={comments.setActiveThreadId}
              onReply={(threadId, body) => void comments.reply(threadId, body)}
              onResolve={(threadId, resolved) => void comments.resolve(threadId, resolved)}
              onDeleteThread={(threadId) => void comments.removeThread(threadId)}
              onDeleteComment={(commentId) => void comments.removeComment(commentId)}
            />
          }
        />
      </main>
    </div>
  )
}
