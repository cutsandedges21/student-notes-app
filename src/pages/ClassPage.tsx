import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AppHeader } from '../components/AppHeader'
import { Button } from '../components/ui/Button'
import { useAuth } from '../contexts/AuthContext'
import { fetchClassBySlug, updateClass } from '../services/classes'
import { createDocument, fetchDocuments } from '../services/documents'
import { formatRelativeTime } from '../lib/formatDate'
import { MenuButton } from '../components/ui/MenuButton'
import { RenameClassDialog } from '../components/RenameClassDialog'
import { deleteClass } from '../services/classes'
import { deleteDocument } from '../services/documents'
import type { ClassRow, DocumentListItem } from '../types/database'

export default function ClassPage() {
  const { classSlug } = useParams<{ classSlug: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [klass, setKlass] = useState<ClassRow | null>(null)
  const [documents, setDocuments] = useState<DocumentListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [professor, setProfessor] = useState('')
  const [renameOpen, setRenameOpen] = useState(false)

  const userId = user?.id ?? null

  const load = useCallback(async () => {
    if (!classSlug) return
    try {
      // The slug identifies the class; everything downstream still works from
      // its id, so a rename cannot strand in-flight requests.
      const classRow = await fetchClassBySlug(userId, classSlug)
      const docs = classRow ? await fetchDocuments(userId, classRow.id) : []
      setKlass(classRow)
      setProfessor(classRow?.professor ?? '')
      setDocuments(docs)
    } catch (caught) {
      console.error('[ClassPage] failed to load class:', caught)
    } finally {
      setLoading(false)
    }
  }, [classSlug, userId])

  useEffect(() => {
    void load()
  }, [load])

  async function handleNewNote() {
    if (!klass) return
    const doc = await createDocument(userId, klass.id)
    navigate(`/classes/${klass.slug}/${doc.slug}`)
  }

  async function handleProfessorBlur() {
    if (!klass || professor === klass.professor) return
    try {
      await updateClass(userId, klass.id, { professor: professor.trim() })
      setKlass({ ...klass, professor: professor.trim() })
    } catch (caught) {
      console.error('[ClassPage] failed to update professor:', caught)
      setProfessor(klass.professor)
    }
  }

  async function handleRename(name: string) {
    if (!klass) return
    await updateClass(userId, klass.id, { name })
    setKlass({ ...klass, name })
  }

  async function handleDeleteClass() {
    if (!klass) return
    const confirmed = window.confirm(
      `Delete "${klass.name}" and all of its notes? This cannot be undone.`,
    )
    if (!confirmed) return

    try {
      await deleteClass(userId, klass.id)
      navigate('/classes', { replace: true })
    } catch (caught) {
      console.error('[ClassPage] failed to delete class:', caught)
    }
  }

  async function handleDeleteDocument(documentId: string, docTitle: string) {
    const confirmed = window.confirm(
      `Delete "${docTitle || 'Untitled note'}"? This cannot be undone.`,
    )
    if (!confirmed) return

    try {
      await deleteDocument(userId, documentId)
      await load()
    } catch (caught) {
      console.error('[ClassPage] failed to delete note:', caught)
    }
  }

  if (loading) return null
  if (!klass) return <div className="p-6 text-ink-muted">Class not found.</div>

  return (
    <div className="min-h-full">
      <AppHeader />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Link to="/classes" className="text-sm text-ink-muted hover:text-ink">
          ← My classes
        </Link>

        <div className="mt-6 flex items-center justify-between gap-4">
          <h1 className="text-2xl font-medium text-ink">{klass.name}</h1>
          <MenuButton
            label="Class options"
            items={[
              { label: 'Rename class', onSelect: () => setRenameOpen(true) },
              {
                label: 'Delete class',
                destructive: true,
                onSelect: () => void handleDeleteClass(),
              },
            ]}
          />
        </div>

        <div className="mt-2 flex items-center gap-2">
          <label htmlFor="professor" className="text-sm text-ink-muted">
            Professor
          </label>
          <input
            id="professor"
            value={professor}
            placeholder="Add a name"
            onChange={(event) => setProfessor(event.target.value)}
            onBlur={() => void handleProfessorBlur()}
            className="rounded border border-transparent bg-transparent px-1.5 py-0.5 text-sm text-ink placeholder:text-ink-faint hover:border-line-strong focus:border-line-strong"
          />
        </div>

        <div className="mt-10 flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-ink-muted">
            Notes
          </h2>
          {documents.length > 0 && (
            <Button variant="primary" size="sm" onClick={() => void handleNewNote()}>
              New note
            </Button>
          )}
        </div>

        {documents.length === 0 ? (
          <div className="mt-16 text-center">
            <p className="text-ink">No notes yet.</p>
            <p className="mt-1 text-sm text-ink-muted">Start your first lecture note.</p>
            <Button
              variant="primary"
              className="mt-6"
              onClick={() => void handleNewNote()}
            >
              New note
            </Button>
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {documents.map((doc) => (
              <li key={doc.id} className="flex items-center gap-2">
                <Link
                  to={`/classes/${klass.slug}/${doc.slug}`}
                  className="flex flex-1 items-center justify-between px-1 py-3 transition-colors hover:bg-surface-hover"
                >
                  <span className="text-ink">{doc.title || 'Untitled note'}</span>
                  <span className="text-sm text-ink-faint">
                    {formatRelativeTime(doc.updated_at)}
                  </span>
                </Link>
                <MenuButton
                  label={`Options for ${doc.title || 'Untitled note'}`}
                  items={[
                    {
                      label: 'Delete note',
                      destructive: true,
                      onSelect: () => void handleDeleteDocument(doc.id, doc.title),
                    },
                  ]}
                />
              </li>
            ))}
          </ul>
        )}
      </main>

      <RenameClassDialog
        open={renameOpen}
        currentName={klass.name}
        onClose={() => setRenameOpen(false)}
        onRename={handleRename}
      />
    </div>
  )
}
