import type { Editor } from '@tiptap/react'
import { useCallback, useEffect, useRef, type KeyboardEvent } from 'react'
import {
  Bold, Italic, Underline, Strikethrough, List, ListOrdered,
  ListChecks, Quote, Minus, Undo2, Redo2,
} from 'lucide-react'
import { cn } from '../lib/cn'

/**
 * Roving tabindex for the `role="toolbar"` container.
 *
 * The toolbar pattern promises assistive technology one tab stop with arrow
 * keys moving between controls. Buttons are managed here; the text-style
 * `<select>` is deliberately excluded, because Left/Right natively change a
 * select's value and intercepting that would break it. The select keeps its
 * own tab stop instead.
 *
 * Disabled buttons (undo/redo when unavailable) are skipped, and tabindex is
 * reapplied on every render because that disabled set changes as you type.
 */
function useRovingToolbar(containerRef: React.RefObject<HTMLDivElement | null>) {
  const allButtons = useCallback(
    () =>
      Array.from(
        containerRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [],
      ),
    [containerRef],
  )

  const buttons = useCallback(
    () => allButtons().filter((button) => !button.disabled),
    [allButtons],
  )

  useEffect(() => {
    const enabled = buttons()
    const focused = enabled.findIndex((item) => item === document.activeElement)
    const active = enabled[focused === -1 ? 0 : focused]

    // Disabled buttons are set to -1 too. They are already unfocusable, but a
    // <button> defaults to tabIndex 0, so leaving them would make "exactly one
    // tab stop" false as an inspectable property of the DOM.
    allButtons().forEach((item) => {
      item.tabIndex = item === active ? 0 : -1
    })
  })

  return useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const items = buttons()
      const current = items.indexOf(document.activeElement as HTMLButtonElement)
      if (current === -1 || items.length === 0) return

      let next: number
      switch (event.key) {
        case 'ArrowRight':
          next = (current + 1) % items.length
          break
        case 'ArrowLeft':
          next = (current - 1 + items.length) % items.length
          break
        case 'Home':
          next = 0
          break
        case 'End':
          next = items.length - 1
          break
        default:
          return
      }

      event.preventDefault()
      items.forEach((item, index) => {
        item.tabIndex = index === next ? 0 : -1
      })
      items[next].focus()
    },
    [buttons],
  )
}

interface FormattingToolbarProps {
  editor: Editor | null
}

interface ToolButtonProps {
  label: string
  icon: typeof Bold
  active?: boolean
  disabled?: boolean
  onClick: () => void
}

function ToolButton({ label, icon: Icon, active, disabled, onClick }: ToolButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'grid h-8 w-8 place-items-center rounded transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-40',
        active ? 'bg-accent-subtle text-accent' : 'text-ink-muted hover:bg-surface-hover',
      )}
    >
      <Icon size={16} strokeWidth={2} />
    </button>
  )
}

const TEXT_STYLES = [
  { label: 'Normal text', level: 0 },
  { label: 'Heading 1', level: 1 },
  { label: 'Heading 2', level: 2 },
  { label: 'Heading 3', level: 3 },
] as const

export function FormattingToolbar({ editor }: FormattingToolbarProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const handleKeyDown = useRovingToolbar(containerRef)

  if (!editor) return null

  const activeLevel =
    ([1, 2, 3] as const).find((level) => editor.isActive('heading', { level })) ?? 0

  return (
    <div
      ref={containerRef}
      role="toolbar"
      aria-label="Text formatting"
      onKeyDown={handleKeyDown}
      className="flex items-center gap-1 overflow-x-auto border-b border-line bg-surface px-4 py-1.5"
    >
      <ToolButton
        label="Undo"
        icon={Undo2}
        disabled={!editor.can().undo()}
        onClick={() => editor.chain().focus().undo().run()}
      />
      <ToolButton
        label="Redo"
        icon={Redo2}
        disabled={!editor.can().redo()}
        onClick={() => editor.chain().focus().redo().run()}
      />

      <div className="mx-1 h-5 w-px bg-line" />

      <label htmlFor="text-style" className="sr-only">
        Text style
      </label>
      <select
        id="text-style"
        value={activeLevel}
        onChange={(event) => {
          const level = Number(event.target.value)
          if (level === 0) editor.chain().focus().setParagraph().run()
          else
            editor
              .chain()
              .focus()
              .toggleHeading({ level: level as 1 | 2 | 3 })
              .run()
        }}
        className="h-8 rounded border border-line-strong bg-surface px-2 text-sm text-ink"
      >
        {TEXT_STYLES.map((style) => (
          <option key={style.level} value={style.level}>
            {style.label}
          </option>
        ))}
      </select>

      <div className="mx-1 h-5 w-px bg-line" />

      <ToolButton
        label="Bold"
        icon={Bold}
        active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
      />
      <ToolButton
        label="Italic"
        icon={Italic}
        active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      />
      <ToolButton
        label="Underline"
        icon={Underline}
        active={editor.isActive('underline')}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      />
      <ToolButton
        label="Strikethrough"
        icon={Strikethrough}
        active={editor.isActive('strike')}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      />

      <div className="mx-1 h-5 w-px bg-line" />

      <ToolButton
        label="Bulleted list"
        icon={List}
        active={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      />
      <ToolButton
        label="Numbered list"
        icon={ListOrdered}
        active={editor.isActive('orderedList')}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      />
      <ToolButton
        label="Checklist"
        icon={ListChecks}
        active={editor.isActive('taskList')}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
      />

      <div className="mx-1 h-5 w-px bg-line" />

      <ToolButton
        label="Quote"
        icon={Quote}
        active={editor.isActive('blockquote')}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      />
      <ToolButton
        label="Divider"
        icon={Minus}
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      />
    </div>
  )
}
