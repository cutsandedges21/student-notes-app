import { useCallback, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { countText, type Counts } from './wordCount'

/**
 * The document's dialogs, in one place.
 *
 * Link, image, find-and-replace and word count are all reached from two
 * separate surfaces -- the menubar and the formatting toolbar -- which is how
 * the app ended up with two implementations of each: the menubar prompted for
 * a link and so did the toolbar, with different behaviour on an empty string.
 * The openers live here so both surfaces call the same one, and so the state
 * does not accumulate on `EditorPage`, which is already the largest thing in
 * the app.
 *
 * `EditorPage` owns the editor instance and renders both surfaces, so this is
 * the lowest point in the tree that can serve them both.
 */

export type DialogName = 'link' | 'image' | 'find' | 'wordCount' | 'equation'

/** The equation under the caret, when there is one. */
export interface EquationTarget {
  latex: string
  display: boolean
}

/**
 * Reads a selected equation, if the selection is one.
 *
 * Tiptap's math nodes are atoms, so clicking one selects the whole node rather
 * than placing a caret inside it -- which is what makes "select the formula,
 * press the equation button" a workable way to edit one.
 */
function selectedEquation(editor: Editor): EquationTarget | null {
  const node = (editor.state.selection as { node?: { type: { name: string }; attrs: Record<string, unknown> } }).node
  if (!node) return null
  if (node.type.name !== 'inlineMath' && node.type.name !== 'blockMath') return null

  return {
    latex: typeof node.attrs.latex === 'string' ? node.attrs.latex : '',
    display: node.type.name === 'blockMath',
  }
}

export interface DocumentDialogs {
  open: DialogName | null
  /** The href already on the selection, so the link dialog opens in edit mode. */
  linkHref: string
  documentCounts: Counts
  /** Null when nothing is selected -- not the same as a count of zero. */
  selectionCounts: Counts | null
  openLink: () => void
  openImage: () => void
  /** Find is a toggle: the same control closes the panel it opened. */
  toggleFind: () => void
  openWordCount: () => void
  /** Opens on the selected equation when there is one, empty otherwise. */
  openEquation: () => void
  /** Non-null while the equation dialog is editing rather than inserting. */
  equationTarget: EquationTarget | null
  submitEquation: (equation: { latex: string; display: boolean }) => void
  close: () => void
  submitLink: (href: string) => void
  removeLink: () => void
  insertImage: (image: { src: string; alt: string }) => void
}

const EMPTY: Counts = { words: 0, characters: 0, charactersNoSpaces: 0 }

export function useDocumentDialogs(editor: Editor | null): DocumentDialogs {
  const [open, setOpen] = useState<DialogName | null>(null)
  const [linkHref, setLinkHref] = useState('')
  const [equationTarget, setEquationTarget] = useState<EquationTarget | null>(null)

  /*
   * Counts are read when the dialog opens rather than tracked as state. The
   * alternative is recounting the whole document on every keystroke to keep a
   * number current that is on screen for a few seconds a week.
   */
  const [documentCounts, setDocumentCounts] = useState<Counts>(EMPTY)
  const [selectionCounts, setSelectionCounts] = useState<Counts | null>(null)

  const close = useCallback(() => setOpen(null), [])

  const openLink = useCallback(() => {
    if (!editor) return
    setLinkHref((editor.getAttributes('link').href as string | undefined) ?? '')
    setOpen('link')
  }, [editor])

  const openImage = useCallback(() => setOpen('image'), [])

  const toggleFind = useCallback(
    () => setOpen((current) => (current === 'find' ? null : 'find')),
    [],
  )

  const openWordCount = useCallback(() => {
    if (!editor) return
    setDocumentCounts(countText(editor.getText({ blockSeparator: ' ' })))

    const { from, to, empty } = editor.state.selection
    setSelectionCounts(
      empty ? null : countText(editor.state.doc.textBetween(from, to, ' ')),
    )
    setOpen('wordCount')
  }, [editor])

  /*
   * `extendMarkRange` is what makes editing an existing link work without
   * selecting it first: with the caret merely inside the link, the command
   * would otherwise apply to a zero-width range and do nothing visible.
   */
  const submitLink = useCallback(
    (href: string) => {
      editor?.chain().focus().extendMarkRange('link').setLink({ href }).run()
      setOpen(null)
    },
    [editor],
  )

  const removeLink = useCallback(() => {
    editor?.chain().focus().extendMarkRange('link').unsetLink().run()
    setOpen(null)
  }, [editor])

  const openEquation = useCallback(() => {
    if (!editor) return
    setEquationTarget(selectedEquation(editor))
    setOpen('equation')
  }, [editor])

  /*
   * Editing replaces rather than updates in place when the kind changes.
   * `updateInlineMath` cannot turn an inline formula into a block one -- they
   * are different node types -- so a changed "on its own line" deletes the old
   * node and inserts the other, which is also what keeps it one undo step.
   */
  const submitEquation = useCallback(
    ({ latex, display }: { latex: string; display: boolean }) => {
      if (!editor) {
        setOpen(null)
        return
      }

      const chain = editor.chain().focus()
      const editing = equationTarget !== null

      if (editing && equationTarget.display === display) {
        if (display) chain.updateBlockMath({ latex })
        else chain.updateInlineMath({ latex })
      } else {
        if (editing) chain.deleteSelection()
        if (display) chain.insertBlockMath({ latex })
        else chain.insertInlineMath({ latex })
      }

      chain.run()
      setEquationTarget(null)
      setOpen(null)
    },
    [editor, equationTarget],
  )

  const insertImage = useCallback(
    ({ src, alt }: { src: string; alt: string }) => {
      // The empty string is passed through rather than dropped. `alt=""` and a
      // missing alt are different things: the first tells a screen reader the
      // image is decorative and to skip it, the second leaves it to guess,
      // which usually means reading out the file name.
      editor?.chain().focus().setImage({ src, alt }).run()
      setOpen(null)
    },
    [editor],
  )

  return {
    open,
    linkHref,
    documentCounts,
    selectionCounts,
    openLink,
    openImage,
    toggleFind,
    openWordCount,
    openEquation,
    equationTarget,
    submitEquation,
    close,
    submitLink,
    removeLink,
    insertImage,
  }
}
