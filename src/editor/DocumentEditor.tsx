import { EditorContent, useEditor, type JSONContent } from '@tiptap/react'
import { useEffect } from 'react'
import { editorExtensions } from './extensions'
import { FormattingToolbar } from './FormattingToolbar'

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
}

export function DocumentEditor({
  initialContent,
  documentId,
  version,
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
      <FormattingToolbar editor={editor} />
      <div className="flex-1 overflow-y-auto bg-surface-backdrop px-0 py-0 sm:px-4 sm:py-8">
        <div className="mx-auto min-h-full max-w-sheet bg-surface px-6 py-8 sm:min-h-[1056px] sm:px-12 sm:py-14 sm:shadow-sheet lg:px-16">
          <EditorContent editor={editor} />
        </div>
      </div>
    </>
  )
}
