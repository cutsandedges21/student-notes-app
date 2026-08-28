import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { JSONContent } from '@tiptap/react'
import { DocumentEditor } from '../editor/DocumentEditor'
import { DocumentMenubar } from '../editor/DocumentMenubar'
import { DocsTitleBar } from '../editor/DocsTitleBar'
import { SelectionToolbar } from '../editor/SelectionToolbar'
import { AiSidebar, type AiSelection } from '../ai/AiSidebar'
import { markdownToHtml, isInlineSuggestion } from '../lib/markdown'
import { snapshotDocument } from '../services/documents'
import type { AiMode } from '../types/ai'
import type { Editor } from '@tiptap/react'
import { Pencil } from 'lucide-react'
import { type SaveState } from '../components/SaveStatus'
import { AiDrawer } from '../components/AiDrawer'
import { useAuth } from '../contexts/AuthContext'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { createAutosaveScheduler } from '../lib/autosave'
import { fetchClass } from '../services/classes'
import { createDocument, deleteDocument, fetchDocument, saveDocument } from '../services/documents'
import type { ClassRow, DocumentRow } from '../types/database'

const AUTOSAVE_DELAY_MS = 1000

interface DraftPayload {
  title: string
  content: JSONContent
}

export default function EditorPage() {
  const { classId, documentId } = useParams<{ classId: string; documentId: string }>()
  const { user } = useAuth()
  const online = useOnlineStatus()

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
  const [pendingMode, setPendingMode] = useState<{
    mode: AiMode
    selection: AiSelection
  } | null>(null)
  // View menu state. `compact` is Docs' "hide the menus": it folds away the
  // title and menu rows and leaves the toolbar, which is why it is owned here
  // rather than inside the toolbar that toggles it.
  const [showRuler, setShowRuler] = useState(true)
  const [compact, setCompact] = useState(false)
  const navigate = useNavigate()

  // The version the client last read. Every save is conditional on it, and it
  // advances on each successful write. Held in a ref so the scheduler always
  // reads the current value rather than a captured stale one.
  const versionRef = useRef<number>(1)

  // The latest editor content, so a title-only edit can still send the current
  // body. Declared before `persist` because the stale-save branch has to reset
  // it to the re-read remote content.
  const contentRef = useRef<JSONContent | null>(null)

  const persist = useCallback(
    async ({ title: nextTitle, content }: DraftPayload) => {
      if (!documentId) return
      setSaveState('saving')
      try {
        const result = await saveDocument(userId, {
          documentId,
          title: nextTitle,
          content,
          expectedVersion: versionRef.current,
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
      } catch (caught) {
        console.error('[EditorPage] save failed:', caught)
        setSaveState('error')
      }
    },
    [documentId, userId],
  )

  const scheduler = useMemo(
    () => createAutosaveScheduler<DraftPayload>({ delayMs: AUTOSAVE_DELAY_MS, save: persist }),
    [persist],
  )

  useEffect(() => {
    if (!documentId || !classId) return
    let cancelled = false

    void (async () => {
      try {
        const [classRow, docRow] = await Promise.all([
          fetchClass(userId, classId),
          fetchDocument(userId, documentId),
        ])
        if (cancelled) return
        setKlass(classRow)
        setDoc(docRow)
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
  }, [classId, documentId, userId])

  // Save anything pending when leaving the page.
  useEffect(() => () => void scheduler.flush(), [scheduler])

  // Ctrl/Cmd + Shift + A toggles the AI sidebar.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        setSidebarOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

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
    if (!classId) return
    // Flush first: navigating away otherwise drops anything still debounced.
    await scheduler.flush()
    const created = await createDocument(userId, classId)
    navigate(`/classes/${classId}/documents/${created.id}`)
  }

  async function handleDeleteNote() {
    if (!documentId || !classId) return
    if (!window.confirm(`Delete "${title || 'Untitled note'}"? This cannot be undone.`)) return

    scheduler.cancel()
    await deleteDocument(userId, documentId)
    navigate(`/classes/${classId}`, { replace: true })
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
            to={classId ? `/classes/${classId}` : '/classes'}
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
    <div className="flex h-full flex-col">
      {!compact && (
        <header className="shrink-0 bg-surface">
          {editable && <DocsTitleBar
            documentId={doc.id}
            title={title}
            onTitleChange={handleTitleChange}
            saveState={displayState}
            editor={editor}
            backTo={`/classes/${classId}`}
            backLabel={klass ? `Back to ${klass.name}` : 'Back to class'}
            aiOpen={sidebarOpen}
            onToggleAi={() => setSidebarOpen((open) => !open)}
            menubar={
              <DocumentMenubar
                editor={editor}
                onNewNote={() => void handleNewNote()}
                onRename={focusTitle}
                onDelete={() => void handleDeleteNote()}
                onOpenAi={() => setSidebarOpen(true)}
                showRuler={showRuler}
                onToggleRuler={() => setShowRuler((on) => !on)}
                compact={compact}
                onToggleCompact={() => setCompact((on) => !on)}
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
          onSelectionChange={setSelection}
          showRuler={showRuler}
          compact={compact}
          onToggleCompact={() => setCompact((on) => !on)}
          editable={editable}
          onEditableChange={setEditable}
          // Permanently docked on desktop; the drawer below covers narrow
          // screens, where a 360px column would leave no room to write.
          sidebar={
            <AiSidebar
              documentId={doc.id}
              classId={classId!}
              selection={selection}
              pendingMode={pendingMode}
              onPendingHandled={() => setPendingMode(null)}
              onApply={(content, target) => void handleApplySuggestion(content, target)}
            />
          }
        />
      </main>

      <AiDrawer open={sidebarOpen} onClose={() => setSidebarOpen(false)}>
        <AiSidebar
          documentId={doc.id}
          classId={classId!}
          selection={selection}
          pendingMode={pendingMode}
          onPendingHandled={() => setPendingMode(null)}
          onApply={(content, target) => void handleApplySuggestion(content, target)}
        />
      </AiDrawer>

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
