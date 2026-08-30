import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { JSONContent } from '@tiptap/react'
import { DocumentEditor } from '../editor/DocumentEditor'
import {
  isPageNumberPosition,
  type PageNumberPosition,
} from '../editor/pagination/types'
import { DocumentMenubar } from '../editor/DocumentMenubar'
import { DocsTitleBar } from '../editor/DocsTitleBar'
import { SelectionToolbar } from '../editor/SelectionToolbar'
import { AiBubble } from '../editor/AiBubble'
import { printNote } from '../editor/printDocument'
import { US_LETTER, type PageGeometry } from '../editor/pagination/geometry'
import { AiSidebar, type AiSelection } from '../ai/AiSidebar'
import { markdownToHtml, isInlineSuggestion, escapeHtml } from '../lib/markdown'
import { aiPreviewKey } from '../editor/aiPreview'
import { describeDataError } from '../lib/dataErrors'
import { matchAiShortcut } from '../lib/shortcuts'
import { ShortcutsDialog } from '../components/ShortcutsDialog'
import { LoadingScreen } from '../components/LoadingScreen'
import { snapshotDocument } from '../services/documents'
import type { AiMode } from '../types/ai'
import type { Editor } from '@tiptap/react'
import { Pencil } from 'lucide-react'
import { type SaveState } from '../components/SaveStatus'
import { AiDrawer } from '../components/AiDrawer'
import { useAuth } from '../contexts/AuthContext'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useMinimumVisible } from '../hooks/useMinimumVisible'
import { createAutosaveScheduler } from '../lib/autosave'
import { fetchClassBySlug } from '../services/classes'
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

export default function EditorPage() {
  const { classSlug, noteSlug } = useParams<{ classSlug: string; noteSlug: string }>()
  const { user, loading: authLoading } = useAuth()
  const online = useOnlineStatus()
  // Matches the `lg:` breakpoint the panel's own visibility classes use.
  const panelDocked = useMediaQuery('(min-width: 1024px)')

  // null while signed out -- services then read and write browser storage.
  const userId = user?.id ?? null

  const [klass, setKlass] = useState<ClassRow | null>(null)
  const [doc, setDoc] = useState<DocumentRow | null>(null)
  const [title, setTitle] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  // Closed by default: the panel is still a placeholder, and an empty 360px
  // column would crowd the formatting toolbar into a horizontal scroll.
  // Ctrl/Cmd+Shift+A and the AI button both open it.
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [editor, setEditor] = useState<Editor | null>(null)
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
  const slugRef = useRef<string | undefined>(noteSlug)

  // The latest editor content, so a title-only edit can still send the current
  // body. Declared before `persist` because the stale-save branch has to reset
  // it to the re-read remote content.
  const contentRef = useRef<JSONContent | null>(null)

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
          // Another tab saved first. Re-read and adopt its content rather than
          // clobbering it. Resetting contentRef matters as much as setDoc: it
          // is what a later title-only edit sends as the body, so leaving the
          // local content here would re-save the very content we just backed
          // out of, defeating the staleness check.
          const fresh = await fetchDocument(userId, documentId)
          if (fresh) {
            versionRef.current = fresh.version
            contentRef.current = fresh.content as JSONContent
            setDoc(fresh)
            setTitle(fresh.title)
          }
          setSaveState('saved')
          return
        }

        versionRef.current = result.version
        setSaveState('saved')

        // Retitling re-slugs the row, so the address bar has to follow or a
        // reload would land on a slug that no longer exists. Replace rather
        // than push: this is the same note, not a new entry in history.
        const saved = await fetchDocument(userId, documentId)
        if (saved && saved.slug !== slugRef.current) {
          slugRef.current = saved.slug
          navigate(`/classes/${classSlugRef.current}/${saved.slug}`, { replace: true })
        }
      } catch (caught) {
        console.error('[EditorPage] save failed:', caught)
        setSaveState('error')
      }
    },
    [userId, navigate],
  )

  const scheduler = useMemo(
    () => createAutosaveScheduler<DraftPayload>({ delayMs: AUTOSAVE_DELAY_MS, save: persist }),
    [persist],
  )

  /** True once the session is known and the lookup has actually run. */
  const settled = !authLoading && loaded
  const showLoading = useMinimumVisible(!settled, LOADING_HOLD_MS)

  useEffect(() => {
    if (!classSlug || !noteSlug) return
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
        // Class first: the note's slug is only unique inside it.
        const classRow = await fetchClassBySlug(userId, classSlug)
        const docRow = classRow
          ? await fetchDocumentBySlug(userId, classRow.id, noteSlug)
          : null
        if (cancelled) return
        setKlass(classRow)
        setDoc(docRow)
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
        classIdRef.current = classRow?.id ?? null
        classSlugRef.current = classRow?.slug ?? classSlug
        slugRef.current = docRow?.slug
        setLoaded(true)
        setTitle(docRow?.title ?? '')
        versionRef.current = docRow?.version ?? 1
      } catch (caught) {
        console.error('[EditorPage] failed to load document:', caught)
        if (!cancelled) setLoaded(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [classSlug, noteSlug, userId, authLoading])

  // Save anything pending when leaving the page.
  useEffect(() => () => void scheduler.flush(), [scheduler])

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

  // Ctrl/Cmd + Shift + A toggles the AI sidebar; Ctrl/Cmd + Alt + letter runs
  // an AI action on the current selection.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        setSidebarOpen((open) => !open)
        return
      }

      const mode = matchAiShortcut(event)
      if (!mode) return

      event.preventDefault()
      setSidebarOpen(true)
      // Read through a ref: this listener is registered once, so closing over
      // `selection` would pin it to whatever was highlighted on mount.
      setPendingMode({ mode, selection: selectionRef.current })
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
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
      navigate(`/classes/${klass.slug}/${created.slug}`)
    } catch (caught) {
      console.error('[EditorPage] failed to create note:', caught)
      window.alert(describeDataError(caught))
    }
  }

  async function handleDeleteNote() {
    if (!doc || !klass) return
    if (!window.confirm(`Delete "${title || 'Untitled note'}"? This cannot be undone.`)) return

    scheduler.cancel()
    try {
      await deleteDocument(userId, doc.id)
      navigate(`/classes/${klass.slug}`, { replace: true })
    } catch (caught) {
      console.error('[EditorPage] failed to delete note:', caught)
      window.alert(describeDataError(caught))
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
    outcome: { onAccept: () => void; onDecline: () => void },
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
        const range = live ? { ...target, from: live.from, to: live.to } : target
        editor.commands.clearAiPreview()
        void handleApplySuggestion(content, range)
        outcome.onAccept()
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
   * Snapshots the prior content first so an AI edit is always reversible, then
   * chooses the narrowest edit that fits: a single-line suggestion replaces
   * exactly the selected range and leaves surrounding formatting untouched,
   * while anything with block structure is converted to nodes. Replacing the
   * whole document is the last resort, used only when there was no selection.
   */
  async function handleApplySuggestion(content: string, target: AiSelection | null) {
    if (!editor || !doc) return

    if (userId) {
      // Best-effort history; failing to snapshot must not block the edit.
      try {
        await snapshotDocument(userId, doc.id, editor.getJSON(), 'ai')
      } catch (caught) {
        console.error('[EditorPage] failed to snapshot before AI edit:', caught)
      }
    }

    const range = target ?? selection

    if (range) {
      if (isInlineSuggestion(content)) {
        editor.chain().focus().insertContentAt({ from: range.from, to: range.to }, content).run()
      } else {
        editor
          .chain()
          .focus()
          .insertContentAt({ from: range.from, to: range.to }, markdownToHtml(content))
          .run()
      }
    } else {
      editor.chain().focus().setContent(markdownToHtml(content)).run()
    }

    setSelection(null)
    // insertContentAt fires onUpdate, so autosave is already scheduled; flushing
    // makes the accepted change durable immediately rather than a second later.
    await scheduler.flush()
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

  const displayState: SaveState = online ? saveState : 'offline'

  return (
    <div className="doc-shell flex h-full flex-col">
      {!compact && (
        <header className="shrink-0 bg-surface">
          {editable && !fullScreen && <DocsTitleBar
            documentId={doc.id}
            title={title}
            onTitleChange={handleTitleChange}
            saveState={displayState}
            backTo={`/classes/${klass?.slug ?? ''}`}
            backLabel={klass ? `Back to ${klass.name}` : 'Back to class'}
            aiOpen={sidebarOpen}
            onToggleAi={() => setSidebarOpen((open) => !open)}
            menubar={
              <DocumentMenubar
                editor={editor}
                onNewNote={() => void handleNewNote()}
                onRename={focusTitle}
                onDelete={() => void handleDeleteNote()}
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
          documentId={doc.id}
          version={doc.version}
          initialContent={doc.content as JSONContent}
          onChange={handleContentChange}
          onReady={setEditor}
          onSelectionChange={handleSelectionChange}
          showRuler={showRuler}
          compact={compact}
          onToggleCompact={() => setCompact((on) => !on)}
          editable={editable}
          onEditableChange={setEditable}
          fullScreen={fullScreen}
          onGeometryChange={setGeometry}
          onPrint={handlePrint}
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
            <AiSidebar
              documentId={doc.id}
              classId={doc.class_id}
              selection={selection}
              pendingMode={pendingMode}
              onPendingHandled={() => setPendingMode(null)}
              onApply={(content, target) => void handleApplySuggestion(content, target)}
              onPreview={handlePreviewSuggestion}
              active={panelDocked}
            />
          }
        />
      </main>

      <AiDrawer
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        alwaysOverlay={fullScreen}
      >
        <AiSidebar
          documentId={doc.id}
          classId={doc.class_id}
          selection={selection}
          pendingMode={pendingMode}
          onPendingHandled={() => setPendingMode(null)}
          onApply={(content, target) => void handleApplySuggestion(content, target)}
          onPreview={handlePreviewSuggestion}
          active={!panelDocked}
        />
      </AiDrawer>

      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      {!editable && (
        <button
          type="button"
          onClick={() => setEditable(true)}
          className="fixed right-5 top-5 z-40 flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 font-ui text-sm text-ink shadow-pill transition-colors hover:bg-surface-hover"
        >
          <Pencil size={15} className="text-docs-icon" />
          Back to editing
        </button>
      )}

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
