import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { JSONContent } from '@tiptap/react'
import { DocumentEditor } from '../editor/DocumentEditor'
import { DocumentMenubar } from '../editor/DocumentMenubar'
import type { Editor } from '@tiptap/react'
import { SaveStatus, type SaveState } from '../components/SaveStatus'
import { Button } from '../components/ui/Button'
import { AiDrawer } from '../components/AiDrawer'
import { useAuth } from '../contexts/AuthContext'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { createAutosaveScheduler } from '../lib/autosave'
import { fetchClass } from '../services/classes'
import { createDocument, deleteDocument, fetchDocument, saveDocument } from '../services/documents'
import { AI_SIDEBAR_SIDE, AI_SIDEBAR_WIDTH_PX } from '../constants/layout'
import { cn } from '../lib/cn'
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
        setTitle(docRow?.title ?? '')
        versionRef.current = docRow?.version ?? 1
      } catch (caught) {
        console.error('[EditorPage] failed to load document:', caught)
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

  if (!doc) return null

  const displayState: SaveState = online ? saveState : 'offline'

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-line bg-surface px-4 pt-2">
        <div className="flex items-center gap-3">
          <Link
            to={`/classes/${classId}`}
            title="Back to class"
            className="shrink-0 rounded px-1 text-lg text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
          >
            ←
          </Link>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex min-w-0 items-center gap-2">
              <label htmlFor="doc-title" className="sr-only">
                Note title
              </label>
              <input
                id="doc-title"
                value={title}
                placeholder="Untitled note"
                onChange={(event) => handleTitleChange(event.target.value)}
                className="min-w-0 max-w-full rounded border border-transparent bg-transparent px-1.5 py-0.5 text-lg text-ink placeholder:text-ink-faint hover:border-line-strong focus:border-line-strong"
                size={Math.max(12, Math.min(48, title.length || 12))}
              />
              <SaveStatus state={displayState} />
            </div>

            <div className="-ml-0.5 flex items-center gap-2">
              <DocumentMenubar
                editor={editor}
                onNewNote={() => void handleNewNote()}
                onRename={focusTitle}
                onDelete={() => void handleDeleteNote()}
              />
              {klass && (
                <span className="hidden truncate text-xs text-ink-faint sm:inline">
                  {klass.name}
                </span>
              )}
            </div>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-3 self-start pt-1">
            <Button
              size="sm"
              title="Toggle AI assistant (Ctrl+Shift+A)"
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen((open) => !open)}
            >
              AI
            </Button>
          </div>
        </div>
      </header>

      <div
        className={cn(
          'flex min-h-0 flex-1',
          AI_SIDEBAR_SIDE === 'right' && 'flex-row-reverse',
        )}
      >
        {sidebarOpen && (
          <aside
            style={{ width: AI_SIDEBAR_WIDTH_PX }}
            aria-label="AI assistant"
            className={cn(
              'hidden shrink-0 flex-col bg-surface lg:flex',
              AI_SIDEBAR_SIDE === 'left' ? 'border-r border-line' : 'border-l border-line',
            )}
          >
            <div className="p-4 text-sm text-ink-muted">
              AI assistant arrives in the next stage.
            </div>
          </aside>
        )}

        <main className="flex min-w-0 flex-1 flex-col">
          <DocumentEditor
            documentId={doc.id}
            version={doc.version}
            initialContent={doc.content as JSONContent}
            onChange={handleContentChange}
            onReady={setEditor}
          />
        </main>
      </div>

      <AiDrawer open={sidebarOpen} onClose={() => setSidebarOpen(false)}>
        <div className="p-4 text-sm text-ink-muted">
          AI assistant arrives in the next stage.
        </div>
      </AiDrawer>
    </div>
  )
}
