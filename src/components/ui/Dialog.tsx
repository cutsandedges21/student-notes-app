import { useEffect, useRef, type ReactNode } from 'react'

interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

export function Dialog({ open, onClose, title, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (open && !node.open) node.showModal()
    if (!open && node.open) node.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      // Clicking the backdrop (the dialog element itself, outside its child)
      // closes the dialog; clicks inside the panel stop propagation.
      onClick={(event) => {
        if (event.target === ref.current) onClose()
      }}
      aria-label={title}
      className="w-full max-w-md rounded-lg border border-line bg-surface p-0 shadow-sheet backdrop:bg-ink/30"
    >
      <div className="p-6">
        <h2 className="text-lg font-medium text-ink">{title}</h2>
        <div className="mt-4">{children}</div>
      </div>
    </dialog>
  )
}
