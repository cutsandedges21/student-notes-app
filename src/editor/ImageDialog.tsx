import { useEffect, useRef, useState } from 'react'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
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
  onSubmit,
  onClose,
}: {
  open: boolean
  onSubmit: (image: { src: string; alt: string }) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState('')
  const [alt, setAlt] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (open && !node.open) {
      setValue('')
      setAlt('')
      setError(null)
      node.showModal()
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

        <div className="mt-4">
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
