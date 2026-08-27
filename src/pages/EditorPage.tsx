import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { JSONContent } from '@tiptap/react'
import { DocumentEditor } from '../editor/DocumentEditor'
import { SaveStatus, type SaveState } from '../components/SaveStatus'
import { Button } from '../components/ui/Button'
import { AiDrawer } from '../components/AiDrawer'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { createAutosaveScheduler } from '../lib/autosave'
import { fetchClass } from '../services/classes'
import { fetchDocument, saveDocument } from '../services/documents'
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
  const online = useOnlineStatus()

  const [klass, setKlass] = useState<ClassRow | null>(null)
  const [doc, setDoc] = useState<DocumentRow | null>(null)
  const [title, setTitle] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [sidebarOpen, setSidebarOpen] = useState(true)

  // The version the client last read. Every save is conditional on it, and it
  // advances on each successful write. Held in a ref so the scheduler always
  // reads the current value rather than a captured stale one.
  const versionRef = useRef<number>(1)

  const persist = useCallback(
    async ({ title: nextTitle, content }: DraftPayload) => {
      if (!documentId) return
      setSaveState('saving')
      try {
        const result = await saveDocument({
          documentId,
          title: nextTitle,
          content,
          expectedVersion: versionRef.current,
        })

        if (result.status === 'stale') {
          // Another tab saved first. Re-read rather than clobbering it.
          const fresh = await fetchDocument(documentId)
          if (fresh) {
            versionRef.current = fresh.version
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
    [documentId],
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
          fetchClass(classId),
          fetchDocument(documentId),
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
  }, [classId, documentId])

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

  const contentRef = useRef<JSONContent | null>(null)

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

  if (!doc) return null

  const displayState: SaveState = online ? saveState : 'offline'

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-surface px-4">
        <Link
          to={`/classes/${classId}`}
          className="shrink-0 text-sm text-ink-muted hover:text-ink"
        >
          ←
        </Link>
        <div className="flex min-w-0 items-baseline gap-2">
          {klass && (
            <span className="hidden shrink-0 text-sm text-ink-muted sm:inline">
              {klass.name} ›
            </span>
          )}
          <label htmlFor="doc-title" className="sr-only">
            Note title
          </label>
          <input
            id="doc-title"
            value={title}
            placeholder="Untitled note"
            onChange={(event) => handleTitleChange(event.target.value)}
            className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-base text-ink placeholder:text-ink-faint hover:border-line-strong focus:border-line-strong"
          />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          <SaveStatus state={displayState} />
          <Button
            size="sm"
            title="Toggle AI assistant (Ctrl+Shift+A)"
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen((open) => !open)}
          >
            AI
          </Button>
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
            initialContent={doc.content as JSONContent}
            onChange={handleContentChange}
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
