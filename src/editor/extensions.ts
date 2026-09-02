import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Placeholder from '@tiptap/extension-placeholder'
import TextAlign from '@tiptap/extension-text-align'
import Highlight from '@tiptap/extension-highlight'
import Image from '@tiptap/extension-image'
import { TableKit } from '@tiptap/extension-table'
import Superscript from '@tiptap/extension-superscript'
import Subscript from '@tiptap/extension-subscript'
import { InlineMath, BlockMath } from '@tiptap/extension-mathematics'
import {
  TextStyle,
  Color,
  FontFamily,
  FontSize,
} from '@tiptap/extension-text-style'
import { Indent } from './indent'
import { PageBreak } from './pagination/PageBreak'
import { AiPreviewExtension } from './aiPreview'
import { CommentHighlight } from './commentHighlight'
import { LineSpacing } from './lineSpacing'
import { SearchHighlight } from './searchHighlight'

/**
 * The editor's extension set.
 *
 * StarterKit supplies paragraphs, headings, bold/italic/strike, bullet and
 * ordered lists (with nesting), blockquote, horizontal rule, code, link,
 * underline, and the undo/redo history -- including the Ctrl/Cmd+B/I/Z/Shift+Z
 * shortcuts. In Tiptap 3 link and underline ship inside StarterKit rather than
 * as standalone packages, so they are configured here rather than imported.
 *
 * TextStyle is the base mark that Color, FontFamily and FontSize
 * all attach to -- without it those four silently do nothing.
 *
 * Indent is ours: it backs the toolbar's indent buttons everywhere the list
 * commands don't apply.
 *
 * PageBreak is ours too. It lives here rather than beside the rest of the
 * pagination engine because it is schema: every editor that might open a
 * document containing one has to know the node type, including the read-only
 * shared view, which runs no pagination of its own. The automatic breaks are
 * not here -- those are measured decorations, never part of the document.
 *
 * TableKit is schema for the same reason PageBreak is: table, tableRow,
 * tableHeader and tableCell all have to be known to every editor that might
 * open a note containing one, or the nodes are dropped on parse and the
 * student's table is silently deleted by opening it in the shared view.
 *
 * Resizing is on. The pagination engine treats a table as a container and
 * breaks it between rows, so a table taller than a page continues onto the
 * next one instead of overflowing the sheet.
 *
 * Superscript, Subscript and the two math nodes are schema for the same
 * reason again -- x², H₂O and a quoted formula are ordinary things to find in
 * a student's notes, and an editor that does not know the node drops it on
 * parse. Registering them here is what stops opening a note in the read-only
 * shared view from deleting the chemistry out of it.
 *
 * Math stores LaTeX in the node's `latex` attribute and renders it through
 * KaTeX at view time. The source is the document; the rendering is not. That
 * is deliberate -- storing rendered HTML would put presentation in the
 * document, make the formula uneditable, and hand the AI a blob it cannot
 * reason about.
 *
 * `throwOnError: false` is the important half of the configuration. Someone
 * typing a formula passes through a dozen invalid states before reaching a
 * valid one -- `\frac{` is invalid until the closing brace arrives. KaTeX's
 * default is to throw, which in a node view means the editor crashes while
 * the student is mid-word. With it off, KaTeX renders the malformed source in
 * red and the writer can see what they are fixing.
 */
export const editorExtensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    link: {
      openOnClick: false,
      autolink: true,
      HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
    },
  }),
  TextStyle,
  Color,
  FontFamily,
  FontSize,
  LineSpacing,
  Indent,
  PageBreak,
  Superscript,
  Subscript,
  InlineMath.configure({ katexOptions: { throwOnError: false } }),
  BlockMath.configure({ katexOptions: { throwOnError: false } }),
  Highlight.configure({ multicolor: true }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Image.configure({ inline: false, HTMLAttributes: { class: 'doc-image' } }),
  TableKit.configure({
    table: { resizable: true, HTMLAttributes: { class: 'doc-table' } },
  }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Placeholder.configure({ placeholder: 'Start typing your notes…' }),
  AiPreviewExtension,
  CommentHighlight,
  SearchHighlight,
]
