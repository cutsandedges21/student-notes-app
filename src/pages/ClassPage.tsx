import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AppHeader } from '../components/AppHeader'
import { Button } from '../components/ui/Button'
import { useAuth } from '../contexts/AuthContext'
import { fetchClass, updateClass } from '../services/classes'
import { createDocument, fetchDocuments } from '../services/documents'
import { formatRelativeTime } from '../lib/formatDate'
import type { ClassRow, DocumentListItem } from '../types/database'

export default function ClassPage() {
  const { classId } = useParams<{ classId: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [klass, setKlass] = useState<ClassRow | null>(null)
  const [documents, setDocuments] = useState<DocumentListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [professor, setProfessor] = useState('')

  const load = useCallback(async () => {
    if (!classId) return
    try {
      const [classRow, docs] = await Promise.all([
        fetchClass(classId),
        fetchDocuments(classId),
      ])
      setKlass(classRow)
      setProfessor(classRow?.professor ?? '')
      setDocuments(docs)
    } catch (caught) {
      console.error('[ClassPage] failed to load class:', caught)
    } finally {
      setLoading(false)
    }
  }, [classId])

  useEffect(() => {
    void load()
  }, [load])

  async function handleNewNote() {
    if (!user || !classId) return
    const doc = await createDocument(user.id, classId)
    navigate(`/classes/${classId}/documents/${doc.id}`)
  }

  async function handleProfessorBlur() {
    if (!classId || !klass || professor === klass.professor) return
    try {
      await updateClass(classId, { professor: professor.trim() })
      setKlass({ ...klass, professor: professor.trim() })
    } catch (caught) {
      console.error('[ClassPage] failed to update professor:', caught)
      setProfessor(klass.professor)
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

        <h1 className="mt-6 text-2xl font-medium text-ink">{klass.name}</h1>

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
              <li key={doc.id}>
                <Link
                  to={`/classes/${klass.id}/documents/${doc.id}`}
                  className="flex items-center justify-between px-1 py-3 transition-colors hover:bg-surface-hover"
                >
                  <span className="text-ink">{doc.title || 'Untitled note'}</span>
                  <span className="text-sm text-ink-faint">
                    {formatRelativeTime(doc.updated_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}
