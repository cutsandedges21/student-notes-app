import { EditorContent, useEditor, type JSONContent } from '@tiptap/react'
import { useEffect } from 'react'
import { editorExtensions } from './extensions'
import { FormattingToolbar } from './FormattingToolbar'

interface DocumentEditorProps {
  /** Initial content. Changes to this prop reload the editor document. */
  initialContent: JSONContent
  /** Identity of the loaded document; changing it swaps the editor content. */
  documentId: string
  onChange: (content: JSONContent) => void
}

export function DocumentEditor({
  initialContent,
  documentId,
  onChange,
}: DocumentEditorProps) {
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
  })

  // Swap content when navigating between documents without remounting the
  // editor. `emitUpdate: false` suppresses an onUpdate, so loading never
  // marks the document dirty and never triggers a spurious save.
  useEffect(() => {
    if (!editor) return
    editor.commands.setContent(initialContent, { emitUpdate: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, editor])

  return (
    <>
      <FormattingToolbar editor={editor} />
      <div className="flex-1 overflow-y-auto bg-surface-backdrop px-4 py-8">
        <div className="mx-auto min-h-[1056px] max-w-sheet bg-surface px-12 py-14 shadow-sheet sm:px-16">
          <EditorContent editor={editor} />
        </div>
      </div>
    </>
  )
}
