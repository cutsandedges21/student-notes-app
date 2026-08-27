import type { Editor } from '@tiptap/react'
import {
  Bold, Italic, Underline, Strikethrough, List, ListOrdered,
  ListChecks, Quote, Minus, Undo2, Redo2,
} from 'lucide-react'
import { cn } from '../lib/cn'

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
  if (!editor) return null

  const activeLevel =
    ([1, 2, 3] as const).find((level) => editor.isActive('heading', { level })) ?? 0

  return (
    <div
      role="toolbar"
      aria-label="Text formatting"
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
