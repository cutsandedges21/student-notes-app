import { describe, it, expect, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { editorExtensions } from './extensions'
import { useDocumentDialogs } from './useDocumentDialogs'

/**
 * The dialogs the menubar and the toolbar share.
 *
 * The bug these are written against is not hypothetical: both surfaces had
 * their own link prompt, and they disagreed. The toolbar treated an empty
 * string as "remove the link" and the menubar treated it as "do nothing", so
 * the same gesture in two places did two things. One opener is the fix, and
 * these pin its behaviour.
 */

let editor: Editor

function setup(content = '<p>Hello world</p>') {
  editor = new Editor({ extensions: editorExtensions, content })
  return renderHook(() => useDocumentDialogs(editor))
}

afterEach(() => editor?.destroy())

describe('useDocumentDialogs', () => {
  it('opens one dialog at a time', () => {
    const { result } = setup()

    act(() => result.current.openImage())
    expect(result.current.open).toBe('image')

    act(() => result.current.openLink())
    expect(result.current.open).toBe('link')
  })

  it('closes', () => {
    const { result } = setup()
    act(() => result.current.openImage())
    act(() => result.current.close())
    expect(result.current.open).toBeNull()
  })

  it('toggles find, so the same control closes what it opened', () => {
    const { result } = setup()

    act(() => result.current.toggleFind())
    expect(result.current.open).toBe('find')

    act(() => result.current.toggleFind())
    expect(result.current.open).toBeNull()
  })

  describe('links', () => {
    it('opens empty when there is no link under the caret', () => {
      const { result } = setup()
      act(() => result.current.openLink())
      expect(result.current.linkHref).toBe('')
    })

    it('seeds the existing href, so the dialog opens in edit mode', () => {
      const { result } = setup('<p><a href="https://example.com/a">linked</a></p>')

      act(() => {
        editor.commands.setTextSelection(3)
        result.current.openLink()
      })

      expect(result.current.linkHref).toBe('https://example.com/a')
    })

    it('applies a link to the whole mark, not just the caret', () => {
      const { result } = setup('<p><a href="https://example.com/a">linked</a></p>')

      act(() => {
        editor.commands.setTextSelection(3)
        result.current.submitLink('https://example.com/b')
      })

      expect(editor.getHTML()).toContain('https://example.com/b')
      expect(editor.getHTML()).not.toContain('https://example.com/a')
      expect(result.current.open).toBeNull()
    })

    it('removes a link', () => {
      const { result } = setup('<p><a href="https://example.com/a">linked</a></p>')

      act(() => {
        editor.commands.setTextSelection(3)
        result.current.removeLink()
      })

      expect(editor.getHTML()).not.toContain('<a ')
      expect(editor.state.doc.textContent).toBe('linked')
    })
  })

  describe('images', () => {
    it('inserts with its description', () => {
      const { result } = setup()

      act(() =>
        result.current.insertImage({ src: 'https://example.com/a.png', alt: 'A cell' }),
      )

      expect(editor.getHTML()).toContain('src="https://example.com/a.png"')
      expect(editor.getHTML()).toContain('alt="A cell"')
    })

    /**
     * `alt=""` marks an image decorative and a screen reader skips it. A
     * missing alt leaves it to guess, and it usually reads the file name.
     */
    it('keeps an empty description rather than dropping the attribute', () => {
      const { result } = setup()

      act(() => result.current.insertImage({ src: 'https://example.com/a.png', alt: '' }))

      expect(editor.getHTML()).toContain('alt=""')
    })
  })

  describe('equations', () => {
    /** Selects the first node of the given type, as clicking it would. */
    function selectNode(type: string) {
      let at = -1
      editor.state.doc.descendants((node, pos) => {
        if (at === -1 && node.type.name === type) at = pos
      })
      editor.commands.setNodeSelection(at)
    }

    function latexOf(type: string): string | undefined {
      let found: string | undefined
      editor.state.doc.descendants((node) => {
        if (node.type.name === type && found === undefined) {
          found = node.attrs.latex as string
        }
      })
      return found
    }

    it('opens empty when the selection is not an equation', () => {
      const { result } = setup()
      act(() => result.current.openEquation())
      expect(result.current.equationTarget).toBeNull()
    })

    it('inserts an inline equation', () => {
      const { result } = setup()
      act(() => result.current.submitEquation({ latex: 'a^2', display: false }))
      expect(latexOf('inlineMath')).toBe('a^2')
    })

    it('inserts a block equation when set on its own line', () => {
      const { result } = setup()
      act(() => result.current.submitEquation({ latex: '\\int x', display: true }))
      expect(latexOf('blockMath')).toBe('\\int x')
    })

    /**
     * Without this a typo in a derivation can only be fixed by deleting the
     * formula and typing the whole thing again: the node renders as maths as
     * soon as it is valid, so there is no source left on screen to correct.
     */
    it('opens on the selected equation, carrying its source', () => {
      const { result } = setup()
      act(() => result.current.submitEquation({ latex: 'a^2 + b^2', display: false }))

      act(() => {
        selectNode('inlineMath')
        result.current.openEquation()
      })

      expect(result.current.equationTarget).toEqual({ latex: 'a^2 + b^2', display: false })
    })

    it('updates the selected equation in place', () => {
      const { result } = setup()
      act(() => result.current.submitEquation({ latex: 'a^2', display: false }))

      act(() => {
        selectNode('inlineMath')
        result.current.openEquation()
      })
      act(() => result.current.submitEquation({ latex: 'c^2', display: false }))

      expect(latexOf('inlineMath')).toBe('c^2')
      // Updated, not duplicated.
      let count = 0
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'inlineMath') count += 1
      })
      expect(count).toBe(1)
    })

    /** Inline and block are different node types, so this is a replacement. */
    it('converts an inline equation to a block one', () => {
      const { result } = setup()
      act(() => result.current.submitEquation({ latex: 'a^2', display: false }))

      act(() => {
        selectNode('inlineMath')
        result.current.openEquation()
      })
      act(() => result.current.submitEquation({ latex: 'a^2', display: true }))

      expect(latexOf('blockMath')).toBe('a^2')
      expect(latexOf('inlineMath')).toBeUndefined()
    })
  })

  describe('word count', () => {
    it('counts the document', () => {
      const { result } = setup('<p>one two three</p>')

      act(() => result.current.openWordCount())

      expect(result.current.open).toBe('wordCount')
      expect(result.current.documentCounts.words).toBe(3)
    })

    it('reports no selection count when nothing is selected', () => {
      const { result } = setup('<p>one two three</p>')
      act(() => result.current.openWordCount())
      expect(result.current.selectionCounts).toBeNull()
    })

    it('counts the selection separately when there is one', () => {
      const { result } = setup('<p>one two three</p>')

      act(() => {
        editor.commands.setTextSelection({ from: 1, to: 8 })
        result.current.openWordCount()
      })

      expect(result.current.selectionCounts?.words).toBe(2)
      expect(result.current.documentCounts.words).toBe(3)
    })
  })
})
