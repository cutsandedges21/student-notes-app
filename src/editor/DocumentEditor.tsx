import { EditorContent, useEditor, type Editor, type JSONContent } from '@tiptap/react'
import type { AiSelection } from '../ai/AiSidebar'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { editorExtensions } from './extensions'
import { FormattingToolbar } from './FormattingToolbar'
import { PaginatedSheet } from './PaginatedSheet'
import { PageZone, zoneExtensions, type PageZoneKind } from './PageZone'
import { generateHTML } from '@tiptap/core'
import { PaginationController } from './pagination/controller'
import { US_LETTER, type PageGeometry } from './pagination/geometry'
import { Pagination } from './pagination/Pagination'
import { PAGE_BREAK_NAME } from './pagination/PageBreak'
import type { PageNumberPosition } from './pagination/types'
import { Ruler } from './Ruler'
import { ToolbarDropdown, DropdownItem } from './ToolbarDropdown'
import { Pencil } from 'lucide-react'
import { AI_SIDEBAR_SIDE } from '../constants/layout'
import { cn } from '../lib/cn'

const DEFAULT_MARGIN = 96

interface DocumentEditorProps {
  /** Initial content. Changes to this prop reload the editor document. */
  initialContent: JSONContent
  /** Identity of the loaded document; changing it swaps the editor content. */
  documentId: string
  /**
   * Version of the loaded content. Advances when the page re-reads the
   * document after a stale save, which is a content swap without an id change.
   */
  version: number
  onChange: (content: JSONContent) => void
  /** Receives the editor instance so the page can drive the menubar. */
  onReady?: (editor: Editor | null) => void
  /**
   * Reports the current text selection, with viewport coordinates for the
   * floating AI toolbar. Null whenever the selection is empty.
   */
  onSelectionChange?: (
    selection: (AiSelection & { coords: { top: number; left: number } }) | null,
  ) => void
  /** Driven by View > Show ruler. */
  showRuler?: boolean
  /**
   * True while "Hide the menus" has collapsed the title and menu rows. The
   * toolbar owns the chevron that toggles it, but the rows it hides live in
   * EditorPage, so the state is passed through rather than held here.
   */
  compact?: boolean
  onToggleCompact?: () => void
  /**
   * Permanent side panel, rendered beside the page itself.
   *
   * It lives inside this component rather than wrapping it so the toolbar and
   * ruler keep the full window width -- a panel that started above them would
   * shorten the toolbar and push the whole chrome around.
   */
  sidebar?: ReactNode
  /** Page header/footer documents, each edited in its own mode. */
  header?: JSONContent
  footer?: JSONContent
  /** Full screen: nothing but the page, centred. */
  fullScreen?: boolean
  onHeaderChange?: (content: JSONContent) => void
  onFooterChange?: (content: JSONContent) => void
  /** Where the page number sits in the footer band, or `off`. */
  pageNumbers?: PageNumberPosition
  /** False puts the document into read-only view mode. */
  editable?: boolean
  onEditableChange?: (editable: boolean) => void
}

export function DocumentEditor({
  initialContent,
  documentId,
  version,
  onChange,
  onReady,
  onSelectionChange,
  showRuler = true,
  compact = false,
  onToggleCompact,
  sidebar,
  header,
  footer,
  fullScreen = false,
  onHeaderChange,
  onFooterChange,
  pageNumbers = 'off',
  editable = true,
  onEditableChange,
}: DocumentEditorProps) {
  const [margins, setMargins] = useState({ left: DEFAULT_MARGIN, right: DEFAULT_MARGIN })
  const [zoom, setZoom] = useState(1)
  // Which part of the page is being edited. One at a time, as in Docs.
  const [zone, setZone] = useState<PageZoneKind | null>(null)

  /*
   * One controller per editor, since it carries this document's live margins,
   * zoom and page count. It is the only channel between React and the
   * pagination plugin: React writes settings into it, the plugin writes the
   * page count back out, and neither reaches into the other.
   */
  const controller = useMemo(
    () => new PaginationController({ pageBreakName: PAGE_BREAK_NAME }),
    [],
  )

  // Top and bottom margins are fixed at an inch; the ruler owns the sides.
  const geometry = useMemo<PageGeometry>(
    () => ({ ...US_LETTER, marginLeft: margins.left, marginRight: margins.right }),
    [margins.left, margins.right],
  )

  const extensions = useMemo(
    () => [...editorExtensions, Pagination.configure({ controller })],
    [controller],
  )

  const editor = useEditor({
    extensions,
    content: initialContent,
    editorProps: {
      attributes: {
        class: 'outline-none',
        'aria-label': 'Note content',
      },
    },
    onUpdate: ({ editor: instance }) => {
      onChange(instance.getJSON())
    },
    onSelectionUpdate: ({ editor: instance }) => {
      if (!onSelectionChange) return

      const { from, to, empty } = instance.state.selection
      if (empty) {
        onSelectionChange(null)
        return
      }

      const text = instance.state.doc.textBetween(from, to, ' ').trim()
      if (!text) {
        onSelectionChange(null)
        return
      }

      // Coordinates come from ProseMirror rather than window.getSelection so
      // they stay correct inside the scrolled document container.
      const start = instance.view.coordsAtPos(from)
      const end = instance.view.coordsAtPos(to)

      onSelectionChange({
        text,
        from,
        to,
        coords: {
          top: Math.min(start.top, end.top) - 8,
          left: (start.left + end.left) / 2,
        },
      })
    },
  })

  useEffect(() => {
    onReady?.(editor)
  }, [editor, onReady])

  // Owned here rather than in the toolbar, which unmounts in view mode and so
  // could never switch editing back on. The second argument suppresses the
  // update event: without it, mounting would emit one, autosave would fire,
  // and every note would report "Saved" the instant it opened.
  useEffect(() => {
    editor?.setEditable(editable && zone === null, false)
  }, [editor, editable, zone])

  // Leaving edit mode entirely must not strand the page inside a zone.
  useEffect(() => {
    if (!editable) setZone(null)
  }, [editable])

  // Swap content when navigating between documents without remounting the
  // editor. `emitUpdate: false` suppresses an onUpdate, so loading never
  // marks the document dirty and never triggers a spurious save.
  //
  // `version` is in the deps as well as `documentId`: a stale save makes the
  // page re-read the document and adopt newer remote content under the SAME
  // id. Without re-syncing here the editor would keep showing the local text
  // while the page's versionRef advanced, so the next keystroke would save
  // that local text over the newer content with a valid version -- silently
  // destroying the other writer's work.
  useEffect(() => {
    if (!editor) return
    editor.commands.setContent(initialContent, { emitUpdate: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, version, editor])

  const EMPTY_ZONE: JSONContent = { type: 'doc', content: [] }

  /**
   * Draws a header or footer into a page's margin band.
   *
   * Only the first page carries the live editor: one editable element cannot
   * exist in several places, and spinning up an editor per page for what is
   * usually a single line would be waste. Later pages render the same content
   * as static HTML, which is what makes it read as repeating furniture.
   */
  function renderZone(kind: PageZoneKind, pageIndex: number) {
    const content = (kind === 'header' ? header : footer) ?? EMPTY_ZONE

    const zoneBody =
      pageIndex === 0 ? (
        <PageZone
          kind={kind}
          content={content}
          active={zone === kind}
          enabled={editable}
          onActivate={() => setZone(kind)}
          onChange={(next) =>
            kind === 'header' ? onHeaderChange?.(next) : onFooterChange?.(next)
          }
        />
      ) : (
        <div
          aria-hidden="true"
          className="ProseMirror pointer-events-none text-ink-faint"
          dangerouslySetInnerHTML={{ __html: generateHTML(content, zoneExtensions) }}
        />
      )

    if (kind === 'header' || pageNumbers === 'off') return zoneBody

    /*
     * The number gets its own line under the writer's footer text rather than
     * sharing one, so turning numbering on can never shove what they wrote out
     * of the band. Screen only: on paper the running footer is one fixed copy
     * repeated on every sheet, so a number in it would print "1" throughout.
     * The spacers carry the printed number instead.
     */
    return (
      <>
        {zoneBody}
        <div className="doc-page-number" data-align={pageNumbers} aria-hidden="true">
          {pageIndex + 1}
        </div>
      </>
    )
  }

  return (
    <>
      {/* Viewing mode strips the chrome entirely so the page gets the window,
          which is the whole point of switching to it. */}
      {editable && !fullScreen && (
        <FormattingToolbar
          editor={editor}
          zoom={zoom}
          onZoomChange={setZoom}
          compact={compact}
          onToggleCompact={onToggleCompact}
        />
      )}
      <div
        className={cn(
          'flex min-h-0 flex-1',
          AI_SIDEBAR_SIDE === 'right' && 'flex-row-reverse',
        )}
      >
        {sidebar && editable && !fullScreen && (
          <aside
            aria-label="AI assistant"
            className={cn(
              'hidden w-[var(--ai-panel-w)] shrink-0 flex-col bg-surface lg:flex',
              AI_SIDEBAR_SIDE === 'left' ? 'border-r border-line' : 'border-l border-line',
            )}
          >
            {sidebar}
          </aside>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Full column width, so the white band meets the AI panel with no
              gap. The page below keeps its own centring: the scroll container
              reserves its scrollbar gutter on both edges, which puts the sheet
              on the column's true centre -- the same axis this row centres on. */}
          {showRuler && editable && !fullScreen && (
            <div className="hidden bg-surface lg:block">
              <Ruler
                leftMargin={margins.left}
                rightMargin={margins.right}
                onChange={setMargins}
                zoom={zoom}
              />
            </div>
          )}

          {/* `overflow-x` as well as `overflow-y`: the page is a fixed 816px
              wide, so zooming past 100% has to be reachable sideways rather
              than clipped. */}
          <div
            className={cn(
              'doc-scroll flex-1 overflow-auto bg-surface-backdrop [scrollbar-gutter:stable_both-edges] sm:px-4',
              // Centred vertically as well as horizontally in full screen: with
              // no bars above it, a page pinned to the top looks dropped rather
              // than placed.
              fullScreen && 'flex items-start justify-center py-10',
            )}
            // Leaving a zone cannot rely on the body regaining focus: the body
            // is deliberately inert while a zone is active, so clicking it
            // never focuses it and an onFocus handler would never run. A
            // pointer press anywhere outside the furniture exits instead.
            onMouseDown={(event) => {
              if (!zone) return
              if ((event.target as HTMLElement).closest('.doc-furniture')) return
              setZone(null)
            }}
          >
            {/*
              Docked under the ruler rather than in the toolbar. Sticky so it
              stays put while the page scrolls; the wrapper ignores pointer
              events so it never blocks clicks on the document beneath it.
            */}
            <div
              className={cn(
                'pointer-events-none sticky top-[38px] z-20 -mt-2 mb-2 hidden justify-end',
                fullScreen ? 'lg:hidden' : 'lg:flex',
              )}
            >
              <div className="pointer-events-auto rounded-full border border-line bg-surface px-1 py-1 shadow-pill transition-colors hover:bg-docs-chrome-hover">
                <ToolbarDropdown
                  label="Mode"
                  width={104}
                  triggerClassName="hover:bg-transparent"
                  trigger={
                    <span className="flex items-center gap-2">
                      <Pencil size={16} className="text-docs-icon" />
                      {editable ? 'Editing' : 'Viewing'}
                    </span>
                  }
                >
                  {(close) => (
                    <>
                      <DropdownItem
                        active={editable}
                        onSelect={() => {
                          onEditableChange?.(true)
                          close()
                        }}
                      >
                        Editing
                      </DropdownItem>
                      <DropdownItem
                        active={!editable}
                        onSelect={() => {
                          onEditableChange?.(false)
                          close()
                        }}
                      >
                        Viewing
                      </DropdownItem>
                    </>
                  )}
                </ToolbarDropdown>
              </div>
            </div>

            {/* `zoom` rather than a transform: it scales the box itself, so
                the pages keep flowing in the scroll container instead of
                overlapping whatever follows them. */}
            <PaginatedSheet
              controller={controller}
              geometry={geometry}
              zoom={zoom}
              pageNumbers={pageNumbers}
              renderHeader={(page) => renderZone('header', page)}
              renderFooter={(page) => renderZone('footer', page)}
            >
              <EditorContent editor={editor} />
            </PaginatedSheet>
          </div>
        </div>
      </div>
    </>
  )
}
