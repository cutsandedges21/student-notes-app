import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppHeader } from '../components/AppHeader'
import { Button } from '../components/ui/Button'
import { CreateClassDialog } from '../components/CreateClassDialog'
import { StorageNotice } from '../components/StorageNotice'
import { useAuth } from '../contexts/AuthContext'
import { createClass, fetchClasses, type ClassInput } from '../services/classes'
import { formatRelativeTime } from '../lib/formatDate'
import type { ClassWithCount } from '../types/database'

export default function ClassesPage() {
  const { user } = useAuth()
  const [classes, setClasses] = useState<ClassWithCount[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)

  const userId = user?.id ?? null

  const load = useCallback(async () => {
    try {
      setClasses(await fetchClasses(userId))
    } catch (caught) {
      console.error('[ClassesPage] failed to load classes:', caught)
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    void load()
  }, [load])

  async function handleCreate(input: ClassInput) {
    await createClass(userId, input)
    await load()
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
              <li key={item.id}>
                <Link
                  to={`/classes/${item.id}`}
                  className="block rounded border border-line bg-surface p-5 transition-colors hover:border-line-strong hover:bg-surface-hover"
                >
                  <h2 className="font-medium text-ink">{item.name}</h2>
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
      </main>

      <CreateClassDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreate={handleCreate}
      />
    </div>
  )
}
