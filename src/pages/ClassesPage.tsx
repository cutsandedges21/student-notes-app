import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppHeader } from '../components/AppHeader'
import { Button } from '../components/ui/Button'
import { CreateClassDialog } from '../components/CreateClassDialog'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { StorageNotice } from '../components/StorageNotice'
import { listSharedDocuments, type SharedWithMe } from '../services/sharing'
import { sharedNoteHref } from '../lib/noteRef'
import { MenuButton } from '../components/ui/MenuButton'
import { useAuth } from '../contexts/AuthContext'
import { createClass, deleteClass, fetchClasses, type ClassInput } from '../services/classes'
import { formatRelativeTime } from '../lib/formatDate'
import { describeDataError } from '../lib/dataErrors'
import type { ClassWithCount } from '../types/database'

export default function ClassesPage() {
  const { user } = useAuth()
  const [classes, setClasses] = useState<ClassWithCount[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The class awaiting confirmation, or null when nothing is being deleted. */
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null)
  /*
   * Notes other people shared, which are not filed in any class of yours --
   * the class belongs to whoever shared it. Without somewhere to list them, a
   * shared note could only be reached by finding the original link again.
   */
  const [sharedWithMe, setSharedWithMe] = useState<SharedWithMe[]>([])

  // Reads `user` directly: `userId` is derived further down, and a hook cannot
  // wait for it.
  useEffect(() => {
    if (!user) {
      setSharedWithMe([])
      return
    }
    let cancelled = false
    void listSharedDocuments()
      .then((rows) => {
        if (!cancelled) setSharedWithMe(rows)
      })
      .catch((caught) => console.error('[ClassesPage] failed to list shared notes:', caught))
    return () => {
      cancelled = true
    }
  }, [user])

  const userId = user?.id ?? null

  const load = useCallback(async () => {
    try {
      setClasses(await fetchClasses(userId))
    } catch (caught) {
      console.error('[ClassesPage] failed to load classes:', caught)
      setError(describeDataError(caught))
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    void load()
  }, [load])

  // Deliberately not caught here: the dialog needs the rejection so it can
  // stay open and show what went wrong instead of closing on a failed create.
  async function handleCreate(input: ClassInput) {
    await createClass(userId, input)
    await load()
  }

  async function handleDelete(classId: string) {
    setPendingDelete(null)
    setError(null)
    try {
      await deleteClass(userId, classId)
      await load()
    } catch (caught) {
      console.error('[ClassesPage] failed to delete class:', caught)
      setError(describeDataError(caught))
    }
  }

  return (
    <div className="min-h-full">
      <AppHeader />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-medium text-ink">My classes</h1>
          {classes.length > 0 && (
            <Button variant="primary" onClick={() => setDialogOpen(true)}>
              Create class
            </Button>
          )}
        </div>

        <StorageNotice hasContent={classes.length > 0} />

        {error && (
          <p role="alert" className="mt-4 text-sm text-red-600">
            {error}
          </p>
        )}

        {loading ? null : classes.length === 0 ? (
          <div className="mt-24 text-center">
            <h2 className="text-lg font-medium text-ink">Create your first class</h2>
            <p className="mx-auto mt-2 max-w-sm text-sm text-ink-muted">
              Classes keep your notes and AI context organized.
            </p>
            <Button
              variant="primary"
              className="mt-6"
              onClick={() => setDialogOpen(true)}
            >
              Create class
            </Button>
          </div>
        ) : (
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {classes.map((item) => (
              <li key={item.id} className="relative">
                {/* The menu sits outside the Link: nesting a button inside an
                    anchor makes every menu click also navigate. */}
                <div className="absolute right-3 top-3 z-10">
                  <MenuButton
                    label={`Options for ${item.name}`}
                    items={[
                      {
                        label: 'Delete class',
                        destructive: true,
                        onSelect: () => setPendingDelete({ id: item.id, name: item.name }),
                      },
                    ]}
                  />
                </div>
                <Link
                  to={`/classes/${item.slug}`}
                  className="block rounded border border-line bg-surface p-5 transition-colors hover:border-line-strong hover:bg-surface-hover"
                >
                  <h2 className="pr-10 font-medium text-ink">{item.name}</h2>
                  {item.course_code && (
                    <p className="mt-0.5 text-sm text-ink-muted">{item.course_code}</p>
                  )}
                  <p className="mt-4 text-sm text-ink-faint">
                    {item.semester && `${item.semester} · `}
                    {item.note_count} {item.note_count === 1 ? 'note' : 'notes'}
                  </p>
                  <p className="mt-1 text-sm text-ink-faint">
                    Edited {formatRelativeTime(item.updated_at)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {sharedWithMe.length > 0 && (
          <section className="mt-12">
            <h2 className="font-ui text-sm font-medium uppercase tracking-wide text-ink-muted">
              Shared with me
            </h2>
            <ul className="mt-4 divide-y divide-line border-y border-line">
              {sharedWithMe.map((note) => (
                <li key={note.id}>
                  <Link
                    to={sharedNoteHref(note.slug, note.id)}
                    className="flex items-center justify-between gap-4 px-1 py-3 transition-colors hover:bg-surface-hover"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-ink">
                        {note.title || 'Untitled note'}
                      </span>
                      <span className="block truncate text-xs text-ink-faint">
                        {note.ownerName}
                        {note.mode === 'view' ? ' · view only' : ''}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm text-ink-faint">
                      {formatRelativeTime(note.updatedAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      <CreateClassDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreate={handleCreate}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this class?"
        message={`“${pendingDelete?.name ?? ''}” and every note in it will be removed. This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => pendingDelete && void handleDelete(pendingDelete.id)}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}
