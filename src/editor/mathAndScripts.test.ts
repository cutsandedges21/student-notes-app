import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import type { JSONContent } from '@tiptap/core'
import { editorExtensions } from './extensions'
import { extractPlainText } from '../lib/tiptap'

/**
 * Superscript, subscript and equations.
 *
 * The failure these guard against is not "the button doesn't work" -- it is
 * silent deletion. `extensions.ts` registers this schema for every editor in
 * the app, including the read-only shared view, because ProseMirror drops
 * nodes it has no schema for while parsing and reports nothing. A note
 * containing H₂O and a formula, opened through a share link by an editor that
 * did not know those types, would come back as "H2O" and an empty gap, and the
 * next save would write the loss back to the database.
 *
 * So the round-trip tests here matter more than the command tests. They open a
 * second editor on the first one's serialised HTML -- which is exactly what
 * the shared view does -- and assert the content is still there.
 */

const editors: Editor[] = []

/** An editor built from the app's real extension set, torn down after the test. */
function makeEditor(content = '<p></p>'): Editor {
  const editor = new Editor({ extensions: editorExtensions, content })
  editors.push(editor)
  return editor
}

/** Reopens serialised HTML the way the read-only shared view does. */
function reopen(editor: Editor): Editor {
  return makeEditor(editor.getHTML())
}

/** Every node of a given type in the document, as plain JSON. */
function nodesOfType(editor: Editor, type: string): JSONContent[] {
  const found: JSONContent[] = []
  editor.state.doc.descendants((node) => {
    if (node.type.name === type) found.push(node.toJSON() as JSONContent)
  })
  return found
}

afterEach(() => {
  while (editors.length) editors.pop()?.destroy()
})

describe('superscript and subscript', () => {
  it('applies superscript to a selection and toggles it back off', () => {
    const editor = makeEditor('<p>x2</p>')

    editor.chain().setTextSelection({ from: 2, to: 3 }).toggleSuperscript().run()
    expect(editor.isActive('superscript')).toBe(true)
    expect(editor.getHTML()).toContain('<sup>')

    editor.chain().setTextSelection({ from: 2, to: 3 }).toggleSuperscript().run()
    expect(editor.getHTML()).not.toContain('<sup>')
  })

  it('applies subscript to a selection and toggles it back off', () => {
    const editor = makeEditor('<p>H2O</p>')

    editor.chain().setTextSelection({ from: 2, to: 3 }).toggleSubscript().run()
    expect(editor.isActive('subscript')).toBe(true)
    expect(editor.getHTML()).toContain('<sub>')

    editor.chain().setTextSelection({ from: 2, to: 3 }).toggleSubscript().run()
    expect(editor.getHTML()).not.toContain('<sub>')
  })

  it('survives being reopened by another editor, as the shared view does', () => {
    const editor = makeEditor('<p>H<sub>2</sub>O and x<sup>2</sup></p>')

    const reopened = reopen(editor)

    expect(reopened.getHTML()).toContain('<sub>2</sub>')
    expect(reopened.getHTML()).toContain('<sup>2</sup>')
    expect(reopened.state.doc.textContent).toBe('H2O and x2')
  })
})

describe('equations', () => {
  it('stores the LaTeX source rather than rendered markup', () => {
    const editor = makeEditor()
    editor.chain().insertInlineMath({ latex: 'e^{i\\pi} + 1 = 0' }).run()

    const [node] = nodesOfType(editor, 'inlineMath')
    expect(node).toBeDefined()
    expect(node.attrs?.latex).toBe('e^{i\\pi} + 1 = 0')
  })

  it('stores block equations too', () => {
    const editor = makeEditor()
    editor.chain().insertBlockMath({ latex: '\\int_0^1 x^2 dx' }).run()

    const [node] = nodesOfType(editor, 'blockMath')
    expect(node).toBeDefined()
    expect(node.attrs?.latex).toBe('\\int_0^1 x^2 dx')
  })

  /**
   * The state a formula spends most of its life in while being typed. KaTeX
   * throws on malformed input by default, and a throw inside a node view takes
   * the editor down mid-keystroke; `throwOnError: false` is what prevents it.
   */
  it('does not throw on LaTeX that is still being typed', () => {
    const editor = makeEditor()

    expect(() => {
      editor.chain().insertInlineMath({ latex: '\\frac{' }).run()
    }).not.toThrow()

    expect(() => editor.getHTML()).not.toThrow()
    expect(nodesOfType(editor, 'inlineMath')[0]?.attrs?.latex).toBe('\\frac{')
  })

  it('keeps unparseable LaTeX in the document instead of discarding it', () => {
    const editor = makeEditor()
    editor.chain().insertInlineMath({ latex: '\\notacommand{x}' }).run()

    const reopened = reopen(editor)

    expect(nodesOfType(reopened, 'inlineMath')[0]?.attrs?.latex).toBe('\\notacommand{x}')
  })

  it('survives being reopened by another editor, as the shared view does', () => {
    const editor = makeEditor()
    editor.chain().insertInlineMath({ latex: 'a^2 + b^2 = c^2' }).run()
    editor.chain().insertBlockMath({ latex: '\\sum_{n=1}^{\\infty} n' }).run()

    const reopened = reopen(editor)

    expect(nodesOfType(reopened, 'inlineMath')[0]?.attrs?.latex).toBe('a^2 + b^2 = c^2')
    expect(nodesOfType(reopened, 'blockMath')[0]?.attrs?.latex).toBe('\\sum_{n=1}^{\\infty} n')
  })
})

describe('plain-text extraction', () => {
  /**
   * `content_text` is what the AI reads. A formula that flattens to nothing
   * leaves the assistant answering questions about a note with a hole in it,
   * so the LaTeX source is what should survive -- it is the only textual
   * representation the equation has.
   */
  it('does not silently drop equations from the AI-facing text', () => {
    const editor = makeEditor('<p>Euler:</p>')
    editor.chain().insertInlineMath({ latex: 'e^{i\\pi}+1=0' }).run()

    const text = extractPlainText(editor.getJSON())

    expect(text).toContain('Euler:')
    expect(text).toContain('e^{i\\pi}+1=0')
  })

  it('keeps superscript and subscript text', () => {
    const editor = makeEditor('<p>H<sub>2</sub>O</p>')
    expect(extractPlainText(editor.getJSON())).toBe('H2O')
  })
})
