import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { JSONContent } from '@tiptap/react'
import { DocumentEditor, type DocumentCollaboration } from '../editor/DocumentEditor'
import { useCollaboration } from '../collab/useCollaboration'
import {
  isPageNumberPosition,
  type PageNumberPosition,
} from '../editor/pagination/types'
import { DocumentMenubar } from '../editor/DocumentMenubar'
import { LinkDialog } from '../editor/LinkDialog'
import { ImageDialog } from '../editor/ImageDialog'
import { FindReplacePanel } from '../editor/FindReplacePanel'
import { WordCountDialog } from '../editor/WordCountDialog'
import { EquationDialog } from '../editor/EquationDialog'
import { useDocumentDialogs } from '../editor/useDocumentDialogs'
import { DocsTitleBar } from '../editor/DocsTitleBar'
import { SelectionToolbar } from '../editor/SelectionToolbar'
import { AiBubble } from '../editor/AiBubble'
import { printNote } from '../editor/printDocument'
import { US_LETTER, type PageGeometry } from '../editor/pagination/geometry'
import { AiSidebar, type AiSelection } from '../ai/AiSidebar'
import { CommentsSidebar } from '../comments/CommentsSidebar'
import { useComments } from '../comments/useComments'
import { SidePanel } from '../components/SidePanel'
import { markdownToHtml, isInlineSuggestion, escapeHtml } from '../lib/markdown'
import { aiPreviewKey } from '../editor/aiPreview'
import {
  applySuggestion,
  describeRefusal,
  type ApplyResult,
  type SuggestionTarget,
} from '../editor/applySuggestion'
import { describeDataError } from '../lib/dataErrors'
import { noteHref, parseNoteRef, sharedNoteHref } from '../lib/noteRef'
import type { ShareMode } from '../services/sharing'
import { matchAiShortcut } from '../lib/shortcuts'
import { ShortcutsDialog } from '../components/ShortcutsDialog'
import { LoadingScreen } from '../components/LoadingScreen'
import { snapshotDocument } from '../services/documents'
import type { AiMode } from '../types/ai'
import type { Editor } from '@tiptap/react'
import { type SaveState } from '../components/SaveStatus'
import { StorageNotice, type StorageFailure } from '../components/StorageNotice'
import { ConflictDialog } from '../components/ConflictDialog'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { AiDrawer } from '../components/AiDrawer'
import { useAuth } from '../contexts/AuthContext'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useMinimumVisible } from '../hooks/useMinimumVisible'
import { useFlushOnUnload } from '../hooks/useFlushOnUnload'
import { createAutosaveScheduler } from '../lib/autosave'
import { fetchClass, fetchClassBySlug } from '../services/classes'
import {
  createDocument,
  deleteDocument,
  fetchDocument,
  fetchDocumentBySlug,
  saveDocument,
} from '../services/documents'
import type { ClassRow, DocumentRow } from '../types/database'

const AUTOSAVE_DELAY_MS = 1000

/**
 * How long the loading state stays up once shown.
 *
 * Long enough to read as a beat rather than a flicker, short enough not to
 * be felt on every reload. It is a floor, not a delay: the note still appears
 * the moment it is ready if it takes longer than this.
 */
const LOADING_HOLD_MS = 350

interface DraftPayload {
  title: string
  content: JSONContent
}

const EMPTY_DOC: JSONContent = { type: 'doc', content: [] }

export default function EditorPage() {
  const { classSlug, noteRef } = useParams<{ classSlug: string; noteRef: string }>()
  const { user, profile, loading: authLoading } = useAuth()
  const online = useOnlineStatus()
  // Matches the `lg:` breakpoint the panel's own visibility classes use.
  const panelDocked = useMediaQuery('(min-width: 1024px)')

  // null while signed out -- services then read and write browser storage.
  const userId = user?.id ?? null

  const [klass, setKlass] = useState<ClassRow | null>(null)
  const [doc, setDoc] = useState<DocumentRow | null>(null)
  const [title, setTitle] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  /*
   * Detail of the last refused write, for the guest path.
   *
   * Held apart from `saveState` because it outlives it: the status pill goes
   * back to "Saving…" the moment the next keystroke schedules a save, but the
   * browser is still not storing anything, so the notice explaining that has to
   * stay up until a write actually succeeds.
   */
  const [saveFailure, setSaveFailure] = useState<StorageFailure | null>(null)
  /*
   * The newer version somebody else saved, held until the writer chooses
   * between it and their own. Non-null is what puts the conflict dialog up.
   */
  const [conflict, setConflict] = useState<DocumentRow | null>(null)
  /** Set by the share menu; null until it has said anything. */
  const [liveShareMode, setLiveShareMode] = useState<ShareMode | null>(null)
  /** True when this note belongs to somebody else and was shared with you. */
  const [isSharedWithMe, setIsSharedWithMe] = useState(false)
  /** Non-null while the delete confirmation is up. */
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  /**
   * Errors from actions the writer took deliberately -- creating, deleting.
   * Shown in the page rather than through window.alert, which blocks the main
   * thread and so stalls any autosave that was still in flight.
   */
  const [actionError, setActionError] = useState<string | null>(null)
  // Closed by default: the panel is still a placeholder, and an empty 360px
  // column would crowd the formatting toolbar into a horizontal scroll.
  // Ctrl/Cmd+Shift+A and the AI button both open it.
  const [sidebarOpen, setSidebarOpen] = useState(false)
  /*
   * Which panel the docked column and the drawer are showing.
   *
   * One piece of state for both, so switching to Comments on a phone and then
   * rotating to a tablet does not land on a different tab than the one just
   * chosen.
   */
  const [panelTab, setPanelTab] = useState('assistant')
  const [editor, setEditor] = useState<Editor | null>(null)
  /*
   * Link, image, find and word count. Both the menubar and the formatting
   * toolbar reach them, and this is the lowest point that renders both.
   */
  const dialogs = useDocumentDialogs(editor)
  const [loaded, setLoaded] = useState(false)
  const [editable, setEditable] = useState(true)
  const [selection, setSelection] = useState<
    (AiSelection & { coords: { top: number; left: number } }) | null
  >(null)
  // Mirrored into a ref for the shortcut handler, which is registered once and
  // would otherwise close over the selection as it stood on mount.
  const selectionRef = useRef<AiSelection | null>(null)
  const handleSelectionChange = useCallback(
    (next: (AiSelection & { coords: { top: number; left: number } }) | null) => {
      selectionRef.current = next
      setSelection(next)
    },
    [],
  )
  // The selection is nullable: a Ctrl+Alt shortcut can fire with nothing
  // highlighted, and the panel answers that by asking which part to work on.
  const [pendingMode, setPendingMode] = useState<{
    mode: AiMode
    selection: AiSelection | null
  } | null>(null)
  // View menu state. `compact` is Docs' "hide the menus": it folds away the
  // title and menu rows and leaves the toolbar, which is why it is owned here
  // rather than inside the toolbar that toggles it.
  const [showRuler, setShowRuler] = useState(true)
  const [compact, setCompact] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  // Mirrors the browser rather than assuming: Escape and F11 leave full
  // screen without going through the menu, and the tick has to follow.
  const [fullScreen, setFullScreen] = useState(false)
  // Mirrors the ruler's current paper so a printout matches what is on screen.
  const [geometry, setGeometry] = useState<PageGeometry>(US_LETTER)
  /*
   * Page numbering. A document setting rather than a view one -- it changes
   * what the printed page says -- so it is saved with the note. Mirrored into
   * a ref for the same reason the header and footer are: the autosave closure
   * has to send the current value, not the one captured when it was built.
   */
  const [pageNumbers, setPageNumbers] = useState<PageNumberPosition>('off')
  const navigate = useNavigate()

  useEffect(() => {
    const sync = () => setFullScreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])

  // The version the client last read. Every save is conditional on it, and it
  // advances on each successful write. Held in a ref so the scheduler always
  // reads the current value rather than a captured stale one.
  const versionRef = useRef<number>(1)
  // Refs, not state: the autosave scheduler closes over `persist`, and these
  // must reflect the current row rather than the render that created it.
  const documentIdRef = useRef<string | null>(null)
  // Refs so the autosave closure always sends the current furniture rather
  // than whatever it held when the scheduler was created.
  const headerRef = useRef<JSONContent | null>(null)
  const footerRef = useRef<JSONContent | null>(null)
  const pageNumbersRef = useRef<PageNumberPosition>('off')
  const classIdRef = useRef<string | null>(null)
  const classSlugRef = useRef<string | undefined>(classSlug)
  const slugRef = useRef<string | undefined>(undefined)

  // The latest editor content, so a title-only edit can still send the current
  // body. Declared before `persist` because the stale-save branch has to reset
  // it to the re-read remote content.
  const contentRef = useRef<JSONContent | null>(null)

  /*
   * Collaborative editing, on the owner's own copy of the note.
   *
   * Two conditions, and both are load-bearing:
   *
   * - Signed in. `userId` is null in guest mode, where there is no Supabase
   *   client, no Realtime and no server to store a CRDT on. Nothing about
   *   collaboration can work there and nothing about it is attempted.
   * - Shared for editing. A private note is edited by exactly one person, and
   *   converting every note in the project into a Yjs document to support a
   *   case that cannot arise would be a migration with a duplicated-content
   *   failure mode and no upside.
   *
   * Absent on a guest row, which is why the fallback is 'private' rather than
   * an assertion: signed out there is no server to share from.
   */
  /*
   * The note's share mode, as last reported by the share menu.
   *
   * Overrides the loaded row rather than replacing it: the row is read once at
   * load, and turning sharing on afterwards has to reach the collaboration
   * hook without a reload -- live editing is gated on exactly this value.
   */
  const shareMode = liveShareMode ?? doc?.share_mode ?? 'private'

  const collaboration = useCollaboration({
    documentId: doc?.id ?? null,
    userId,
    displayName: profile?.display_name || user?.email || 'You',
    sharedForEditing: shareMode === 'edit',
    content: (doc?.content as JSONContent | undefined) ?? EMPTY_DOC,
  })

  // Read inside `persist`, which is memoised on `userId` and would otherwise
  // close over whatever this was when the note first opened.
  const collaboratingRef = useRef(false)
  collaboratingRef.current = collaboration.active

  // Yjs updates are debounced before being written, exactly like autosave, so
  // the same "the tab is going away" signal has to reach both.
  useFlushOnUnload(collaboration.flush)

  const persist = useCallback(
    async ({ title: nextTitle, content }: DraftPayload) => {
      const documentId = documentIdRef.current
      if (!documentId) return
      setSaveState('saving')
      try {
        const result = await saveDocument(userId, {
          documentId,
          title: nextTitle,
          content,
          expectedVersion: versionRef.current,
          classId: classIdRef.current ?? undefined,
          header: headerRef.current ?? undefined,
          footer: footerRef.current ?? undefined,
          pageNumbers: pageNumbersRef.current,
        })

        if (result.status === 'stale') {
          /*
           * Someone else saved first -- another tab, or another person on a
           * shared link.
           *
           * This used to re-read the note and adopt the newer content, which
           * silently deleted whatever the person in front of us had written
           * since their last save, and then reported "Saved". Both versions
           * are kept now and the choice is theirs. Nothing here touches the
           * editor: their text stays exactly where it is until they answer.
           */
          const fresh = await fetchDocument(userId, documentId)
          if (fresh) {
            /*
             * While collaborating there is nothing to reconcile, and asking
             * would be wrong.
             *
             * Both writers are editing one Yjs document that has already
             * merged their text; `documents.content` is a derived view of it
             * that each of them rewrites on their own debounce. A version
             * clash here means somebody else wrote that derived view a moment
             * earlier -- not that two versions of the note exist. Putting the
             * conflict dialog up would offer a choice between two copies of
             * something identical, and "Use theirs" would then push content
             * back into a Yjs-backed editor, which duplicates it.
             *
             * Adopting their counter is enough: the next save is built on the
             * state everyone already agrees on.
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
          // The note is gone entirely, so there is nothing to reconcile with.
          setSaveState('error')
          return
        }

        /*
         * The browser refused to store the note -- quota, or storage disabled.
         * Nothing was written, so the version must NOT advance: pretending it
         * did would make the next save look like a fresh one built on a state
         * that does not exist. Reported as its own state rather than as
         * "Saved", which is what this used to say while the note existed
         * nowhere but this tab.
         */
        if (result.status === 'failed') {
          setSaveFailure({ reason: result.reason, message: result.message })
          setSaveState('failed')
          return
        }

        setSaveFailure(null)
        versionRef.current = result.version
        setSaveState('saved')

        /*
         * Nothing else happens here, and that is the fix.
         *
         * This used to re-read the row after every save and, if the slug had
         * moved, navigate to the new address. Since every save also re-slugged
         * from the title, typing in the title box meant: save, re-read,
         * navigate, re-run the load effect, re-read again, and push the
         * reloaded content back into the editor -- which reset the caret and
         * could overwrite characters typed in the meantime. Three round trips
         * per keystroke burst, and a rename that ate text.
         *
         * The address carries the note's id now, so it stays valid whatever
         * the title becomes, and the slug is no longer regenerated on this
         * path at all. There is nothing left to keep in step.
         */
      } catch (caught) {
        console.error('[EditorPage] save failed:', caught)
        setSaveState('error')
      }
    },
    // `navigate` is gone from here on purpose: saving no longer touches the
    // address bar, so a new router instance must not rebuild the scheduler.
    [userId],
  )

  const scheduler = useMemo(
    () => createAutosaveScheduler<DraftPayload>({ delayMs: AUTOSAVE_DELAY_MS, save: persist }),
    [persist],
  )

  /**
   * True once the session is known and the lookup has actually run.
   *
   * `collaboration.pending` joins them because opening the editor early is a
   * way to lose work rather than a cosmetic wobble: a single-writer editor
   * shown for the second it takes to load or seed the Yjs document accepts
   * keystrokes into a ProseMirror document that is about to be replaced by one
   * built from the content as it was read. Those characters would go nowhere.
   * It is false immediately for guest mode and for private notes, so nothing
   * that is not collaborative waits for anything.
   */
  const settled = !authLoading && loaded && !collaboration.pending
  const showLoading = useMinimumVisible(!settled, LOADING_HOLD_MS)

  useEffect(() => {
    // `classSlug` is absent on /notes/:noteRef, which is how a note shared
    // with you is addressed: the class belongs to whoever shared it.
    if (!noteRef) return
    /*
     * Wait for the session before looking anything up.
     *
     * `userId` is null while Supabase is restoring the session, and the
     * services read browser storage when it is null. Running the lookup then
     * asks the guest store for a note that belongs to an account, finds
     * nothing, and reports the note as missing -- which is why "This note
     * isn't here" flashed on every reload before the real fetch replaced it.
     */
    if (authLoading) return
    let cancelled = false

    void (async () => {
      try {
        const { documentId, slug } = parseNoteRef(noteRef)

        /*
         * Owned notes are found through their class, because a note slug is
         * only unique inside one. A shared note has no class of yours to look
         * in, so it is found by id and its class read afterwards -- for the
         * label only, and only if the owner's class is readable, which RLS
         * allows exactly for notes you already have access to.
         */
        const ownedClass = classSlug ? await fetchClassBySlug(userId, classSlug) : null

        /*
         * The id is authoritative. The slug in the address is decoration and
         * may be out of date, so it is only used to find the note when the
         * address predates ids entirely -- an old bookmark, or a link someone
         * shared before this shipped. Those still resolve, and are rewritten
         * to the canonical address below.
         */
        const docRow = documentId
          ? await fetchDocument(userId, documentId)
          : ownedClass
            ? await fetchDocumentBySlug(userId, ownedClass.id, slug)
            : null

        if (cancelled) return

        const classRow =
          ownedClass ?? (docRow && userId ? await fetchClass(userId, docRow.class_id) : null)
        if (cancelled) return

        // Somebody else's note, opened through a share link.
        const shared = Boolean(docRow && userId && docRow.user_id !== userId)
        setIsSharedWithMe(shared)

        setKlass(classRow)
        setDoc(docRow)
        // Belongs to the note that was open, not to this one. Left behind, an
        // edit-shared note would make the next private note look collaborative.
        setLiveShareMode(null)
        documentIdRef.current = docRow?.id ?? null
        headerRef.current = (docRow?.header as JSONContent) ?? null
        footerRef.current = (docRow?.footer as JSONContent) ?? null
        // Anything unrecognised (an older row, a hand-edited value) reads as
        // no numbering rather than throwing the editor off.
        const storedPosition = isPageNumberPosition(docRow?.page_numbers)
          ? docRow.page_numbers
          : 'off'
        pageNumbersRef.current = storedPosition
        setPageNumbers(storedPosition)
        classIdRef.current = classRow?.id ?? docRow?.class_id ?? null
        classSlugRef.current = classRow?.slug ?? classSlug
        slugRef.current = docRow?.slug
        setLoaded(true)
        setTitle(docRow?.title ?? '')
        versionRef.current = docRow?.version ?? 1

        /*
         * Put the canonical address in the bar once, on load.
         *
         * Covers a legacy slug-only link and a stale slug in front of a good
         * id. Deliberately NOT re-run on save: the note is found by id, so the
         * address never goes stale in a way that matters, and rewriting it
         * mid-edit is exactly the navigation that used to reload the document
         * out from under the writer.
         */
        const canonical = docRow
          ? shared || !classSlug
            ? sharedNoteHref(docRow.slug, docRow.id)
            : noteHref(classRow?.slug ?? classSlug, docRow.slug, docRow.id)
          : null
        const here = classSlug ? `/classes/${classSlug}/${noteRef}` : `/notes/${noteRef}`
        if (canonical && canonical !== here) navigate(canonical, { replace: true })
      } catch (caught) {
        console.error('[EditorPage] failed to load document:', caught)
        if (!cancelled) setLoaded(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [classSlug, noteRef, userId, authLoading, navigate])

  // Save anything pending when leaving the page.
  useEffect(() => () => void scheduler.flush(), [scheduler])
  // React's cleanup above covers moving between notes. A browser reload or a
  // closed tab runs none of it, so the debounce window was a loss window.
  useFlushOnUnload(scheduler.flush)

  useEffect(() => {
    if (!fullScreen) return

    // Browser-driven exits (F11, its own control) are already mirrored by the
    // fullscreenchange sync above. This covers the case that sync cannot see:
    // the request was refused, so the app is in full screen on its own and no
    // fullscreenchange will ever fire.
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setFullScreen(false)
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
      }
    }

    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [fullScreen])

  /**
   * Printing builds a separate document containing only the note.
   *
   * The browser's own Ctrl+P would print the app -- shell, panel, toolbars and
   * all -- so it is intercepted and replaced with this.
   */
  const handlePrint = useCallback(() => {
    if (!editor) return
    void printNote({
      title,
      content: editor.getJSON(),
      header: headerRef.current ?? undefined,
      footer: footerRef.current ?? undefined,
      geometry,
      // Whatever the writer chose; 'off' means no number is drawn at all.
      pageNumbers: pageNumbersRef.current,
    }).catch((caught) => console.error('[EditorPage] print failed:', caught))
  }, [editor, title, geometry])

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        handlePrint()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [handlePrint])

  /*
   * Ctrl/Cmd+K and Ctrl/Cmd+H.
   *
   * Ctrl+K was printed beside Insert in the menu and listed in the shortcut
   * reference, and was bound to nothing at all -- neither the app nor Tiptap's
   * Link extension registers it, so the only thing pressing it ever did was
   * open the browser's search bar. It is implemented here rather than deleted
   * from both places because it is the binding people expect.
   */
  // Destructured so the effect depends on the two stable openers rather than
  // the dialog object around them, which is rebuilt on every render and would
  // rebind the listener on every keystroke.
  const { openLink: openLinkDialog, toggleFind } = dialogs

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (!event.metaKey && !event.ctrlKey) return
      if (event.altKey || event.shiftKey) return

      const key = event.key.toLowerCase()
      if (key === 'k') {
        event.preventDefault()
        openLinkDialog()
      } else if (key === 'h') {
        event.preventDefault()
        toggleFind()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [openLinkDialog, toggleFind])

  /*
   * Ctrl/Cmd + Shift + A toggles the AI sidebar; Ctrl/Cmd + Alt + letter runs
   * an AI action on the current selection.
   *
   * Captured at the window rather than left to bubble, and propagation is
   * stopped once a binding matches. The editor sits inside this listener, so
   * on the way up it would answer first -- and Ctrl+Alt+C is also Tiptap's
   * code block, which is why running "Check my notes" used to turn the
   * paragraph monospace. preventDefault alone would not have helped: the
   * editor's keymap acts on the event whether or not the default is
   * cancelled. Not reaching it is what stops it.
   */
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        event.stopPropagation()
        setSidebarOpen((open) => !open)
        return
      }

      const mode = matchAiShortcut(event)
      if (!mode) return

      event.preventDefault()
      event.stopPropagation()
      setSidebarOpen(true)
      // Read through a ref: this listener is registered once, so closing over
      // `selection` would pin it to whatever was highlighted on mount.
      setPendingMode({ mode, selection: selectionRef.current })
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [])

  /** Re-saves with whatever the body currently holds; used by the zones. */
  function scheduleCurrent() {
    scheduler.schedule({
      title,
      content: contentRef.current ?? (doc?.content as JSONContent),
    })
  }

  function handleContentChange(content: JSONContent) {
    contentRef.current = content
    scheduler.schedule({ title, content })
  }

  function handleTitleChange(nextTitle: string) {
    setTitle(nextTitle)
    scheduler.schedule({
      title: nextTitle,
      content: contentRef.current ?? (doc?.content as JSONContent),
    })
  }

  async function handleNewNote() {
    if (!klass) return
    // Flush first: navigating away otherwise drops anything still debounced.
    await scheduler.flush()
    try {
      const created = await createDocument(userId, klass.id)
      navigate(noteHref(klass.slug, created.slug, created.id))
    } catch (caught) {
      console.error('[EditorPage] failed to create note:', caught)
      setActionError(describeDataError(caught))
    }
  }

  async function handleDeleteNote() {
    if (!doc || !klass) return

    setConfirmingDelete(false)
    // Cancelled, not flushed: the note is about to stop existing, and letting
    // a debounced save land first would write it once more on the way out.
    scheduler.cancel()
    try {
      await deleteDocument(userId, doc.id)
      navigate(`/classes/${klass.slug}`, { replace: true })
    } catch (caught) {
      console.error('[EditorPage] failed to delete note:', caught)
      setActionError(describeDataError(caught))
    }
  }

  function focusTitle() {
    const input = document.getElementById('doc-title') as HTMLInputElement | null
    input?.focus()
    input?.select()
  }

  /**
   * Offers a rewrite in the document, against the words it would replace.
   *
   * The offer lives entirely in decorations, so nothing here is saved: the
   * original text stays exactly as written until Accept, and Decline is a
   * no-op on the document rather than an undo. The suggestion also stays in
   * the transcript either way, so declining in the note never loses it.
   */
  function handlePreviewSuggestion(
    content: string,
    target: AiSelection,
    outcome: {
      onAccept: () => void
      onDecline: () => void
      onRefused: (message: string) => void
    },
  ) {
    if (!editor) return

    editor.commands.showAiPreview({
      from: target.from,
      to: target.to,
      html: isInlineSuggestion(content) ? escapeHtml(content) : markdownToHtml(content),
      onAccept: () => {
        // Read the mapped range back out: the note may have been edited while
        // the offer stood, and the stored positions moved with it.
        const live = aiPreviewKey.getState(editor.state)
        const range = live ? { from: live.from, to: live.to } : { from: target.from, to: target.to }
        /*
         * Anchor on the words the preview is currently sitting over rather than
         * the ones captured when it was offered. ProseMirror mapped this range
         * through every transaction since, so it is the strongest anchor
         * available -- and re-reading the text keeps the applier's validation
         * meaningful instead of comparing against wording the student has
         * since edited underneath the offer.
         */
        const anchored: SuggestionTarget = {
          text: editor.state.doc.textBetween(range.from, range.to, ' ').trim() || target.text,
          from: range.from,
          to: range.to,
        }
        editor.commands.clearAiPreview()
        void handleApplySuggestion(content, anchored).then((result) => {
          if (result.status === 'refused') outcome.onRefused(result.message)
          else outcome.onAccept()
        })
      },
      onDecline: () => {
        editor.commands.clearAiPreview()
        // The selection stays: a decline is followed by saying what to change,
        // and the re-run needs the same words still highlighted.
        outcome.onDecline()
      },
    })
  }

  /**
   * Writes an accepted AI suggestion into the document.
   *
   * Everything the assistant proposes lands here, and it only ever replaces the
   * words the suggestion was made about. The target travels with the suggestion
   * from the moment it was generated -- the live selection is deliberately not
   * consulted, because the student is free to click elsewhere while the model
   * is thinking and an offer has to keep meaning the text it was made about.
   *
   * When that text can no longer be located, or is found in more than one
   * place, the edit is refused and the reason is handed back for the panel to
   * show. There is no broader fallback: this used to replace the entire note
   * whenever no range was to hand, which turned a one-sentence correction into
   * the loss of the whole document.
   */
  async function handleApplySuggestion(
    content: string,
    target: SuggestionTarget,
  ): Promise<ApplyResult> {
    if (!editor || !doc) {
      const reason = 'no-editor' as const
      return { status: 'refused', reason, message: describeRefusal({ status: 'refused', reason }) }
    }

    const result = await applySuggestion(editor, content, target, {
      // Snapshotting is part of applying, not part of deciding: it runs only
      // once the target has resolved, so a refused suggestion never leaves a
      // spurious "before AI" version in the note's history.
      beforeApply: async () => {
        if (!userId) return
        // Best-effort history; failing to snapshot must not block the edit.
        try {
          await snapshotDocument(userId, doc.id, editor.getJSON(), 'ai')
        } catch (caught) {
          console.error('[EditorPage] failed to snapshot before AI edit:', caught)
        }
      },
    })

    if (result.status === 'refused') return result

    selectionRef.current = null
    setSelection(null)
    // insertContentAt fires onUpdate, so autosave is already scheduled; flushing
    // makes the accepted change durable immediately rather than a second later.
    await scheduler.flush()
    return result
  }

  /*
   * Nothing is known about the note until the session is restored and the
   * lookup has run. Checked before the missing-note branch below, so a note
   * that has not been looked for yet is never reported as absent.
   *
   * `loaded` is deliberately never reset when the slug changes: moving between
   * notes swaps the editor's content in place rather than remounting it, and
   * dropping back to this screen would throw that away.
   */
  /*
   * Comments.
   *
   * Above the early returns, and that placement is load-bearing rather than
   * stylistic: React counts hooks per render, so a hook called after
   * `if (!doc) return ...` runs on some renders and not others. It was below
   * them briefly and the editor did not render at all -- React error #310,
   * "rendered more hooks than during the previous render", which surfaces as a
   * blank page rather than as anything naming the cause.
   *
   * The document id is therefore optional here: on the first render there is
   * no note yet, and the hook has to be callable anyway. It no-ops until one
   * arrives.
   *
   * Instantiated here rather than inside the panel because the panel is
   * mounted twice -- docked on desktop, in the drawer on narrow screens -- and
   * two controllers would mean two subscriptions and two sets of highlights
   * fighting over one editor.
   */
  const comments = useComments({
    documentId: doc?.id ?? '',
    userId,
    editor,
    ydoc: collaboration.active ? collaboration.ydoc : null,
  })

  if (showLoading || !settled) return <LoadingScreen label="Loading note" />

  /*
   * A note can be missing for ordinary reasons -- deleted in another tab, a
   * stale bookmark, or a link opened in a browser whose local notes live under
   * a different origin. Rendering nothing left a blank white page with no way
   * back, which reads as the app being broken.
   */
  if (!doc) {
    return (
      <div className="grid min-h-full place-items-center px-6">
        <div className="text-center">
          <h1 className="text-lg font-medium text-ink">This note isn&rsquo;t here</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm text-ink-muted">
            It may have been deleted, or it belongs to an account you&rsquo;re not
            signed in to.
          </p>
          <Link
            to={classSlug ? `/classes/${classSlug}` : '/classes'}
            className="mt-6 inline-block rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
          >
            Back to my notes
          </Link>
        </div>
      </div>
    )
  }

  /*
   * A refused write outranks being offline. Offline is a reason a save has not
   * happened *yet*; failed means the browser will not store the note however
   * long they wait, and that is the more urgent thing to say.
   */
  const displayState: SaveState =
    saveState === 'failed' ? 'failed' : online ? saveState : 'offline'

  /*
   * What the editor is handed, and what it is keyed on.
   *
   * Plain constants rather than memoised values: this sits below the early
   * returns above, where a hook cannot go. `editorCollaboration` changes
   * identity when the channel drops, which is deliberate -- the presence bar
   * has to re-render to say so -- while `collaborationKey` stays put, so the
   * editor itself is never rebuilt over a reconnect.
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

  const collaborationKey = editorCollaboration ? `collab:${doc.id}` : 'solo'

  const commentsPanel = (
    <CommentsSidebar
      threads={comments.threads}
      draft={comments.draft}
      onSubmitDraft={(body) => void comments.submitDraft(body)}
      onCancelDraft={comments.cancelDraft}
      activeThreadId={comments.activeThreadId}
      currentUserId={userId}
      busy={comments.loading}
      error={comments.error}
      onSelect={comments.setActiveThreadId}
      onReply={(threadId, body) => void comments.reply(threadId, body)}
      onResolve={(threadId, resolved) => void comments.resolve(threadId, resolved)}
      onDeleteThread={(threadId) => void comments.removeThread(threadId)}
      onDeleteComment={(commentId) => void comments.removeComment(commentId)}
    />
  )

  const openCommentCount = comments.threads.filter(
    (view) => view.thread.resolvedAt === null,
  ).length

  /**
   * Keeps what is on screen and saves it over the newer stored version.
   *
   * Adopting the other side's version number is what makes the next save
   * succeed: the write is conditional on it, and ours is now built on the
   * state we have just been shown.
   */
  const keepMine = () => {
    if (!conflict) return
    versionRef.current = conflict.version
    setConflict(null)
    scheduleCurrent()
    void scheduler.flush()
  }

  /** Discards the local edits and loads the version somebody else saved. */
  const useTheirs = () => {
    if (!conflict) return
    versionRef.current = conflict.version
    contentRef.current = conflict.content as JSONContent
    headerRef.current = (conflict.header as JSONContent) ?? null
    footerRef.current = (conflict.footer as JSONContent) ?? null
    setTitle(conflict.title)
    // Bumping `doc` re-runs DocumentEditor's content sync, which is what
    // actually swaps the text in the editor.
    setDoc(conflict)
    setConflict(null)
    setSaveState('saved')
  }

  /**
   * Re-runs the refused save with whatever the note holds now.
   *
   * Nothing is pending at this point -- the scheduler already ran and was
   * turned down -- so this queues the current content and flushes it straight
   * away rather than waiting out the debounce the student just asked to skip.
   */
  const retrySave = () => {
    scheduleCurrent()
    void scheduler.flush()
  }

  return (
    <div className="doc-shell flex h-full flex-col">
      {!compact && (
        <header className="shrink-0 bg-surface">
          {editable && !fullScreen && <DocsTitleBar
            documentId={doc.id}
            title={title}
            onTitleChange={handleTitleChange}
            saveState={displayState}
            saveMessage={saveFailure?.message}
            onShareModeChange={setLiveShareMode}
            onRetrySave={saveFailure ? retrySave : undefined}
            // A note shared with you is not filed in a class of yours, so
            // "back" is your notes, not somebody else's course.
            backTo={isSharedWithMe ? '/classes' : `/classes/${klass?.slug ?? ''}`}
            backLabel={
              isSharedWithMe
                ? klass
                  ? `Shared with you · ${klass.name}`
                  : 'Shared with you'
                : klass
                  ? `Back to ${klass.name}`
                  : 'Back to class'
            }
            aiOpen={sidebarOpen}
            onToggleAi={() => setSidebarOpen((open) => !open)}
            menubar={
              <DocumentMenubar
                editor={editor}
                onNewNote={() => void handleNewNote()}
                onRename={focusTitle}
                // Deleting stays with the owner: the database refuses it for
                // anyone else, so offering it would be a button that fails.
                onDelete={isSharedWithMe ? undefined : () => setConfirmingDelete(true)}
                showRuler={showRuler}
                onToggleRuler={() => setShowRuler((on) => !on)}
                compact={compact}
                onToggleCompact={() => setCompact((on) => !on)}
                fullScreen={fullScreen}
                // State only: the menubar's own handler makes the browser
                // request, so doing it here as well would toggle twice and
                // cancel itself out.
                onToggleFullScreen={() => setFullScreen((on) => !on)}
                onShowShortcuts={() => setShortcutsOpen(true)}
                onEditLink={dialogs.openLink}
                onInsertImage={dialogs.openImage}
                onFind={dialogs.toggleFind}
                onShowWordCount={dialogs.openWordCount}
                onEquation={dialogs.openEquation}
                onPrint={handlePrint}
                // Same document; the browser's dialog offers Save as PDF as a
                // destination, which is what writes the file.
                onExportPdf={handlePrint}
                pageNumbers={pageNumbers}
                onPageNumbersChange={(next) => {
                  pageNumbersRef.current = next
                  setPageNumbers(next)
                  scheduleCurrent()
                }}
              />
            }
          />}
        </header>
      )}

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <DocumentEditor
          /*
           * Keyed on the collaboration session rather than on the note.
           *
           * The editor's extension set decides who owns the document, and that
           * cannot be swapped underneath a live ProseMirror view -- so turning
           * collaboration on, or moving to a different collaborative note, has
           * to build a new editor. The key is a constant for every
           * non-collaborative note, which is what keeps the ordinary path
           * exactly as it was: navigating between private notes still swaps the
           * content in place rather than remounting, and guest mode never sees
           * this value change at all.
           */
          key={collaborationKey}
          collaboration={editorCollaboration}
          documentId={doc.id}
          version={doc.version}
          initialContent={doc.content as JSONContent}
          onChange={handleContentChange}
          onReady={setEditor}
          onEditLink={dialogs.openLink}
          onInsertImage={dialogs.openImage}
          onFind={dialogs.toggleFind}
          onEquation={dialogs.openEquation}
          onSelectionChange={handleSelectionChange}
          showRuler={showRuler}
          compact={compact}
          onToggleCompact={() => setCompact((on) => !on)}
          editable={editable}
          onEditableChange={setEditable}
          fullScreen={fullScreen}
          onGeometryChange={setGeometry}
          onPrint={handlePrint}
          // Only offered where a comment can actually be stored and addressed
          // to somebody: signed in, against a real note.
          onAddComment={
            userId
              ? () => {
                  // Anchor first: opening the panel moves focus and collapses
                  // the selection this comment is about.
                  comments.startDraft()
                  setPanelTab('comments')
                  setSidebarOpen(true)
                }
              : undefined
          }
          canAddComment={comments.canComment}
          header={doc.header as JSONContent}
          footer={doc.footer as JSONContent}
          pageNumbers={pageNumbers}
          onHeaderChange={(next) => {
            headerRef.current = next
            scheduleCurrent()
          }}
          onFooterChange={(next) => {
            footerRef.current = next
            scheduleCurrent()
          }}
          // Permanently docked on desktop; the drawer below covers narrow
          // screens, where a 360px column would leave no room to write.
          sidebar={
            <SidePanel
              tabs={[
                {
                  id: 'assistant',
                  label: 'Assistant',
                  content: (
                    <AiSidebar
                      documentId={doc.id}
                      classId={doc.class_id}
                      selection={selection}
                      pendingMode={pendingMode}
                      onPendingHandled={() => setPendingMode(null)}
                      onApply={handleApplySuggestion}
                      onPreview={handlePreviewSuggestion}
                      active={panelDocked && panelTab === 'assistant'}
                    />
                  ),
                },
                {
                  id: 'comments',
                  label: 'Comments',
                  count: openCommentCount,
                  content: commentsPanel,
                },
              ]}
              activeId={panelTab}
              onSelect={setPanelTab}
            />
          }
        />
      </main>

      <AiDrawer
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        alwaysOverlay={fullScreen}
      >
        <SidePanel
          tabs={[
            {
              id: 'assistant',
              label: 'Assistant',
              content: (
                <AiSidebar
                  documentId={doc.id}
                  classId={doc.class_id}
                  selection={selection}
                  pendingMode={pendingMode}
                  onPendingHandled={() => setPendingMode(null)}
                  onApply={handleApplySuggestion}
                  onPreview={handlePreviewSuggestion}
                  // Only the visible copy may act on a pending action, or one
                  // request becomes two.
                  active={!panelDocked && panelTab === 'assistant'}
                />
              ),
            },
            {
              id: 'comments',
              label: 'Comments',
              count: openCommentCount,
              content: commentsPanel,
            },
          ]}
          activeId={panelTab}
          onSelect={setPanelTab}
        />
      </AiDrawer>

      {/*
        Storage has refused a write, so the note lives only in this tab. The
        pill in the title bar says so in two words; this is the part that tells
        them what to do about it -- download a copy, or make an account. Pinned
        rather than inline: they may be scrolled anywhere in a long note, and
        this is not a message to discover later.
      */}
      {saveFailure && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-4">
          <div className="pointer-events-auto w-full max-w-lg [&>*]:mt-0">
            <StorageNotice hasContent failure={saveFailure} />
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmingDelete}
        title="Delete this note?"
        message={`“${title || 'Untitled note'}” and everything in it will be removed. This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => void handleDeleteNote()}
        onCancel={() => setConfirmingDelete(false)}
      />

      {actionError && (
        <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
          <p
            role="alert"
            className="max-w-md rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700 shadow-sheet"
          >
            {actionError}
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="ml-3 font-medium underline"
            >
              Dismiss
            </button>
          </p>
        </div>
      )}

      <ConflictDialog
        open={conflict !== null}
        onKeepMine={keepMine}
        onUseTheirs={useTheirs}
      />

      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      <LinkDialog
        open={dialogs.open === 'link'}
        initialHref={dialogs.linkHref}
        onSubmit={dialogs.submitLink}
        onRemove={dialogs.removeLink}
        onClose={dialogs.close}
      />

      <ImageDialog
        open={dialogs.open === 'image'}
        onSubmit={dialogs.insertImage}
        onClose={dialogs.close}
      />

      <WordCountDialog
        open={dialogs.open === 'wordCount'}
        document={dialogs.documentCounts}
        selection={dialogs.selectionCounts}
        onClose={dialogs.close}
      />

      <EquationDialog
        open={dialogs.open === 'equation'}
        initialLatex={dialogs.equationTarget?.latex ?? ''}
        initialDisplay={dialogs.equationTarget?.display ?? false}
        editing={dialogs.equationTarget !== null}
        onSubmit={dialogs.submitEquation}
        onClose={dialogs.close}
      />

      <FindReplacePanel
        editor={editor}
        open={dialogs.open === 'find'}
        onClose={dialogs.close}
      />

      {fullScreen && (
        <AiBubble open={sidebarOpen} onClick={() => setSidebarOpen((open) => !open)} />
      )}

      <SelectionToolbar
        position={selection?.coords ?? null}
        onAction={(mode) => {
          if (!selection) return
          setSidebarOpen(true)
          setPendingMode({ mode, selection })
        }}
      />
    </div>
  )
}
