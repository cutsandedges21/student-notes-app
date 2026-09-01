import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Placeholder from '@tiptap/extension-placeholder'
import TextAlign from '@tiptap/extension-text-align'
import Highlight from '@tiptap/extension-highlight'
import Image from '@tiptap/extension-image'
import { TableKit } from '@tiptap/extension-table'
import {
  TextStyle,
  Color,
  FontFamily,
  FontSize,
  LineHeight,
} from '@tiptap/extension-text-style'
import { Indent } from './indent'
import { PageBreak } from './pagination/PageBreak'
import { AiPreviewExtension } from './aiPreview'
import { CommentHighlight } from './commentHighlight'
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
 * TextStyle is the base mark that Color, FontFamily, FontSize and LineHeight
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
  LineHeight,
  Indent,
  PageBreak,
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
