import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AppHeader } from '../components/AppHeader'
import { Button } from '../components/ui/Button'
import { useAuth } from '../contexts/AuthContext'
import { fetchClassBySlug, updateClass } from '../services/classes'
import { createDocument, fetchDocuments } from '../services/documents'
import { formatRelativeTime } from '../lib/formatDate'
import { describeDataError } from '../lib/dataErrors'
import { noteHref } from '../lib/noteRef'
import { MenuButton } from '../components/ui/MenuButton'
import { RenameClassDialog } from '../components/RenameClassDialog'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { deleteClass } from '../services/classes'
import { deleteDocument } from '../services/documents'
import { duplicateDocument, moveDocument } from '../services/documentActions'
import { fetchClasses } from '../services/classes'
import { MoveNoteDialog } from '../components/MoveNoteDialog'
import type { ClassRow, DocumentListItem } from '../types/database'

export default function ClassPage() {
  const { classSlug } = useParams<{ classSlug: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [klass, setKlass] = useState<ClassRow | null>(null)
  /** The note being filed elsewhere, and the classes it could go to. */
  const [moving, setMoving] = useState<{ id: string; title: string } | null>(null)
  const [busyNote, setBusyNote] = useState<string | null>(null)
  const [documents, setDocuments] = useState<DocumentListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [professor, setProfessor] = useState('')
  const [renameOpen, setRenameOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /*
   * What the confirmation is about, or null when it is closed.
   *
   * One dialog rather than two: the question and the consequence differ, but
   * the shape of the interaction does not, and two nearly-identical dialogs
   * drift apart.
   */
  const [pendingDelete, setPendingDelete] = useState<
    { kind: 'class' } | { kind: 'note'; id: string; title: string } | null
  >(null)

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
      setError(describeDataError(caught))
    } finally {
      setLoading(false)
    }
  }, [classSlug, userId])

  useEffect(() => {
    void load()
  }, [load])

  async function handleNewNote() {
    if (!klass) return
    setError(null)
    try {
      const doc = await createDocument(userId, klass.id)
      navigate(noteHref(klass.slug, doc.slug, doc.id))
    } catch (caught) {
      console.error('[ClassPage] failed to create note:', caught)
      setError(describeDataError(caught))
    }
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
    setPendingDelete(null)
    setError(null)
    try {
      await deleteClass(userId, klass.id)
      navigate('/classes', { replace: true })
    } catch (caught) {
      console.error('[ClassPage] failed to delete class:', caught)
      setError(describeDataError(caught))
    }
  }

  async function handleDeleteDocument(documentId: string) {
    setPendingDelete(null)
    setError(null)
    try {
      await deleteDocument(userId, documentId)
      await load()
    } catch (caught) {
      console.error('[ClassPage] failed to delete note:', caught)
      setError(describeDataError(caught))
    }
  }

  /**
   * Copies a note and opens the copy.
   *
   * Opening it is the point: a copy made and left in a list is one the student
   * has to go and find, and the reason for making one is almost always to
   * start changing it.
   */
  async function handleDuplicate(documentId: string) {
    setBusyNote(documentId)
    setError(null)
    try {
      const copy = await duplicateDocument(userId, documentId)
      navigate(noteHref(klass?.slug ?? '', copy.slug, copy.id))
    } catch (caught) {
      console.error('[ClassPage] failed to copy note:', caught)
      setError(describeDataError(caught))
    } finally {
      setBusyNote(null)
    }
  }

  async function handleMove(destinationClassId: string) {
    if (!moving) return
    const noteId = moving.id
    setMoving(null)
    setBusyNote(noteId)
    setError(null)
    try {
      await moveDocument(userId, noteId, destinationClassId)
      // Reloaded rather than navigated: the note has left this class, and the
      // student is looking at what is still in it.
      await load()
    } catch (caught) {
      console.error('[ClassPage] failed to move note:', caught)
      setError(describeDataError(caught))
    } finally {
      setBusyNote(null)
    }
  }

  if (loading) return null
  if (!klass) {
    return (
      <div className="min-h-full">
        <AppHeader />
        <main className="mx-auto max-w-3xl px-6 py-10">
          <Link to="/classes" className="text-sm text-ink-muted hover:text-ink">
            ← My classes
          </Link>
          {/* A failed request and a genuinely missing class look identical from
              here, so say which one happened rather than always blaming the
              URL. */}
          <p className="mt-6 text-ink">{error ? 'Could not open this class.' : 'Class not found.'}</p>
          {error && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {error}
            </p>
          )}
        </main>
      </div>
    )
  }

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
                onSelect: () => setPendingDelete({ kind: 'class' }),
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

        {error && (
          <p role="alert" className="mt-4 text-sm text-danger">
            {error}
          </p>
        )}

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
                  to={noteHref(klass.slug, doc.slug, doc.id)}
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
                      label: busyNote === doc.id ? 'Working…' : 'Make a copy',
                      disabled: busyNote !== null,
                      onSelect: () => void handleDuplicate(doc.id),
                    },
                    {
                      label: 'Move to another class…',
                      disabled: busyNote !== null,
                      onSelect: () => setMoving({ id: doc.id, title: doc.title }),
                    },
                    {
                      label: 'Delete note',
                      destructive: true,
                      separatorBefore: true,
                      onSelect: () =>
                        setPendingDelete({ kind: 'note', id: doc.id, title: doc.title }),
                    },
                  ]}
                />
              </li>
            ))}
          </ul>
        )}
      </main>

      <MoveNoteDialog
        open={moving !== null}
        noteTitle={moving?.title ?? ''}
        currentClassId={klass.id}
        loadClasses={() => fetchClasses(userId)}
        onMove={handleMove}
        onClose={() => setMoving(null)}
      />

      <RenameClassDialog
        open={renameOpen}
        currentName={klass.name}
        onClose={() => setRenameOpen(false)}
        onRename={handleRename}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete?.kind === 'class' ? 'Delete this class?' : 'Delete this note?'}
        message={
          pendingDelete?.kind === 'class'
            ? `“${klass.name}” and every note in it will be removed. This cannot be undone.`
            : `“${pendingDelete?.title || 'Untitled note'}” will be removed. This cannot be undone.`
        }
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (pendingDelete?.kind === 'class') void handleDeleteClass()
          else if (pendingDelete) void handleDeleteDocument(pendingDelete.id)
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}
