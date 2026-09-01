import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/react'
import type { PageNumberPosition } from './pagination/types'
import { cn } from '../lib/cn'
import { TableGridPicker } from './TableGridPicker'

/**
 * The menu row: File, Edit, View, Insert, Format, Tools.
 *
 * Every item here performs a real action. Menus that merely look the part are
 * worse than no menus: they advertise capability the app doesn't have, and a
 * student who clicks "Insert > Chart" and gets nothing learns to distrust the
 * whole bar. Docs' Extensions and Help menus are deliberately absent for the
 * same reason -- the AI panel is reachable from its own button and
 * Ctrl+Shift+A, so a menu holding one shortcut to it earned no space.
 */

interface MenuAction {
  label: string
  shortcut?: string
  onSelect: () => void
  /**
   * Renders in place of the row's button.
   *
   * For the one case a label and a click cannot express: choosing a table's
   * size, which is a grid you sweep. This used to insert a fixed 3x3 because
   * "a menu row cannot hold the toolbar's size grid" -- it can, it just needed
   * somewhere to go. `close` dismisses the menu once a size is committed.
   */
  render?: (close: () => void) => ReactNode
  disabled?: boolean
  separatorBefore?: boolean
  /**
   * Starts a titled group above this item. Menus long enough to hold
   * unrelated settings need more than a rule to say where one ends.
   */
  sectionBefore?: string
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
              {(item.separatorBefore || item.sectionBefore) && (
                <div className="my-2 h-px bg-line" />
              )}
              {item.sectionBefore && (
                <div className="px-4 pb-1 pt-1 font-ui text-[11px] uppercase tracking-wide text-ink-faint">
                  {item.sectionBefore}
                </div>
              )}
              {item.render ? (
                <div role="group" aria-label={item.label} className="px-2 py-1">
                  <div className="px-2 pb-1 font-ui text-[11px] uppercase tracking-wide text-ink-faint">
                    {item.label}
                  </div>
                  {item.render(() => setOpenMenu(null))}
                </div>
              ) : (
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
              )}
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
  /** Absent for a note shared with you: only its owner may delete it. */
  onDelete?: () => void
  showRuler: boolean
  onToggleRuler: () => void
  compact: boolean
  onToggleCompact: () => void
  /** Full screen hides every piece of chrome, not just the menus. */
  fullScreen: boolean
  onToggleFullScreen: () => void
  /** Opens the print dialog on a standalone copy of the note. */
  onPrint: () => void
  onExportPdf: () => void
  /** Opens the keyboard shortcut reference. */
  onShowShortcuts: () => void
  /** Where the page number sits in the footer, or `off`. */
  pageNumbers: PageNumberPosition
  onPageNumbersChange: (position: PageNumberPosition) => void
}

export function DocumentMenubar({
  editor,
  onNewNote,
  onRename,
  onDelete,
  showRuler,
  onToggleRuler,
  compact,
  onToggleCompact,
  fullScreen,
  onToggleFullScreen,
  onPrint,
  onExportPdf,
  onShowShortcuts,
  pageNumbers,
  onPageNumbersChange,
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

  /**
   * Two things at once: the app hides its own chrome, and the browser gives up
   * its window furniture. The request can be refused or unavailable, so the
   * app's state is what the layout keys off -- the mode still works without it.
   */
  const toggleFullScreen = () => {
    onToggleFullScreen()

    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined)
    } else {
      void document.documentElement.requestFullscreen().catch(() => undefined)
    }
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
        {
          label: 'Download as PDF',
          onSelect: onExportPdf,
          separatorBefore: true,
        },
        { label: 'Print', shortcut: 'Ctrl+P', onSelect: onPrint },
        // Omitted rather than disabled for a note shared with you: the row
        // would explain a permission nobody asked about.
        ...(onDelete
          ? [{ label: 'Delete note', onSelect: onDelete, separatorBefore: true }]
          : []),
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
          shortcut: 'Esc to exit',
          checked: fullScreen,
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
          label: 'Table',
          // Sweep to size, the same control the toolbar offers. A fixed 3x3
          // used to sit here because a menu row had nowhere to put a grid.
          onSelect: () => undefined,
          render: (close) => (
            <TableGridPicker
              onSelect={({ rows, cols }) => {
                chain().insertTable({ rows, cols, withHeaderRow: true }).run()
                close()
              }}
            />
          ),
        },
        {
          label: 'Page break',
          shortcut: 'Ctrl+Enter',
          onSelect: () => chain().setPageBreak().run(),
          separatorBefore: true,
        },
        { label: 'Horizontal divider', onSelect: () => chain().setHorizontalRule().run() },
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
        {
          label: 'Keyboard shortcuts',
          onSelect: onShowShortcuts,
          separatorBefore: true,
        },
        /*
         * Page numbering. It belongs to the document rather than to the view --
         * it changes what the paper says -- so it is saved with the note and
         * printed, unlike the ticks under View.
         */
        {
          label: 'No page numbers',
          sectionBefore: 'Pagination',
          checked: pageNumbers === 'off',
          onSelect: () => onPageNumbersChange('off'),
        },
        {
          label: 'Page number: left',
          checked: pageNumbers === 'left',
          onSelect: () => onPageNumbersChange('left'),
        },
        {
          label: 'Page number: centre',
          checked: pageNumbers === 'center',
          onSelect: () => onPageNumbersChange('center'),
        },
        {
          label: 'Page number: right',
          checked: pageNumbers === 'right',
          onSelect: () => onPageNumbersChange('right'),
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
