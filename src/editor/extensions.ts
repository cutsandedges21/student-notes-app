import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Placeholder from '@tiptap/extension-placeholder'
import TextAlign from '@tiptap/extension-text-align'
import Highlight from '@tiptap/extension-highlight'
import Image from '@tiptap/extension-image'
import {
  TextStyle,
  Color,
  FontFamily,
  FontSize,
  LineHeight,
} from '@tiptap/extension-text-style'
import { Indent } from './indent'

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
  Highlight.configure({ multicolor: true }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Image.configure({ inline: false, HTMLAttributes: { class: 'doc-image' } }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Placeholder.configure({ placeholder: 'Start typing your notes…' }),
]
