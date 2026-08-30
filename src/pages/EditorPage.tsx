import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { JSONContent } from '@tiptap/react'
import { DocumentEditor } from '../editor/DocumentEditor'
import { DocumentMenubar } from '../editor/DocumentMenubar'
import { DocsTitleBar } from '../editor/DocsTitleBar'
import { SelectionToolbar } from '../editor/SelectionToolbar'
import { AiSidebar, type AiSelection } from '../ai/AiSidebar'
import { markdownToHtml, isInlineSuggestion } from '../lib/markdown'
import { describeDataError } from '../lib/dataErrors'
import { matchAiShortcut } from '../lib/shortcuts'
import { ShortcutsDialog } from '../components/ShortcutsDialog'
import { snapshotDocument } from '../services/documents'
import type { AiMode } from '../types/ai'
import type { Editor } from '@tiptap/react'
import { Pencil } from 'lucide-react'
import { type SaveState } from '../components/SaveStatus'
import { AiDrawer } from '../components/AiDrawer'
import { useAuth } from '../contexts/AuthContext'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { useMediaQuery } from '../hooks/useMediaQuery'
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

interface DraftPayload {
  title: string
  content: JSONContent
}

export default function EditorPage() {
  const { classSlug, noteSlug } = useParams<{ classSlug: string; noteSlug: string }>()
  const { user } = useAuth()
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
  const navigate = useNavigate()

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

  useEffect(() => {
    if (!classSlug || !noteSlug) return
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
  }, [classSlug, noteSlug, userId])

  // Save anything pending when leaving the page.
  useEffect(() => () => void scheduler.flush(), [scheduler])

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
   * A note can be missing for ordinary reasons -- deleted in another tab, a
   * stale bookmark, or a link opened in a browser whose local notes live under
   * a different origin. Rendering nothing left a blank white page with no way
   * back, which reads as the app being broken.
   */
  if (loaded && !doc) {
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

  if (!doc) return null

  const displayState: SaveState = online ? saveState : 'offline'

  return (
    <div className="doc-shell flex h-full flex-col">
      {!compact && (
        <header className="shrink-0 bg-surface">
          {editable && <DocsTitleBar
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
                onShowShortcuts={() => setShortcutsOpen(true)}
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
          header={doc.header as JSONContent}
          footer={doc.footer as JSONContent}
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
              active={panelDocked}
            />
          }
        />
      </main>

      <AiDrawer open={sidebarOpen} onClose={() => setSidebarOpen(false)}>
        <AiSidebar
          documentId={doc.id}
          classId={doc.class_id}
          selection={selection}
          pendingMode={pendingMode}
          onPendingHandled={() => setPendingMode(null)}
          onApply={(content, target) => void handleApplySuggestion(content, target)}
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
