import { useEffect, useState, type FormEvent } from 'react'
import { Dialog } from './ui/Dialog'
import { Button } from './ui/Button'
import { Input } from './ui/Input'

interface RenameClassDialogProps {
  open: boolean
  currentName: string
  onClose: () => void
  onRename: (name: string) => Promise<void>
}

export function RenameClassDialog({
  open,
  currentName,
  onClose,
  onRename,
}: RenameClassDialogProps) {
  const [name, setName] = useState(currentName)
  const [submitting, setSubmitting] = useState(false)

  // Reset the field whenever the dialog reopens, so a cancelled edit does not
  // linger the next time it is opened.
  useEffect(() => {
    if (open) setName(currentName)
  }, [open, currentName])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return

    setSubmitting(true)
    try {
      await onRename(trimmed)
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Rename class">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="Class name"
          required
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <div className="mt-2 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={submitting}>
            Rename
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
