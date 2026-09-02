import { useEffect, useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { cn } from '../lib/cn'
import { normaliseImageSrc } from './imageSrc'

/**
 * Insert an image.
 *
 * Replaces `window.prompt('Image URL')`, which could not validate what was
 * typed, could not explain why a `javascript:` source was refused, and had
 * nowhere to ask for alt text -- so every image the app has ever inserted was
 * unlabelled, and unreadable to anyone using a screen reader.
 *
 * Alt text is a field here rather than a later "add description" affordance
 * because it is only ever written at the moment of insertion. Left to be added
 * afterwards it is never added. It is not required -- a decorative image has
 * no useful description, and forcing one produces "image" as alt text on every
 * picture in the note, which is worse than none -- but it is asked for.
 */

export function ImageDialog({
  open,
  canUpload = false,
  uploading = false,
  uploadError = null,
  onUpload,
  onSubmit,
  onClose,
}: {
  open: boolean
  /** False while signed out: there is no account to file an upload under. */
  canUpload?: boolean
  uploading?: boolean
  uploadError?: string | null
  onUpload?: (file: File, alt: string) => void
  onSubmit: (image: { src: string; alt: string }) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState('')
  const [alt, setAlt] = useState('')
  const [error, setError] = useState<string | null>(null)
  /** Dragging over the drop zone, for the affordance only. */
  const [over, setOver] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (open && !node.open) {
      setValue('')
      setAlt('')
      setError(null)
      setOver(false)
      node.showModal()
      // Focus the address field rather than the file button: it is the one
      // that works signed out, and the file button is reachable by Tab.
      inputRef.current?.focus()
    }
    if (!open && node.open) node.close()
  }, [open])

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const result = normaliseImageSrc(value)
    if ('error' in result) {
      setError(result.error)
      return
    }
    onSubmit({ src: result.src, alt: alt.trim() })
  }

  /** Alt text is shared by both routes: it describes the image, not the source. */
  function take(file: File | undefined) {
    if (file && onUpload) onUpload(file, alt.trim())
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose()
      }}
      aria-labelledby="image-dialog-title"
      className="w-full max-w-md rounded-lg border border-line bg-surface p-0 shadow-sheet backdrop:bg-ink/30"
    >
      <form onSubmit={submit} className="p-6">
        <h2 id="image-dialog-title" className="text-lg font-medium text-ink">
          Insert image
        </h2>

        {canUpload && (
          <div
            onDragOver={(event) => {
              event.preventDefault()
              setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(event) => {
              event.preventDefault()
              setOver(false)
              take(event.dataTransfer.files[0])
            }}
            className={cn(
              'mt-4 grid place-items-center rounded border border-dashed px-4 py-6 text-center',
              over ? 'border-accent bg-accent/5' : 'border-line',
            )}
          >
            <Upload size={18} className="mb-2 text-ink-faint" />
            <p className="text-sm text-ink-muted">
              Drop an image here, or{' '}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="font-medium text-accent underline underline-offset-2 disabled:opacity-60"
              >
                choose a file
              </button>
              .
            </p>
            <p className="mt-1 text-xs text-ink-faint">
              You can also paste one straight into the note.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
              className="sr-only"
              aria-label="Image file"
              onChange={(event) => {
                take(event.target.files?.[0])
                // Cleared so choosing the same file twice fires again.
                event.target.value = ''
              }}
            />
          </div>
        )}

        {uploading && (
          <p role="status" className="mt-2 text-sm text-ink-muted">
            Uploading…
          </p>
        )}
        {uploadError && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {uploadError}
          </p>
        )}

        <div className={canUpload ? 'mt-5' : 'mt-4'}>
          {canUpload && (
            <p className="mb-2 text-xs uppercase tracking-wide text-ink-faint">
              Or by address
            </p>
          )}
          <Input
            ref={inputRef}
            label="Image address"
            placeholder="example.com/diagram.png"
            value={value}
            error={error ?? undefined}
            onChange={(event) => {
              setValue(event.target.value)
              setError(null)
            }}
          />
        </div>

        <div className="mt-4">
          <Input
            label="Description (alt text)"
            placeholder="What the image shows"
            value={alt}
            onChange={(event) => setAlt(event.target.value)}
          />
          <p className="mt-1 text-xs text-ink-subtle">
            Read aloud in place of the image. Leave empty if it is decorative.
          </p>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">
            Insert
          </Button>
        </div>
      </form>
    </dialog>
  )
}
