import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/react'
import { cn } from '../lib/cn'

/**
 * The Google Docs menu row: File, Edit, View, Insert, Format, Tools,
 * Extensions, Help.
 *
 * Every item here performs a real action. Menus that merely look the part are
 * worse than no menus: they advertise capability the app doesn't have, and a
 * student who clicks "Insert > Table" and gets nothing learns to distrust the
 * whole bar. Where Docs offers something we don't have, the slot is filled
 * with our nearest equivalent rather than a dead entry -- Extensions opens the
 * AI panel, Tools counts words.
 */

interface MenuAction {
  label: string
  shortcut?: string
  onSelect: () => void
  disabled?: boolean
  separatorBefore?: boolean
  /** Renders a tick in the left gutter, for the toggles under View. */
  checked?: boolean
}

interface MenuProps {
  label: string
  items: MenuAction[]
  openMenu: string | null
  setOpenMenu: (label: string | null) => void
}

const PANEL_WIDTH = 240
const VIEWPORT_MARGIN = 8

function Menu({ label, items, openMenu, setOpenMenu }: MenuProps) {
  const open = openMenu === label
  const hasChecks = items.some((item) => item.checked !== undefined)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

  /*
   * The panel is portalled with fixed positioning rather than absolutely
   * positioned inside the row. On a narrow screen the menu row has to scroll
   * sideways, and `overflow-x: auto` forces `overflow-y` to compute to `auto`
   * too -- which would clip every menu the moment it opened.
   *
   * Measured before paint so it never appears at the wrong spot first.
   */
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return

    const rect = triggerRef.current.getBoundingClientRect()
    const maxLeft = window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN

    setPosition({
      top: rect.bottom + 4,
      left: Math.max(VIEWPORT_MARGIN, Math.min(rect.left, maxLeft)),
    })
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpenMenu(open ? null : label)}
        // Once one menu is open, hovering the others switches to them —
        // the behaviour every desktop menu bar has.
        onMouseEnter={() => openMenu && setOpenMenu(label)}
        className={cn(
          'shrink-0 rounded px-2 py-[3px] font-ui text-sm leading-5 text-docs-text transition-colors',
          'hover:bg-docs-chrome-hover',
          open && 'bg-docs-chrome-hover',
        )}
      >
        {label}
      </button>

      {open &&
        createPortal(
        <div
          role="menu"
          aria-label={label}
          // Read by the dismissal handler, which cannot use a ref here: the
          // panel is outside the menubar's DOM subtree.
          data-menubar-panel=""
          style={{
            top: position?.top ?? -9999,
            left: position?.left ?? -9999,
            visibility: position ? 'visible' : 'hidden',
          }}
          className="fixed z-40 min-w-[240px] rounded-lg border border-line bg-surface py-2 shadow-menu"
        >
          {items.map((item) => (
            <div key={item.label}>
              {item.separatorBefore && <div className="my-2 h-px bg-line" />}
              <button
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpenMenu(null)
                  item.onSelect()
                }}
                className={cn(
                  'flex w-full items-center justify-between gap-8 py-1.5 pr-4 text-left',
                  'font-ui text-sm text-docs-text transition-colors hover:bg-docs-chrome-hover',
                  'disabled:cursor-not-allowed disabled:text-ink-faint disabled:hover:bg-transparent',
                  hasChecks ? 'pl-2' : 'pl-4',
                )}
              >
                <span className="flex items-center gap-2">
                  {hasChecks && (
                    <span className="w-4 shrink-0 text-center text-docs-active-icon">
                      {item.checked ? '✓' : ''}
                    </span>
                  )}
                  {item.label}
                </span>
                {item.shortcut && (
                  <span className="text-xs text-ink-faint">{item.shortcut}</span>
                )}
              </button>
            </div>
          ))}
        </div>,
          document.body,
        )}
    </>
  )
}

interface DocumentMenubarProps {
  editor: Editor | null
  onNewNote: () => void
  onRename: () => void
  onDelete: () => void
  /** Opens the AI panel, which is what Extensions points at. */
  onOpenAi: () => void
  showRuler: boolean
  onToggleRuler: () => void
  compact: boolean
  onToggleCompact: () => void
}

export function DocumentMenubar({
  editor,
  onNewNote,
  onRename,
  onDelete,
  onOpenAi,
  showRuler,
  onToggleRuler,
  compact,
  onToggleCompact,
}: DocumentMenubarProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!openMenu) return

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Element | null
      if (containerRef.current?.contains(target)) return
      // The open panel is portalled to <body>, so it is not inside the
      // container. Without this the menu would close on mousedown and the
      // item's click would never land -- every menu item would look dead.
      if (target?.closest?.('[data-menubar-panel]')) return
      setOpenMenu(null)
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

  const toggleFullScreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen()
  }

  const showWordCount = () => {
    const text = editor.getText({ blockSeparator: ' ' })
    const words = text.split(/\s+/).filter(Boolean).length
    window.alert(
      [
        `Words: ${words}`,
        `Characters: ${text.length}`,
        `Characters excluding spaces: ${text.replace(/\s/g, '').length}`,
      ].join('\n'),
    )
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
      label: 'View',
      items: [
        { label: 'Show ruler', checked: showRuler, onSelect: onToggleRuler },
        { label: 'Hide the menus', checked: compact, onSelect: onToggleCompact },
        {
          label: 'Full screen',
          checked: Boolean(document.fullscreenElement),
          onSelect: toggleFullScreen,
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
          label: 'Quote',
          onSelect: () => chain().toggleBlockquote().run(),
          separatorBefore: true,
        },
        {
          label: 'Increase indent',
          onSelect: () => chain().indent().run(),
          separatorBefore: true,
        },
        { label: 'Decrease indent', onSelect: () => chain().outdent().run() },
        {
          label: 'Clear formatting',
          onSelect: () => chain().unsetAllMarks().clearNodes().run(),
          separatorBefore: true,
        },
      ],
    },
    {
      label: 'Tools',
      items: [
        { label: 'Word count', onSelect: showWordCount },
        {
          label: 'Spelling and grammar',
          checked: editor.view.dom.getAttribute('spellcheck') !== 'false',
          onSelect: () => {
            const on = editor.view.dom.getAttribute('spellcheck') !== 'false'
            editor.view.dom.setAttribute('spellcheck', String(!on))
          },
        },
      ],
    },
    {
      label: 'Extensions',
      items: [
        { label: 'AI assistant', shortcut: 'Ctrl+Shift+A', onSelect: onOpenAi },
      ],
    },
    {
      label: 'Help',
      items: [
        {
          label: 'Keyboard shortcuts',
          onSelect: () =>
            window.alert(
              [
                'Ctrl+B  Bold',
                'Ctrl+I  Italic',
                'Ctrl+U  Underline',
                'Ctrl+K  Insert link',
                'Ctrl+Z  Undo',
                'Ctrl+Shift+Z  Redo',
                'Ctrl+P  Print',
                'Ctrl+Shift+A  AI assistant',
              ].join('\n'),
            ),
        },
        {
          label: 'About Margin',
          separatorBefore: true,
          onSelect: () =>
            window.alert(
              'Margin — notes for class.\nYour work saves automatically, signed in or not.',
            ),
        },
      ],
    },
  ]

  return (
    <div
      ref={containerRef}
      className="no-scrollbar flex min-w-0 items-center gap-0.5 overflow-x-auto"
    >
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
