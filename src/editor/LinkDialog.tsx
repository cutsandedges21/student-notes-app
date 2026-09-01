import { useEffect, useRef, useState } from 'react'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { normaliseLinkHref } from './linkHref'

/**
 * Insert or edit a link.
 *
 * Replaces `window.prompt`, which could not show the selected text, could not
 * offer "remove link" as anything other than "submit an empty string and hope
 * you guessed the convention", and could not tell the writer that what they
 * pasted was not a URL until after it had been applied.
 *
 * It also normalises what people actually paste. Typing `example.com` into the
 * old prompt produced a relative link that navigated inside the app; here it
 * becomes `https://example.com`, which is what was meant.
 */

export function LinkDialog({
  open,
  /** The href already on the selection, when editing rather than inserting. */
  initialHref = '',
  onSubmit,
  onRemove,
  onClose,
}: {
  open: boolean
  initialHref?: string
  onSubmit: (href: string) => void
  onRemove: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(initialHref)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (open && !node.open) {
      setValue(initialHref)
      setError(null)
      node.showModal()
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    if (!open && node.open) node.close()
  }, [open, initialHref])

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const result = normaliseLinkHref(value)
    if ('error' in result) {
      setError(result.error)
      return
    }
    onSubmit(result.href)
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose()
      }}
      aria-labelledby="link-dialog-title"
      className="w-full max-w-md rounded-lg border border-line bg-surface p-0 shadow-sheet backdrop:bg-ink/30"
    >
      <form onSubmit={submit} className="p-6">
        <h2 id="link-dialog-title" className="text-lg font-medium text-ink">
          {initialHref ? 'Edit link' : 'Insert link'}
        </h2>

        <div className="mt-4">
          <Input
            ref={inputRef}
            label="Web address"
            placeholder="example.com"
            value={value}
            error={error ?? undefined}
            onChange={(event) => {
              setValue(event.target.value)
              setError(null)
            }}
          />
        </div>

        <div className="mt-6 flex justify-end gap-2">
          {initialHref && (
            <Button onClick={onRemove} className="mr-auto">
              Remove link
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">
            {initialHref ? 'Update' : 'Insert'}
          </Button>
        </div>
      </form>
    </dialog>
  )
}
