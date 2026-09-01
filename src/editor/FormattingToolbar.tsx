import { useEditorState, type Editor } from '@tiptap/react'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  Bold, Italic, Underline, List, ListOrdered, ListChecks,
  Strikethrough, Link2, Image as ImageIcon, RemoveFormatting,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  Printer, Minus, Plus, SpellCheck, PaintRoller, Search, Undo2, Redo2,
  MessageSquarePlus, ListIndentIncrease, ListIndentDecrease,
  ChevronUp, ChevronDown, Table as TableIcon,
} from 'lucide-react'
import { cn } from '../lib/cn'
import { ToolbarDropdown, DropdownItem } from './ToolbarDropdown'
import { TableGridPicker, type TableSize } from './TableGridPicker'
import { ColorPicker } from './ColorPicker'
import { FONT_GROUPS, findFontLabel } from './fonts'
import { HighlightColorIcon, LineSpacingIcon, TextColorIcon } from './DocsIcons'

interface FormattingToolbarProps {
  editor: Editor | null
  /** 1 = 100%. Owned by DocumentEditor, which scales the page with it. */
  zoom?: number
  onZoomChange?: (zoom: number) => void
  /** True while the title and menu rows are hidden by the collapse chevron. */
  compact?: boolean
  onToggleCompact?: () => void
  /** Shared with the File menu and Ctrl+P; window.print() prints the app. */
  onPrint?: () => void
  /**
   * Starts a comment on the current selection.
   *
   * Omitted where commenting is not possible at all -- a shared note opened by
   * a signed-out visitor -- in which case the button is not rendered rather
   * than rendered dead.
   */
  onAddComment?: () => void
  /** False with nothing selected: there would be nothing to anchor to. */
  canAddComment?: boolean
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
  icon?: typeof Bold
  children?: React.ReactNode
  active?: boolean
  disabled?: boolean
  /** Renders the disabled look without the disabled behaviour's dimming. */
  unavailable?: boolean
  className?: string
  onClick?: () => void
}

function ToolButton({
  label,
  icon: Icon,
  children,
  active,
  disabled,
  unavailable,
  className,
  onClick,
}: ToolButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      aria-disabled={unavailable || undefined}
      disabled={disabled}
      onClick={unavailable ? undefined : onClick}
      className={cn(
        'grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-40',
        unavailable && 'cursor-default',
        // Grey rather than Docs' light blue: an explicitly requested, and
        // frankly clearer, "this mark is currently applied" signal.
        active
          ? 'bg-docs-pressed text-docs-text'
          : 'text-docs-icon hover:bg-docs-hover',
        className,
      )}
    >
      {Icon ? <Icon size={17} strokeWidth={1.8} /> : children}
    </button>
  )
}

function Divider() {
  return <div className="mx-1 h-5 w-px shrink-0 bg-docs-divider" />
}

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

const ZOOM_LEVELS = [0.5, 0.75, 0.9, 1, 1.25, 1.5, 2]

const MIN_FONT_SIZE = 8
const MAX_FONT_SIZE = 96

/** What the paint-format tool holds between its two clicks. */
interface CopiedFormat {
  fontFamily?: string
  fontSize?: string
  color?: string
  highlight?: string
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
}

export function FormattingToolbar({
  editor,
  zoom = 1,
  onZoomChange,
  compact = false,
  onToggleCompact,
  onPrint,
  onAddComment,
  canAddComment = false,
}: FormattingToolbarProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const handleKeyDown = useRovingToolbar(containerRef)

  const [copiedFormat, setCopiedFormat] = useState<CopiedFormat | null>(null)
  const [spellcheck, setSpellcheck] = useState(true)

  // The browser's own spell checker is what the A-with-a-tick button drives;
  // the attribute lives on the contenteditable node, not in editor state.
  useEffect(() => {
    editor?.view.dom.setAttribute('spellcheck', String(spellcheck))
  }, [editor, spellcheck])

  /**
   * Every readout and active state the toolbar shows, derived in one
   * subscription.
   *
   * Tiptap 3's `useEditor` deliberately does NOT re-render React on each
   * transaction. Reading `editor.isActive(...)` straight out of render there-
   * fore produces stale values: the toolbar only refreshed when something else
   * happened to re-render the page, so moving the caret left the font, size and
   * colour readouts showing whatever they said last. `useEditorState`
   * subscribes properly and re-renders only when this selection result changes.
   */
  const state = useEditorState({
    editor,
    selector: ({ editor: instance }) => {
      if (!instance) return null

      const textStyle = instance.getAttributes('textStyle')
      return {
        canUndo: instance.can().undo(),
        canRedo: instance.can().redo(),
        headingLevel:
          ([1, 2, 3] as const).find((level) =>
            instance.isActive('heading', { level }),
          ) ?? 0,
        fontStack: textStyle.fontFamily as string | undefined,
        fontSizeRaw: textStyle.fontSize as string | undefined,
        fontSize: parseInt(textStyle.fontSize ?? '11', 10) || 11,
        lineHeight: (textStyle.lineHeight as string | undefined) ?? '1.75',
        color: textStyle.color as string | undefined,
        highlight: instance.getAttributes('highlight').color as string | undefined,
        isBold: instance.isActive('bold'),
        isItalic: instance.isActive('italic'),
        isUnderline: instance.isActive('underline'),
        isStrike: instance.isActive('strike'),
        isLink: instance.isActive('link'),
        isBulletList: instance.isActive('bulletList'),
        isOrderedList: instance.isActive('orderedList'),
        isTaskList: instance.isActive('taskList'),
        inTable: instance.isActive('table'),
        inListItem: instance.isActive('listItem'),
        inTaskItem: instance.isActive('taskItem'),
        alignLeft: instance.isActive({ textAlign: 'left' }),
        alignCenter: instance.isActive({ textAlign: 'center' }),
        alignRight: instance.isActive({ textAlign: 'right' }),
        alignJustify: instance.isActive({ textAlign: 'justify' }),
      }
    },
  })

  if (!editor || !state) return null

  const activeLevel = state.headingLevel
  const currentFontLabel = findFontLabel(state.fontStack)
  const currentSize = state.fontSize

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

  /**
   * Find, walking the document's text nodes.
   *
   * Searching the flattened text would be simpler, but its offsets don't map
   * back onto ProseMirror positions, so the selection would land in the wrong
   * place in any document with more than one block.
   */
  const findInDocument = () => {
    const query = window.prompt('Find in document')?.trim()
    if (!query) return

    const needle = query.toLowerCase()
    const after = editor.state.selection.to
    let first = -1
    let next = -1

    editor.state.doc.descendants((node, pos) => {
      if (!node.isText || !node.text) return
      const haystack = node.text.toLowerCase()

      for (
        let index = haystack.indexOf(needle);
        index !== -1;
        index = haystack.indexOf(needle, index + 1)
      ) {
        const at = pos + index
        if (first === -1) first = at
        // Wraps to the top once the caret is past the last match.
        if (next === -1 && at >= after) next = at
      }
    })

    const hit = next === -1 ? first : next
    if (hit === -1) {
      window.alert(`No matches for "${query}".`)
      return
    }

    editor
      .chain()
      .focus()
      .setTextSelection({ from: hit, to: hit + query.length })
      .scrollIntoView()
      .run()
  }

  /**
   * Paint format is a two-click tool: the first click copies the formatting
   * under the caret, the second applies it to whatever is selected.
   */
  const paintFormat = () => {
    if (copiedFormat) {
      const chain = editor.chain().focus().unsetAllMarks()
      if (copiedFormat.fontFamily) chain.setFontFamily(copiedFormat.fontFamily)
      if (copiedFormat.fontSize) chain.setFontSize(copiedFormat.fontSize)
      if (copiedFormat.color) chain.setColor(copiedFormat.color)
      if (copiedFormat.highlight) chain.setHighlight({ color: copiedFormat.highlight })
      if (copiedFormat.bold) chain.toggleBold()
      if (copiedFormat.italic) chain.toggleItalic()
      if (copiedFormat.underline) chain.toggleUnderline()
      if (copiedFormat.strike) chain.toggleStrike()
      chain.run()
      setCopiedFormat(null)
      return
    }

    setCopiedFormat({
      fontFamily: state.fontStack,
      fontSize: state.fontSizeRaw,
      color: state.color,
      highlight: state.highlight,
      bold: state.isBold,
      italic: state.isItalic,
      underline: state.isUnderline,
      strike: state.isStrike,
    })
  }

  const indentBy = (direction: 1 | -1) => {
    const chain = editor.chain().focus()
    const itemType = state.inTaskItem ? 'taskItem' : state.inListItem ? 'listItem' : null

    if (itemType) {
      if (direction === 1) chain.sinkListItem(itemType)
      else chain.liftListItem(itemType)
    } else if (direction === 1) {
      chain.indent()
    } else {
      chain.outdent()
    }

    chain.run()
  }

  const alignIcon = state.alignCenter
    ? AlignCenter
    : state.alignRight
      ? AlignRight
      : state.alignJustify
        ? AlignJustify
        : AlignLeft

  /** Shared by the three list controls, so their chevrons switch list type. */
  const listOptions = (close: () => void) => (
    <>
      <DropdownItem
        active={state.isBulletList}
        onSelect={() => {
          editor.chain().focus().toggleBulletList().run()
          close()
        }}
      >
        Bulleted list
      </DropdownItem>
      <DropdownItem
        active={state.isOrderedList}
        onSelect={() => {
          editor.chain().focus().toggleOrderedList().run()
          close()
        }}
      >
        Numbered list
      </DropdownItem>
      <DropdownItem
        active={state.isTaskList}
        onSelect={() => {
          editor.chain().focus().toggleTaskList().run()
          close()
        }}
      >
        Checklist
      </DropdownItem>
    </>
  )

  return (
    <div
      ref={containerRef}
      role="toolbar"
      aria-label="Text formatting"
      onKeyDown={handleKeyDown}
      // The left padding matches the docked AI panel, so the centre column
      // lands on the document's centre rather than the window's. Applied from
      // lg up only, which is exactly where the panel is docked.
      className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 relative z-20 bg-surface px-3 pb-1.5 pt-0.5 shadow-[0_6px_6px_-6px_rgba(60,64,67,0.28)] lg:pl-[calc(var(--ai-panel-w)+0.75rem)]"
    >
      {/*
        Document-level actions live in their own pill on the left. The grid's
        two 1fr tracks are equal by definition, so the formatting pill in the
        middle stays on the window's centre however wide these sides become.
      */}
      {/* Negative margin cancels the row's left padding for this cell only:
          the middle column stays centred on the document, while these
          document-level actions keep their place at the screen edge. */}
      <div className="flex min-w-0 items-center justify-start lg:-ml-[calc(var(--ai-panel-w)+0.75rem)] lg:pl-[var(--chrome-gutter)]">
        <div className="flex items-center gap-0.5 rounded-[18px] bg-docs-toolbar px-2 py-1">
          <ToolButton
            label="Undo"
            icon={Undo2}
            disabled={!state.canUndo}
            onClick={() => editor.chain().focus().undo().run()}
          />
          <ToolButton
            label="Redo"
            icon={Redo2}
            disabled={!state.canRedo}
            onClick={() => editor.chain().focus().redo().run()}
          />
          <ToolButton label="Find in document" icon={Search} onClick={findInDocument} />
          <ToolButton label="Print" icon={Printer} onClick={() => onPrint?.()} />
          {/* No pressed state: spell check is on by default, and Docs leaves
              the button plain rather than lighting up on load. */}
          <ToolButton
            label={spellcheck ? 'Turn off spell check' : 'Turn on spell check'}
            icon={SpellCheck}
            onClick={() => setSpellcheck((on) => !on)}
          />
          <ToolButton
            label={copiedFormat ? 'Apply copied formatting' : 'Paint format'}
            icon={PaintRoller}
            active={Boolean(copiedFormat)}
            onClick={paintFormat}
          />

          {/* Wide enough for "100%" plus the chevron; at 66px the label was
              clipped by the trigger's own truncation. */}
          <ToolbarDropdown label="Zoom" width={82} trigger={`${Math.round(zoom * 100)}%`}>
            {(close) =>
              ZOOM_LEVELS.map((level) => (
                <DropdownItem
                  key={level}
                  active={level === zoom}
                  onSelect={() => {
                    onZoomChange?.(level)
                    close()
                  }}
                >
                  {Math.round(level * 100)}%
                </DropdownItem>
              ))
            }
          </ToolbarDropdown>
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-[18px] bg-docs-toolbar px-2 py-1">
        <ToolbarDropdown
          label="Text style"
          width={118}
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
                  fontSize: `${[11, 20, 16, 13][style.level]}pt`,
                  fontWeight: style.level === 0 ? undefined : 500,
                }}
              >
                {style.label}
              </DropdownItem>
            ))
          }
        </ToolbarDropdown>

        <Divider />

        <ToolbarDropdown
          label="Font"
          width={86}
          trigger={
            <span style={{ fontFamily: state.fontStack }}>{currentFontLabel}</span>
          }
        >
          {(close) => (
            <div className="max-h-80 w-56 overflow-y-auto">
              {FONT_GROUPS.map((group) => (
                <div key={group.label}>
                  <div className="px-4 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-ink-faint">
                    {group.label}
                  </div>
                  {group.fonts.map((font) => (
                    <DropdownItem
                      key={font.label}
                      active={currentFontLabel === font.label}
                      // Each name renders in its own typeface, so the menu shows
                      // what the font looks like rather than just naming it.
                      style={{ fontFamily: font.stack, fontSize: '15px' }}
                      onSelect={() => {
                        editor.chain().focus().setFontFamily(font.stack).run()
                        close()
                      }}
                    >
                      {font.label}
                    </DropdownItem>
                  ))}
                </div>
              ))}
            </div>
          )}
        </ToolbarDropdown>

        <Divider />

        <ToolButton
          label="Decrease font size"
          icon={Minus}
          onClick={() => setFontSize(currentSize - 1)}
        />
        <span
          aria-live="polite"
          aria-label={`Font size ${currentSize}`}
          className="grid h-6 w-9 shrink-0 place-items-center rounded border border-docs-outline bg-surface font-ui text-sm text-docs-text"
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
          active={state.isBold}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolButton
          label="Italic"
          icon={Italic}
          active={state.isItalic}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <ToolButton
          label="Underline"
          icon={Underline}
          active={state.isUnderline}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        />
        <ToolButton
          label="Strikethrough"
          icon={Strikethrough}
          active={state.isStrike}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        />

        <ToolbarDropdown
          label="Text colour"
          trigger={<TextColorIcon color={state.color} />}
        >
          {(close) => (
            <ColorPicker
              value={state.color}
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

        <ToolbarDropdown
          label="Highlight colour"
          trigger={<HighlightColorIcon color={state.highlight} />}
        >
          {(close) => (
            <ColorPicker
              value={state.highlight}
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
          active={state.isLink}
          onClick={promptForLink}
        />
        {/* Disabled until there is a selection, because a comment with no
            anchor has nothing to point at. Not rendered at all where commenting
            is impossible -- a dead control that explains itself is still a dead
            control. */}
        {onAddComment && (
          <ToolButton
            label={canAddComment ? 'Add comment' : 'Add comment (select some text first)'}
            icon={MessageSquarePlus}
            onClick={canAddComment ? onAddComment : undefined}
            disabled={!canAddComment}
          />
        )}
        <ToolButton label="Insert image" icon={ImageIcon} onClick={promptForImage} />

        {/*
          One control for both jobs: sweeping the grid inserts a table, and the
          same menu grows the row/column actions once the caret is inside one.
          Splitting insert and edit across two buttons would leave whichever
          one did not apply sitting there disabled most of the time.
        */}
        <ToolbarDropdown
          label={state.inTable ? 'Table' : 'Insert table'}
          trigger={<TableIcon size={17} strokeWidth={1.8} />}
          active={state.inTable}
        >
          {(close) => (
            <>
              <TableGridPicker
                onSelect={(size: TableSize) => {
                  // A header row by default: nearly every table a student
                  // writes labels its columns, and toggling it off afterwards
                  // is one click while adding it back is several.
                  editor
                    .chain()
                    .focus()
                    .insertTable({ rows: size.rows, cols: size.cols, withHeaderRow: true })
                    .run()
                  close()
                }}
              />

              {state.inTable && (
                <>
                  <div className="my-1 h-px bg-docs-divider" />
                  {(
                    [
                      ['Insert row above', () => editor.chain().focus().addRowBefore().run()],
                      ['Insert row below', () => editor.chain().focus().addRowAfter().run()],
                      ['Insert column left', () => editor.chain().focus().addColumnBefore().run()],
                      ['Insert column right', () => editor.chain().focus().addColumnAfter().run()],
                      ['Delete row', () => editor.chain().focus().deleteRow().run()],
                      ['Delete column', () => editor.chain().focus().deleteColumn().run()],
                      ['Toggle header row', () => editor.chain().focus().toggleHeaderRow().run()],
                      ['Merge or split cells', () => editor.chain().focus().mergeOrSplit().run()],
                      ['Delete table', () => editor.chain().focus().deleteTable().run()],
                    ] as const
                  ).map(([label, run]) => (
                    <DropdownItem
                      key={label}
                      onSelect={() => {
                        run()
                        close()
                      }}
                    >
                      {label}
                    </DropdownItem>
                  ))}
                </>
              )}
            </>
          )}
        </ToolbarDropdown>

        <Divider />

        <ToolbarDropdown label="Align" trigger={<AlignIcon icon={alignIcon} />}>
          {(close) => (
            <>
              {(
                [
                  ['Left', 'left', AlignLeft, state.alignLeft],
                  ['Centre', 'center', AlignCenter, state.alignCenter],
                  ['Right', 'right', AlignRight, state.alignRight],
                  ['Justified', 'justify', AlignJustify, state.alignJustify],
                ] as const
              ).map(([label, value, Icon, active]) => (
                <DropdownItem
                  key={value}
                  active={active}
                  onSelect={() => {
                    editor.chain().focus().setTextAlign(value).run()
                    close()
                  }}
                >
                  <span className="flex items-center gap-3">
                    <Icon size={16} /> {label}
                  </span>
                </DropdownItem>
              ))}
            </>
          )}
        </ToolbarDropdown>

        <ToolbarDropdown label="Line spacing" trigger={<LineSpacingIcon size={17} />}>
          {(close) =>
            LINE_HEIGHTS.map((option) => (
              <DropdownItem
                key={option.value}
                active={state.lineHeight === option.value}
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

        <SplitControl
          label="Checklist"
          icon={ListChecks}
          active={state.isTaskList}
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          menu={listOptions}
        />
        <SplitControl
          label="Bulleted list"
          icon={List}
          active={state.isBulletList}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          menu={listOptions}
        />
        <SplitControl
          label="Numbered list"
          icon={ListOrdered}
          active={state.isOrderedList}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          menu={listOptions}
        />

        <ToolButton
          label="Decrease indent"
          icon={ListIndentDecrease}
          onClick={() => indentBy(-1)}
        />
        <ToolButton
          label="Increase indent"
          icon={ListIndentIncrease}
          onClick={() => indentBy(1)}
        />
        <ToolButton
          label="Clear formatting"
          icon={RemoveFormatting}
          onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
        />
      </div>

      {/* The mode switch now floats under the ruler; only the collapse
          chevron remains on the chrome here. */}
      <div className="flex shrink-0 items-center justify-end gap-1">
        <ToolButton
          label={compact ? 'Expand' : 'Collapse'}
          icon={compact ? ChevronDown : ChevronUp}
          onClick={onToggleCompact}
        />
      </div>
    </div>
  )
}

/** Wrapper so an icon component can be passed through as a trigger. */
function AlignIcon({ icon: Icon }: { icon: typeof AlignLeft }) {
  return <Icon size={18} strokeWidth={1.8} />
}

interface SplitControlProps {
  label: string
  icon: typeof List
  active: boolean
  onClick: () => void
  menu: (close: () => void) => React.ReactNode
}

/**
 * The list controls in Docs are split buttons: the icon toggles, the chevron
 * opens the options. Two real buttons sharing one hover group, rather than one
 * button wearing a decorative chevron.
 */
function SplitControl({ label, icon, active, onClick, menu }: SplitControlProps) {
  return (
    <div className="flex shrink-0 items-center">
      <ToolButton
        label={label}
        icon={icon}
        active={active}
        onClick={onClick}
        className="w-[22px]"
      />
      <ToolbarDropdown label={`${label} options`} trigger={null} chevronOnly>
        {menu}
      </ToolbarDropdown>
    </div>
  )
}
