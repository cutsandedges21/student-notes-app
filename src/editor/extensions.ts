import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Placeholder from '@tiptap/extension-placeholder'

/**
 * The editor's extension set.
 *
 * StarterKit (Tiptap 3) supplies paragraphs, headings, bold/italic/strike,
 * bullet and ordered lists (with nesting), blockquote, horizontal rule, code,
 * underline, link, and the undo/redo history — including the Ctrl/Cmd+B/I/Z/
 * Shift+Z shortcuts.
 *
 * Underline and Link are configured here through `StarterKit.configure`
 * rather than imported as standalone `@tiptap/extension-underline` /
 * `@tiptap/extension-link` extensions: in Tiptap 3 both ship bundled inside
 * StarterKit itself, and registering them a second time as separate
 * extensions would create duplicate "underline"/"link" extension names.
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
  TaskList,
  TaskItem.configure({ nested: true }),
  Placeholder.configure({ placeholder: 'Start typing your notes…' }),
]
