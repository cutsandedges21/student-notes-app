import { EditorContent, useEditor, type Editor, type JSONContent } from '@tiptap/react'
import type { Extensions } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import type * as Y from 'yjs'
import type { AiSelection } from '../ai/AiSidebar'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { YjsProvider, ProviderUser } from '../collab/YjsProvider'
import { PresenceBar } from '../components/PresenceBar'
import { editorExtensions } from './extensions'
import { renderCollaborationCaret } from './collaborationCaret'
import { FormattingToolbar } from './FormattingToolbar'
import { PaginatedSheet } from './PaginatedSheet'
import { PageZone, zoneExtensions, type PageZoneKind } from './PageZone'
import { generateHTML } from '@tiptap/core'
import { PaginationController } from './pagination/controller'
import {
  DEFAULT_PAGE_SETUP,
  geometryFor,
  type PageGeometry,
  type PageSetup,
} from './pagination/geometry'
import { Pagination } from './pagination/Pagination'
import { PAGE_BREAK_NAME } from './pagination/PageBreak'
import type { PageNumberPosition } from './pagination/types'
import { Ruler } from './Ruler'
import { ToolbarDropdown, DropdownItem } from './ToolbarDropdown'
import { Pencil } from 'lucide-react'
import { AI_SIDEBAR_SIDE } from '../constants/layout'
import { imageFilesFrom } from '../services/imageUpload'
import { cn } from '../lib/cn'

const EMPTY_ZONE: JSONContent = { type: 'doc', content: [] }

/**
 * The static copy of a header or footer drawn on pages 2..n.
 *
 * `dangerouslySetInnerHTML` is deliberate here, and safe for reasons worth
 * writing down, because the content can come from a document somebody else
 * owns and shared:
 *
 * - `generateHTML` builds the fragment with `Node.fromJSON`, which validates
 *   every node and mark against the schema `zoneExtensions` describes and
 *   throws on anything outside it. Nothing in that schema can carry script:
 *   there is no image, no iframe, no raw-HTML node. A hand-edited row cannot
 *   introduce one.
 * - Serialisation runs through the real DOM -- `DOMSerializer` into a detached
 *   document, then `innerHTML` -- so text and attribute values are escaped by
 *   the browser. A crafted colour or font name cannot break out of its
 *   attribute.
 * - The one attacker-controlled URL in the schema is the link mark's `href`
 *   (StarterKit bundles Link). Tiptap protocol-checks it inside the mark's own
 *   `renderHTML` and blanks anything that is not http/https/mailto/tel and
 *   friends, so `javascript:` never reaches the anchor.
 *
 * What it is not safe against is malformed content. `Node.fromJSON` throws, and
 * throwing here happens during React's render, which would take the whole
 * editor route down rather than spoil one line of furniture. Furniture written
 * by a newer client -- or by hand through the API -- can legitimately hold a
 * node this narrower schema does not know, so the throw is caught and the band
 * left empty.
 *
 * Adding a node or mark to `zoneExtensions` that renders a URL or raw markup
 * would invalidate the reasoning above. Re-check it if that list grows.
 */
function zoneHTML(content: JSONContent): string {
  try {
    return generateHTML(content, zoneExtensions)
  } catch (caught) {
    console.error('[DocumentEditor] unrenderable page furniture:', caught)
    return ''
  }
}

/**
 * A live collaborative session, or absent for the single-writer path.
 *
 * Fixed for the lifetime of an instance. The extension set -- and with it the
 * question of who owns the document's content -- is decided when the editor is
 * created, so a caller that turns collaboration on has to remount this
 * component rather than change the prop underneath it. `EditorPage` keys on the
 * session for exactly that reason.
 */
export interface DocumentCollaboration {
  ydoc: Y.Doc
  provider: YjsProvider
  user: ProviderUser
  /** False means the channel dropped; the presence bar says so. */
  connected: boolean
}

/**
 * The same extensions, with StarterKit's undo history removed.
 *
 * Yjs brings its own (`yUndoPlugin`), and it has to be the only one. Two undo
 * stacks over one document do not take turns: ProseMirror's history rolls back
 * steps that Yjs has already merged with somebody else's, so Ctrl+Z stops
 * meaning "undo what I did" and starts meaning "revert to a state neither of us
 * was ever in" -- including, on a bad day, reinstating text a collaborator
 * deleted. Configuring the existing StarterKit instance rather than rebuilding
 * one keeps the rest of its options (headings, links) in a single place.
 */
function collaborativeExtensions(base: Extensions): Extensions {
  return base.map((extension) =>
    extension.name === 'starterKit' ? extension.configure({ undoRedo: false }) : extension,
  )
}

interface DocumentEditorProps {
  /**
   * Initial content, and the content pushed back in when the document changes.
   *
   * Ignored entirely while collaborating: the Yjs document is the source of
   * truth then, and this is a derived copy of it.
   */
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
  /**
   * Reports the page geometry upward. Printing builds its own document and
   * needs the same paper and margins the ruler is currently showing.
   */
  onGeometryChange?: (geometry: PageGeometry) => void
  /** Passed through to the toolbar's print control. */
  onPrint?: () => void
  /** Starts a comment on the selection. Absent where commenting is impossible. */
  onAddComment?: () => void
  /** False with nothing selected: a comment would have nothing to anchor to. */
  canAddComment?: boolean
  /*
   * Passed straight through to the toolbar. The dialogs they open are owned by
   * EditorPage, which also feeds the menubar, so both surfaces open the same
   * one. Omitting any of them hides its button rather than substituting a
   * browser prompt.
   */
  onEditLink?: () => void
  onInsertImage?: () => void
  onFind?: () => void
  onEquation?: () => void
  /** Paper, orientation and margins for this note. */
  pageSetup?: PageSetup
  /**
   * Reports a margin dragged on the ruler.
   *
   * The ruler and the page-setup dialog set the same two numbers, so they
   * cannot each own a copy -- the note would then show whichever was touched
   * last and persist the other. EditorPage owns the setup; this reports into
   * it. It already re-renders on every drag through onGeometryChange, so
   * lifting the state costs nothing it was not already paying.
   */
  onMarginsChange?: (margins: { left: number; right: number }) => void
  /**
   * Images pasted or dropped into the note.
   *
   * Absent while signed out, in which case the default handling stands and a
   * pasted image is ignored the way it always was -- there is no account to
   * file an upload under, and inlining a data URL into a document held in
   * localStorage is a quota failure dressed up as a feature.
   */
  onImageFiles?: (files: File[]) => void
  onHeaderChange?: (content: JSONContent) => void
  onFooterChange?: (content: JSONContent) => void
  /** Where the page number sits in the footer band, or `off`. */
  pageNumbers?: PageNumberPosition
  /** False puts the document into read-only view mode. */
  editable?: boolean
  onEditableChange?: (editable: boolean) => void
  /** Present only when this note is being edited collaboratively. */
  collaboration?: DocumentCollaboration
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
  onGeometryChange,
  onPrint,
  onAddComment,
  canAddComment = false,
  onEditLink,
  onInsertImage,
  onFind,
  onEquation,
  pageSetup = DEFAULT_PAGE_SETUP,
  onMarginsChange,
  onImageFiles,
  onHeaderChange,
  onFooterChange,
  pageNumbers = 'off',
  editable = true,
  onEditableChange,
  collaboration,
}: DocumentEditorProps) {

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

  const geometry = useMemo<PageGeometry>(() => geometryFor(pageSetup), [pageSetup])

  useEffect(() => {
    onGeometryChange?.(geometry)
  }, [geometry, onGeometryChange])

  /*
   * Read once, deliberately.
   *
   * `collaboration` carries live connection state, so the object identity
   * changes whenever the channel comes or goes. The extension set must not:
   * rebuilding it would hand `useEditor` a different array and invite it to
   * swap the schema out from under a live document. Only the two stable
   * members are depended on.
   */
  const ydoc = collaboration?.ydoc ?? null
  const provider = collaboration?.provider ?? null
  const collaborating = ydoc !== null && provider !== null

  const extensions = useMemo(() => {
    const base = [...editorExtensions, Pagination.configure({ controller })]
    if (!ydoc || !provider) return base

    return [
      ...collaborativeExtensions(base),
      Collaboration.configure({ document: ydoc }),
      // The caret extension only ever reads `provider.awareness`, which is a
      // real y-protocols Awareness -- it does not care that this is not a
      // Hocuspocus provider.
      CollaborationCaret.configure({
        provider,
        user: collaboration?.user,
        // Custom renderer so the label carries an initial and is always
        // present -- see collaborationCaret.ts for why.
        render: renderCollaborationCaret,
      }),
    ]
    // `collaboration.user` is read at creation only; a name arriving later is
    // pushed through awareness by the hook rather than by rebuilding the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, ydoc, provider])

  const editor = useEditor({
    extensions,
    /*
     * No initial content while collaborating.
     *
     * The Yjs document already holds the note -- loaded from storage, or seeded
     * from `documents.content` exactly once before this component was ever
     * rendered. Passing content here as well inserts a second copy of every
     * paragraph into the CRDT, where it merges rather than replaces, and the
     * note is corrupted for everyone.
     */
    content: collaborating ? undefined : initialContent,
    editorProps: {
      attributes: {
        class: 'outline-none',
        'aria-label': 'Note content',
      },
      /*
       * Pasting and dropping an image file.
       *
       * This is the path that matters: a student screenshots a lecture slide
       * and presses Ctrl+V. Without it the clipboard's image is dropped
       * silently -- ProseMirror has no handler for an image file and simply
       * ignores it -- and the note looks like it swallowed the paste.
       *
       * Returning false for anything that is not an image file leaves the
       * default handling alone, which is what pastes text, HTML and the
       * editor's own slices.
       */
      handlePaste: (_view, event) => {
        if (!onImageFiles) return false
        const files = imageFilesFrom(event.clipboardData)
        if (files.length === 0) return false
        event.preventDefault()
        onImageFiles(files)
        return true
      },
      handleDrop: (_view, event) => {
        if (!onImageFiles) return false
        const files = imageFilesFrom((event as DragEvent).dataTransfer)
        if (files.length === 0) return false
        event.preventDefault()
        onImageFiles(files)
        return true
      },
    },
    /*
     * While collaborating this is what keeps `documents.content` current, and
     * its meaning changes: the JSON stops being the document and becomes a
     * derived view of the Yjs one. It is still written on every save because
     * printing, search, the AI context layer, "Make a copy" and every
     * non-collaborative reader read that column and nothing else -- but the
     * CRDT is what is being edited, and a disagreement between the two is
     * resolved in the CRDT's favour.
     */
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

  /*
   * The page holds this reference to drive the menubar, so it has to be given
   * up when the editor goes away. Without the cleanup the page keeps a
   * destroyed editor and the menubar reads `editor.view` on a view that no
   * longer exists -- which Tiptap throws on, taking the whole route down. It
   * only showed up once something unmounted the editor while the page stayed
   * put, such as the loading state that now covers the first paint.
   */
  useEffect(() => {
    onReady?.(editor)
    return () => onReady?.(null)
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
  //
  // Never while collaborating. `setContent` replaces the ProseMirror document,
  // and with the Yjs binding attached that replacement is applied to the CRDT
  // as an insertion rather than as a swap -- so the note ends up holding its
  // own text twice, on every screen, permanently. There is nothing to sync
  // anyway: the version counter is not what a collaborative document is
  // reconciled by, and `initialContent` is a snapshot derived from the CRDT
  // this editor is already reading.
  useEffect(() => {
    if (collaborating) return
    if (!editor) return
    editor.commands.setContent(initialContent, { emitUpdate: false })
    // `collaborating` is fixed for the lifetime of the instance; see the note
    // on DocumentCollaboration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, version, editor])

  /*
   * Identity of the furniture currently on the page.
   *
   * `PageZone` owns a Tiptap instance, and Tiptap's `content` option is initial
   * content only -- a live instance never re-reads it. Because this component
   * is deliberately not remounted when navigating between notes (the effect
   * above swaps the body in place instead), an unkeyed zone kept note A's
   * instance alive across the move to note B: B displayed A's header and
   * footer, and the first keystroke inside B's header emitted A's text through
   * `onHeaderChange`, which the page then saved onto B.
   *
   * Remounting on identity change is the fix rather than pushing new content
   * into the surviving instance. A zone holds one short line, so re-creating it
   * costs nothing beside a navigation, and it leaves behind no instance that
   * could be stale -- a stale instance was the bug. Creation takes its content
   * as initial content, which emits no update, so loading still never looks
   * like an edit.
   *
   * `version` joins `documentId` in the key for the same reason it is in the
   * body's content effect: a stale save makes the page re-read the document and
   * adopt newer remote furniture under an unchanged id.
   */
  const furnitureKey = `${documentId}:${version}`

  /*
   * Built once per document rather than once per page. `generateHTML` compiles
   * a fresh ProseMirror schema on every call, so pages 2..n would each pay for
   * one on every render.
   */
  const headerHTML = useMemo(() => zoneHTML(header ?? EMPTY_ZONE), [header])
  const footerHTML = useMemo(() => zoneHTML(footer ?? EMPTY_ZONE), [footer])

  // Loading another document must not leave the writer inside the previous
  // one's furniture: the zone remounts underneath them, and remounting while
  // active would pull focus into a header they never asked to edit.
  useEffect(() => {
    setZone(null)
  }, [documentId, version])

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
          // Tied to the loaded document, so React replaces the instance rather
          // than leaving the previous note's editor showing. See `furnitureKey`.
          key={`${kind}:${furnitureKey}`}
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
          dangerouslySetInnerHTML={{ __html: kind === 'header' ? headerHTML : footerHTML }}
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
    /*
     * Wrapped, not a fragment. The band is a flex row whose direct children
     * are each forced to `width: 100%`, so returning two of them made the
     * footer text and the number share the row at half width apiece. The
     * number was then aligned inside its own right-hand half: `right` landed
     * on the margin by coincidence, `left` on the middle of the page, and
     * `center` three quarters of the way across. One child, stacked, gives all
     * three the full text column to align against.
     */
    return (
      <div className="flex w-full flex-col">
        {zoneBody}
        <div className="doc-page-number" data-align={pageNumbers} aria-hidden="true">
          {pageIndex + 1}
        </div>
      </div>
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
          onPrint={onPrint}
          onAddComment={onAddComment}
          canAddComment={canAddComment}
          onEditLink={onEditLink}
          onInsertImage={onInsertImage}
          onFind={onFind}
          onEquation={onEquation}
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
                leftMargin={pageSetup.margins.left}
                rightMargin={pageSetup.margins.right}
                onChange={onMarginsChange ?? (() => {})}
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
                'pointer-events-none sticky top-[38px] z-20 -mt-2 mb-2 justify-end gap-2',
                fullScreen ? 'lg:hidden' : 'lg:flex',
                // Who else is in the note is not desktop-only information: on a
                // phone the row carries the presence bar even where the mode
                // pill would normally be hidden.
                collaborating ? 'flex' : 'hidden',
              )}
            >
              {collaboration && (
                <div className="pointer-events-auto flex items-center rounded-full border border-line bg-surface px-2 py-1 shadow-pill">
                  <PresenceBar
                    awareness={collaboration.provider.awareness}
                    selfId={collaboration.user.id}
                    connected={collaboration.connected}
                  />
                </div>
              )}

              <div className="pointer-events-auto rounded-full border border-line bg-surface px-1 py-1 shadow-pill transition-colors hover:bg-docs-chrome-hover">
                <ToolbarDropdown
                  label="Mode"
                  // Sized for "Viewing", the longer of the two labels, which
                  // was clipping at the previous width.
                  width={128}
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
