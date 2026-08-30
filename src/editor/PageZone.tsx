import { EditorContent, useEditor, type JSONContent } from '@tiptap/react'
import { useEffect } from 'react'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import Placeholder from '@tiptap/extension-placeholder'
import { TextStyle, Color, FontFamily, FontSize } from '@tiptap/extension-text-style'
import { cn } from '../lib/cn'

export type PageZoneKind = 'header' | 'footer'

/**
 * A page header or footer.
 *
 * Its own Tiptap instance rather than a node inside the body: it is edited in
 * a separate mode, and keeping it out of the body means the main editor's
 * history, selection and autosave never have to know it exists.
 *
 * The extension set is deliberately narrower than the body's -- headers hold a
 * course name or a page label, not checklists and images.
 */
export const zoneExtensions = [
  StarterKit.configure({ heading: false, codeBlock: false, horizontalRule: false }),
  TextStyle,
  Color,
  FontFamily,
  FontSize,
  TextAlign.configure({ types: ['paragraph'] }),
]

interface PageZoneProps {
  kind: PageZoneKind
  content: JSONContent
  /** True while this zone is the active editing target. */
  active: boolean
  /** False for read-only documents; the zone can then never be entered. */
  enabled: boolean
  onActivate: () => void
  onChange: (content: JSONContent) => void
}

export function PageZone({
  kind,
  content,
  active,
  enabled,
  onActivate,
  onChange,
}: PageZoneProps) {
  const label = kind === 'header' ? 'Header' : 'Footer'

  const editor = useEditor({
    extensions: [
      ...zoneExtensions,
      Placeholder.configure({
        placeholder: active ? `Type your ${kind}…` : '',
      }),
    ],
    content,
    editable: active,
    editorProps: {
      attributes: { class: 'outline-none', 'aria-label': `${label} content` },
    },
    onUpdate: ({ editor: instance }) => onChange(instance.getJSON()),
  })

  // Editability follows the active zone. `false` suppresses the update event,
  // so switching modes never looks like an edit and never triggers a save.
  useEffect(() => {
    editor?.setEditable(active, false)
    if (active) editor?.commands.focus('end')
  }, [editor, active])

  const isEmpty = editor?.isEmpty ?? true

  return (
    <div
      // Double-click is what enters the zone, matching Docs and Word. A single
      // click inside the page margin should not steal focus from the body.
      onDoubleClick={() => {
        if (enabled) onActivate()
      }}
      aria-label={`${label} area`}
      className={cn(
        'group relative min-h-[24px] px-1',
        enabled && !active && 'cursor-text',
        // Dimmed until entered, so it reads as page furniture rather than body
        // text -- the same signal Docs uses.
        !active && 'text-ink-faint',
      )}
    >
      {active && (
        <span
          className={cn(
            'pointer-events-none absolute -top-5 left-0 font-ui text-[11px] uppercase tracking-wide text-accent',
            kind === 'footer' && '-bottom-5 top-auto',
          )}
        >
          {label}
        </span>
      )}

      <EditorContent editor={editor} />

      {/* Only hint on hover, and only when there is nothing to show: a
          permanent label would sit on every page of every document. */}
      {!active && isEmpty && enabled && (
        <span className="pointer-events-none absolute inset-0 hidden items-center font-ui text-[11px] uppercase tracking-wide text-ink-faint group-hover:flex">
          Double-click to edit {kind}
        </span>
      )}
    </div>
  )
}
