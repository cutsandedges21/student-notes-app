import { useCallback, useEffect, useState } from 'react'
import type { Editor, JSONContent } from '@tiptap/react'
import {
  createVersion,
  fetchVersion,
  listVersions,
  VERSION_PAGE_SIZE,
  type DocumentVersion,
} from '../services/versions'
import { describeDataError } from '../lib/dataErrors'
import { restoreContent } from './restoreContent'

/**
 * The version-history controller.
 *
 * A hook rather than state on `EditorPage`, following `useComments` and
 * `useCollaboration`: the orchestrator is already the largest thing in the app
 * and the brief is explicit about not bolting more onto it.
 *
 * History is fetched when the panel is first shown, not when the note opens.
 * Every note has history and almost no session looks at it, so loading it
 * eagerly would be a request per note opened, for a list nobody asked to see.
 */

export interface UseVersionHistoryOptions {
  documentId: string
  /** Null while signed out; there is then no history to have. */
  userId: string | null
  editor: Editor | null
  /** True while the history panel is the visible one. */
  active: boolean
  /** The note as it stands, snapshotted before a restore replaces it. */
  currentContent: () => JSONContent | null
  /** Runs after a restore lands, so the page can persist the new state. */
  onRestored?: () => void
}

export interface VersionHistory {
  versions: DocumentVersion[]
  loading: boolean
  error: string | null
  /** The version being previewed, if any. */
  previewId: string | null
  previewContent: JSONContent | null
  busy: boolean
  /** False when there is certainly nothing more to fetch. */
  hasMore: boolean
  refresh: () => void
  loadMore: () => void
  preview: (versionId: string | null) => void
  restore: (versionId: string) => void
  /** Takes a snapshot of the note as it stands now. */
  saveVersion: () => void
}

export function useVersionHistory({
  documentId,
  userId,
  editor,
  active,
  currentContent,
  onRestored,
}: UseVersionHistoryOptions): VersionHistory {
  /*
   * History and the note it belongs to are one piece of state, keyed together.
   *
   * Keeping them apart needed an effect to blank the list when the note
   * changed, which meant a render where the previous note's history was on
   * screen under the new note's title -- and a window in which restoring would
   * have put one note's text into another. Deriving it instead makes that
   * unrepresentable: history whose key does not match is not this note's.
   */
  const [loaded, setLoaded] = useState<{
    key: string
    rows: DocumentVersion[]
    hasMore: boolean
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [preview_, setPreview] = useState<{
    key: string
    versionId: string
    content: JSONContent | null
  } | null>(null)
  const [busy, setBusy] = useState(false)
  /** Bumped to force a reload; simpler than threading a promise back. */
  const [nonce, setNonce] = useState(0)
  const [paging, setPaging] = useState(false)

  const key = `${documentId}:${nonce}`
  const fresh = loaded?.key === key
  const versions = fresh ? loaded.rows : []
  const hasMore = fresh ? loaded.hasMore : false
  // Derived rather than stored: we are loading exactly while the panel wants
  // history that has not arrived for this note yet.
  const loading = (active && Boolean(userId) && !fresh) || paging

  const previewId = preview_?.key === key ? preview_.versionId : null
  const previewContent = preview_?.key === key ? preview_.content : null

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (!active || !userId) return

    let cancelled = false

    listVersions(documentId)
      .then((rows) => {
        // The note may have changed under a slow request; the key is what
        // makes the stale result harmless rather than something to detect.
        if (cancelled) return
        setLoaded({ key, rows, hasMore: rows.length === VERSION_PAGE_SIZE })
      })
      .catch((caught) => {
        if (cancelled) return
        console.error('[useVersionHistory] could not list versions:', caught)
        setError(describeDataError(caught))
        setLoaded({ key, rows: [], hasMore: false })
      })

    return () => {
      cancelled = true
    }
  }, [documentId, userId, active, key])

  const loadMore = useCallback(() => {
    // Read from the state object rather than the derived array: the derived
    // one is a fresh value every render, which makes this callback a fresh one
    // every render too.
    const rows = loaded?.key === key ? loaded.rows : []
    const oldest = rows[rows.length - 1]
    if (!oldest || loading) return

    setPaging(true)
    listVersions(documentId, { before: oldest.createdAt })
      .then((rows) => {
        setLoaded((current) =>
          current?.key === key
            ? {
                ...current,
                rows: [...current.rows, ...rows],
                hasMore: rows.length === VERSION_PAGE_SIZE,
              }
            : current,
        )
      })
      .catch((caught) => {
        console.error('[useVersionHistory] could not page history:', caught)
        setError(describeDataError(caught))
      })
      .finally(() => setPaging(false))
  }, [documentId, loaded, loading, key])

  const preview = useCallback(
    (versionId: string | null) => {
      setError(null)
      if (!versionId) {
        setPreview(null)
        return
      }

      setPreview({ key, versionId, content: null })

      fetchVersion(versionId)
        .then((version) =>
          setPreview((current) =>
            current?.versionId === versionId
              ? { ...current, content: version.content }
              : current,
          ),
        )
        .catch((caught) => {
          console.error('[useVersionHistory] could not read a version:', caught)
          setError(describeDataError(caught))
        })
    },
    [key],
  )

  /**
   * Restore.
   *
   * The current note is snapshotted first, so the restore is itself reversible
   * from the panel and not only from undo. If that snapshot fails the restore
   * does not happen: silently discarding what is on screen in order to bring
   * back something older is exactly the trade nobody would agree to.
   */
  const restore = useCallback(
    (versionId: string) => {
      if (!userId || !editor) return

      setBusy(true)
      setError(null)

      const current = currentContent()

      void (async () => {
        try {
          const version = await fetchVersion(versionId)

          if (current) await createVersion(userId, documentId, current, 'user')

          const result = restoreContent(editor, version.content)
          if (!result.ok) {
            setError(
              result.reason === 'unparseable'
                ? 'That version was written by an older version of the editor and cannot be opened here.'
                : 'The editor is not ready yet. Try again in a moment.',
            )
            return
          }

          setPreview(null)
          onRestored?.()
          refresh()
        } catch (caught) {
          console.error('[useVersionHistory] restore failed:', caught)
          setError(describeDataError(caught))
        } finally {
          setBusy(false)
        }
      })()
    },
    [userId, editor, documentId, currentContent, onRestored, refresh],
  )

  const saveVersion = useCallback(() => {
    const content = currentContent()
    if (!userId || !content) return

    setBusy(true)
    setError(null)

    createVersion(userId, documentId, content, 'user')
      .then(() => refresh())
      .catch((caught) => {
        console.error('[useVersionHistory] could not save a version:', caught)
        setError(describeDataError(caught))
      })
      .finally(() => setBusy(false))
  }, [userId, documentId, currentContent, refresh])

  return {
    versions,
    loading,
    error,
    previewId,
    previewContent,
    busy,
    hasMore,
    refresh,
    loadMore,
    preview,
    restore,
    saveVersion,
  }
}
