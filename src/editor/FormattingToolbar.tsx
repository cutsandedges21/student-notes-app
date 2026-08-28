import type { Editor } from '@tiptap/react'
import { useCallback, useEffect, useRef, type KeyboardEvent } from 'react'
import {
  Bold, Italic, Underline, Strikethrough, List, ListOrdered, ListChecks,
  Quote, Minus, Undo2, Redo2, Link2, Image as ImageIcon, RemoveFormatting,
  AlignLeft, AlignCenter, AlignRight, AlignJustify, Baseline, Highlighter,
  Printer, Minus as MinusIcon, Plus,
} from 'lucide-react'
import { cn } from '../lib/cn'
import { ToolbarDropdown, DropdownItem } from './ToolbarDropdown'
import { ColorPicker } from './ColorPicker'

interface FormattingToolbarProps {
  editor: Editor | null
}

/**
 * Roving tabindex for the `role="toolbar"` container.
 *
 * The toolbar pattern promises assistive technology one tab stop with arrow
 * keys moving between controls. Buttons are managed here; dropdown triggers
 * participate too, but the text-style `<select>` is excluded because Left and
 * Right natively change a select's value.
 *
 * Tabindex is reapplied on every render because the enabled set changes as you
 * type (undo/redo).
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
        'grid h-7 w-7 shrink-0 place-items-center rounded transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-40',
        active ? 'bg-accent-subtle text-accent' : 'text-ink-muted hover:bg-surface-hover',
      )}
    >
      <Icon size={16} strokeWidth={2} />
    </button>
  )
}

function Divider() {
  return <div className="mx-1 h-5 w-px shrink-0 bg-line" />
}

const FONTS = [
  'Arial',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Verdana',
  'Trebuchet MS',
  'Comic Sans MS',
]

const TEXT_STYLES = [
  { label: 'Normal text', level: 0 },
  { label: 'Heading 1', level: 1 },
  { label: 'Heading 2', level: 2 },
  { label: 'Heading 3', level: 3 },
] as const

const LINE_HEIGHTS = [
  { label: 'Single', value: '1' },
  { label: '1.15', value: '1.15' },
  { label: '1.5', value: '1.5' },
  { label: 'Double', value: '2' },
]

const MIN_FONT_SIZE = 8
const MAX_FONT_SIZE = 96

export function FormattingToolbar({ editor }: FormattingToolbarProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const handleKeyDown = useRovingToolbar(containerRef)

  if (!editor) return null

  const activeLevel =
    ([1, 2, 3] as const).find((level) => editor.isActive('heading', { level })) ?? 0
  const currentFont = editor.getAttributes('textStyle').fontFamily ?? 'Georgia'
  const currentSize = parseInt(editor.getAttributes('textStyle').fontSize ?? '11', 10) || 11
  const currentColor = editor.getAttributes('textStyle').color
  const currentHighlight = editor.getAttributes('highlight').color

  const setFontSize = (size: number) => {
    const clamped = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, size))
    editor.chain().focus().setFontSize(`${clamped}pt`).run()
  }

  const promptForLink = () => {
    const previous = editor.getAttributes('link').href ?? ''
    const url = window.prompt('Link URL', previous)
    if (url === null) return
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }

  const promptForImage = () => {
    const url = window.prompt('Image URL')
    if (!url) return
    editor.chain().focus().setImage({ src: url }).run()
  }

  return (
    <div
      ref={containerRef}
      role="toolbar"
      aria-label="Text formatting"
      onKeyDown={handleKeyDown}
      className="flex items-center gap-0.5 overflow-x-auto border-b border-line bg-surface px-3 py-1.5"
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
      <ToolButton label="Print" icon={Printer} onClick={() => window.print()} />

      <Divider />

      <ToolbarDropdown
        label="Text style"
        width={132}
        trigger={TEXT_STYLES.find((style) => style.level === activeLevel)?.label}
      >
        {(close) =>
          TEXT_STYLES.map((style) => (
            <DropdownItem
              key={style.level}
              active={style.level === activeLevel}
              onSelect={() => {
                if (style.level === 0) editor.chain().focus().setParagraph().run()
                else
                  editor
                    .chain()
                    .focus()
                    .toggleHeading({ level: style.level as 1 | 2 | 3 })
                    .run()
                close()
              }}
              style={{
                fontSize: [0, 20, 16, 13][style.level] ? `${[11, 20, 16, 13][style.level]}pt` : undefined,
                fontWeight: style.level === 0 ? undefined : 500,
              }}
            >
              {style.label}
            </DropdownItem>
          ))
        }
      </ToolbarDropdown>

      <Divider />

      <ToolbarDropdown label="Font" width={128} trigger={currentFont}>
        {(close) =>
          FONTS.map((font) => (
            <DropdownItem
              key={font}
              active={currentFont === font}
              style={{ fontFamily: font }}
              onSelect={() => {
                editor.chain().focus().setFontFamily(font).run()
                close()
              }}
            >
              {font}
            </DropdownItem>
          ))
        }
      </ToolbarDropdown>

      <Divider />

      <ToolButton
        label="Decrease font size"
        icon={MinusIcon}
        onClick={() => setFontSize(currentSize - 1)}
      />
      <span
        aria-live="polite"
        aria-label={`Font size ${currentSize}`}
        className="grid h-7 w-8 shrink-0 place-items-center rounded border border-line-strong text-sm text-ink"
      >
        {currentSize}
      </span>
      <ToolButton
        label="Increase font size"
        icon={Plus}
        onClick={() => setFontSize(currentSize + 1)}
      />

      <Divider />

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

      <ToolbarDropdown label="Text colour" trigger={<Baseline size={16} />}>
        {(close) => (
          <ColorPicker
            value={currentColor}
            clearLabel="Reset to default"
            onSelect={(color) => {
              editor.chain().focus().setColor(color).run()
              close()
            }}
            onClear={() => {
              editor.chain().focus().unsetColor().run()
              close()
            }}
          />
        )}
      </ToolbarDropdown>

      <ToolbarDropdown label="Highlight colour" trigger={<Highlighter size={16} />}>
        {(close) => (
          <ColorPicker
            value={currentHighlight}
            clearLabel="Remove highlight"
            onSelect={(color) => {
              editor.chain().focus().setHighlight({ color }).run()
              close()
            }}
            onClear={() => {
              editor.chain().focus().unsetHighlight().run()
              close()
            }}
          />
        )}
      </ToolbarDropdown>

      <Divider />

      <ToolButton
        label="Insert link"
        icon={Link2}
        active={editor.isActive('link')}
        onClick={promptForLink}
      />
      <ToolButton label="Insert image" icon={ImageIcon} onClick={promptForImage} />

      <Divider />

      <ToolButton
        label="Align left"
        icon={AlignLeft}
        active={editor.isActive({ textAlign: 'left' })}
        onClick={() => editor.chain().focus().setTextAlign('left').run()}
      />
      <ToolButton
        label="Align centre"
        icon={AlignCenter}
        active={editor.isActive({ textAlign: 'center' })}
        onClick={() => editor.chain().focus().setTextAlign('center').run()}
      />
      <ToolButton
        label="Align right"
        icon={AlignRight}
        active={editor.isActive({ textAlign: 'right' })}
        onClick={() => editor.chain().focus().setTextAlign('right').run()}
      />
      <ToolButton
        label="Justify"
        icon={AlignJustify}
        active={editor.isActive({ textAlign: 'justify' })}
        onClick={() => editor.chain().focus().setTextAlign('justify').run()}
      />

      <ToolbarDropdown label="Line spacing" trigger="1.75">
        {(close) =>
          LINE_HEIGHTS.map((option) => (
            <DropdownItem
              key={option.value}
              onSelect={() => {
                editor.chain().focus().setLineHeight(option.value).run()
                close()
              }}
            >
              {option.label}
            </DropdownItem>
          ))
        }
      </ToolbarDropdown>

      <Divider />

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

      <Divider />

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
      <ToolButton
        label="Clear formatting"
        icon={RemoveFormatting}
        onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
      />
    </div>
  )
}
