import { EditorContent, useEditor, type Editor, type JSONContent } from '@tiptap/react'
import type { AiSelection } from '../ai/AiSidebar'
import { useEffect, useState, type ReactNode } from 'react'
import { editorExtensions } from './extensions'
import { FormattingToolbar } from './FormattingToolbar'
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
  editable = true,
  onEditableChange,
}: DocumentEditorProps) {
  const [margins, setMargins] = useState({ left: DEFAULT_MARGIN, right: DEFAULT_MARGIN })
  const [zoom, setZoom] = useState(1)

  const editor = useEditor({
    extensions: editorExtensions,
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
    editor?.setEditable(editable, false)
  }, [editor, editable])

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

  return (
    <>
      {/* Viewing mode strips the chrome entirely so the page gets the window,
          which is the whole point of switching to it. */}
      {editable && (
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
        {sidebar && editable && (
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
          {/* The ruler lives INSIDE the scroll container, pinned to its top.
              Anywhere else it centres on a different width than the page: the
              scroll container reserves a scrollbar, which shifts the centred
              sheet by half the scrollbar and left the two visibly out of
              register. Sharing one centring context makes them agree exactly,
              and sticky keeps the ruler visible while scrolling. */}
          <div className="flex-1 overflow-y-auto bg-surface-backdrop px-0 pb-0 pt-0 [scrollbar-gutter:stable_both-edges] sm:px-4 sm:pb-8">
          {/* `zoom` rather than a transform: it scales the box itself, so the
              page keeps flowing in the scroll container instead of overlapping
              whatever follows it. */}
            {showRuler && editable && (
              <div className="sticky top-0 z-10 -mx-4 mb-8 hidden bg-surface px-4 shadow-pill lg:block">
                <Ruler
                  leftMargin={margins.left}
                  rightMargin={margins.right}
                  onChange={setMargins}
                  zoom={zoom}
                />
              </div>
            )}

            {/*
              Docked under the ruler rather than in the toolbar. Sticky so it
              stays put while the page scrolls; the wrapper ignores pointer
              events so it never blocks clicks on the document beneath it.
            */}
            <div className="pointer-events-none sticky top-[38px] z-20 -mt-2 mb-2 hidden justify-end lg:flex">
              <div className="pointer-events-auto rounded-full border border-line bg-surface px-1 py-1 shadow-pill">
                <ToolbarDropdown
                  label="Mode"
                  width={104}
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

            <div
              style={{ paddingLeft: margins.left, paddingRight: margins.right, zoom }}
              className="mx-auto min-h-full max-w-sheet bg-surface py-8 sm:min-h-[1056px] sm:py-14 sm:shadow-sheet"
            >
              <EditorContent editor={editor} />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
