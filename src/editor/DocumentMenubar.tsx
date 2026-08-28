import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Editor } from '@tiptap/react'
import { cn } from '../lib/cn'

/**
 * The Google Docs-style menu row.
 *
 * Every item here performs a real action. Menus that merely look the part are
 * worse than no menus: they advertise capability the app doesn't have, and a
 * student who clicks "Insert > Table" and gets nothing learns to distrust the
 * whole bar.
 */

interface MenuAction {
  label: string
  shortcut?: string
  onSelect: () => void
  disabled?: boolean
  separatorBefore?: boolean
}

interface MenuProps {
  label: string
  items: MenuAction[]
  openMenu: string | null
  setOpenMenu: (label: string | null) => void
}

function Menu({ label, items, openMenu, setOpenMenu }: MenuProps) {
  const open = openMenu === label

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpenMenu(open ? null : label)}
        // Once one menu is open, hovering the others switches to them —
        // the behaviour every desktop menu bar has.
        onMouseEnter={() => openMenu && setOpenMenu(label)}
        className={cn(
          'rounded px-2 py-0.5 text-sm text-ink transition-colors hover:bg-surface-hover',
          open && 'bg-surface-hover',
        )}
      >
        {label}
      </button>

      {open && (
        <div
          role="menu"
          aria-label={label}
          className="absolute left-0 z-30 mt-1 min-w-[220px] rounded border border-line bg-surface py-1 shadow-sheet"
        >
          {items.map((item) => (
            <div key={item.label}>
              {item.separatorBefore && <div className="my-1 h-px bg-line" />}
              <button
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpenMenu(null)
                  item.onSelect()
                }}
                className={cn(
                  'flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-sm',
                  'text-ink transition-colors hover:bg-surface-hover',
                  'disabled:cursor-not-allowed disabled:text-ink-faint disabled:hover:bg-transparent',
                )}
              >
                <span>{item.label}</span>
                {item.shortcut && (
                  <span className="text-xs text-ink-faint">{item.shortcut}</span>
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface DocumentMenubarProps {
  editor: Editor | null
  onNewNote: () => void
  onRename: () => void
  onDelete: () => void
  children?: ReactNode
}

export function DocumentMenubar({
  editor,
  onNewNote,
  onRename,
  onDelete,
}: DocumentMenubarProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!openMenu) return

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpenMenu(null)
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpenMenu(null)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [openMenu])

  if (!editor) return null

  const chain = () => editor.chain().focus()

  const promptForLink = () => {
    const url = window.prompt('Link URL', editor.getAttributes('link').href ?? '')
    if (!url) return
    chain().extendMarkRange('link').setLink({ href: url }).run()
  }

  const promptForImage = () => {
    const url = window.prompt('Image URL')
    if (url) chain().setImage({ src: url }).run()
  }

  const menus: { label: string; items: MenuAction[] }[] = [
    {
      label: 'File',
      items: [
        { label: 'New note', onSelect: onNewNote },
        { label: 'Rename', onSelect: onRename },
        { label: 'Print', shortcut: 'Ctrl+P', onSelect: () => window.print(), separatorBefore: true },
        { label: 'Delete note', onSelect: onDelete, separatorBefore: true },
      ],
    },
    {
      label: 'Edit',
      items: [
        {
          label: 'Undo',
          shortcut: 'Ctrl+Z',
          disabled: !editor.can().undo(),
          onSelect: () => chain().undo().run(),
        },
        {
          label: 'Redo',
          shortcut: 'Ctrl+Shift+Z',
          disabled: !editor.can().redo(),
          onSelect: () => chain().redo().run(),
        },
        {
          label: 'Select all',
          shortcut: 'Ctrl+A',
          onSelect: () => chain().selectAll().run(),
          separatorBefore: true,
        },
      ],
    },
    {
      label: 'Insert',
      items: [
        { label: 'Link', shortcut: 'Ctrl+K', onSelect: promptForLink },
        { label: 'Image', onSelect: promptForImage },
        {
          label: 'Horizontal divider',
          onSelect: () => chain().setHorizontalRule().run(),
          separatorBefore: true,
        },
        { label: 'Checklist', onSelect: () => chain().toggleTaskList().run() },
        { label: 'Bulleted list', onSelect: () => chain().toggleBulletList().run() },
        { label: 'Numbered list', onSelect: () => chain().toggleOrderedList().run() },
      ],
    },
    {
      label: 'Format',
      items: [
        { label: 'Bold', shortcut: 'Ctrl+B', onSelect: () => chain().toggleBold().run() },
        { label: 'Italic', shortcut: 'Ctrl+I', onSelect: () => chain().toggleItalic().run() },
        {
          label: 'Underline',
          shortcut: 'Ctrl+U',
          onSelect: () => chain().toggleUnderline().run(),
        },
        { label: 'Strikethrough', onSelect: () => chain().toggleStrike().run() },
        {
          label: 'Align left',
          onSelect: () => chain().setTextAlign('left').run(),
          separatorBefore: true,
        },
        { label: 'Align centre', onSelect: () => chain().setTextAlign('center').run() },
        { label: 'Align right', onSelect: () => chain().setTextAlign('right').run() },
        {
          label: 'Clear formatting',
          onSelect: () => chain().unsetAllMarks().clearNodes().run(),
          separatorBefore: true,
        },
      ],
    },
  ]

  return (
    <div ref={containerRef} className="flex items-center gap-0.5">
      {menus.map((menu) => (
        <Menu
          key={menu.label}
          label={menu.label}
          items={menu.items}
          openMenu={openMenu}
          setOpenMenu={setOpenMenu}
        />
      ))}
    </div>
  )
}
