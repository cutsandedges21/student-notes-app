import { useState } from 'react'
import { History, RotateCcw, Sparkles, X } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { formatRelativeTime } from '../lib/formatDate'
import { extractPlainText } from '../lib/tiptap'
import { cn } from '../lib/cn'
import type { DocumentVersion } from '../services/versions'
import type { JSONContent } from '@tiptap/react'

/**
 * The version-history panel.
 *
 * Snapshots have been written since the first migration and nothing has ever
 * shown them, so this is the first time a student can see that the note had a
 * before.
 *
 * Versions are labelled by what produced them. "Before an AI edit" is the
 * label people are actually looking for -- the reason to open history at all
 * is usually that the assistant rewrote something and took a paragraph with
 * it -- so an AI snapshot says so rather than being another timestamp.
 *
 * Restoring asks first. It replaces the whole note, and unlike the edits
 * around it that is not something you discover you did by looking at the
 * screen.
 */

interface VersionHistoryPanelProps {
  versions: DocumentVersion[]
  loading: boolean
  error: string | null
  previewId: string | null
  previewContent: JSONContent | null
  busy: boolean
  hasMore: boolean
  /** Null while signed out; the panel explains instead of showing an empty list. */
  currentUserId: string | null
  onPreview: (versionId: string | null) => void
  onRestore: (versionId: string) => void
  onSaveVersion: () => void
  onLoadMore: () => void
}

/** How much of a version to show. Enough to recognise it, not to read it. */
const PREVIEW_LIMIT = 1200

function label(version: DocumentVersion): string {
  return version.createdBy === 'ai' ? 'Before an AI edit' : 'Saved version'
}

export function VersionHistoryPanel({
  versions,
  loading,
  error,
  previewId,
  previewContent,
  busy,
  hasMore,
  currentUserId,
  onPreview,
  onRestore,
  onSaveVersion,
  onLoadMore,
}: VersionHistoryPanelProps) {
  const [confirming, setConfirming] = useState<DocumentVersion | null>(null)

  if (!currentUserId) {
    return (
      <div className="p-4 text-sm text-ink-muted">
        <p>
          History is kept for notes in your account. Guest notes live only in
          this browser, with no server to keep their earlier versions on.
        </p>
      </div>
    )
  }

  const previewText = previewContent
    ? extractPlainText(previewContent).slice(0, PREVIEW_LIMIT)
    : null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <p className="text-xs text-ink-muted">
          Restoring keeps your current note as a version too.
        </p>
        <Button size="sm" onClick={onSaveVersion} disabled={busy}>
          Save a version
        </Button>
      </div>

      {error && (
        <p role="alert" className="border-b border-line bg-danger/5 px-4 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {versions.length === 0 && !loading && (
          <div className="p-4 text-sm text-ink-muted">
            <History size={18} className="mb-2 text-ink-faint" />
            <p>
              No earlier versions yet. One is kept automatically before the
              assistant edits this note, and whenever you save one.
            </p>
          </div>
        )}

        <ul className="divide-y divide-line">
          {versions.map((version) => {
            const open = previewId === version.id
            return (
              <li key={version.id}>
                <div className={cn('px-4 py-3', open && 'bg-surface-hover')}>
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onPreview(open ? null : version.id)}
                      aria-expanded={open}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                        {version.createdBy === 'ai' && (
                          <Sparkles size={13} className="shrink-0 text-ink-faint" />
                        )}
                        {label(version)}
                      </span>
                      <span className="mt-0.5 block text-xs text-ink-muted">
                        {formatRelativeTime(version.createdAt)}
                      </span>
                    </button>

                    <Button
                      size="sm"
                      onClick={() => setConfirming(version)}
                      disabled={busy}
                      className="shrink-0"
                    >
                      <RotateCcw size={13} />
                      Restore
                    </Button>
                  </div>

                  {open && (
                    <div className="mt-3 rounded border border-line bg-surface p-3">
                      {previewText === null ? (
                        <p className="text-xs text-ink-faint">Loading…</p>
                      ) : previewText.trim() === '' ? (
                        <p className="text-xs text-ink-faint">This version was empty.</p>
                      ) : (
                        <>
                          <div className="flex items-center justify-between gap-2 pb-1">
                            <span className="text-[11px] uppercase tracking-wide text-ink-faint">
                              Preview
                            </span>
                            <button
                              type="button"
                              onClick={() => onPreview(null)}
                              aria-label="Close preview"
                              className="rounded p-0.5 text-ink-faint hover:bg-surface-hover"
                            >
                              <X size={13} />
                            </button>
                          </div>
                          <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-ink-muted">
                            {previewText}
                          </p>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>

        {loading && <p className="px-4 py-3 text-sm text-ink-muted">Loading…</p>}

        {hasMore && !loading && (
          <div className="p-4">
            <Button size="sm" onClick={onLoadMore} className="w-full">
              Show older versions
            </Button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirming !== null}
        title="Restore this version?"
        /* Says what happens to the current note, because "restore" on its own
           reads as additive and this replaces everything. */
        message={
          confirming
            ? `The note will go back to how it was ${formatRelativeTime(confirming.createdAt)}. What is in it now is kept as a version, so this can be undone.`
            : ''
        }
        confirmLabel="Restore"
        onConfirm={() => {
          if (confirming) onRestore(confirming.id)
          setConfirming(null)
        }}
        onCancel={() => setConfirming(null)}
      />
    </div>
  )
}
