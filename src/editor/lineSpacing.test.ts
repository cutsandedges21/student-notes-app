import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { editorExtensions } from './extensions'
import { activeLineHeight, DEFAULT_LINE_HEIGHT } from './lineSpacing'

/*
 * Line spacing did nothing.
 *
 * The menu called `setLineHeight` from @tiptap/extension-text-style, which is
 * a mark: it wrapped the selection in `<span style="line-height:2">`. A line
 * box is laid out by its block container, so a span inside a paragraph cannot
 * change the spacing between that paragraph's lines. Every option applied
 * correctly and none of them were visible.
 *
 * These tests assert the attribute lands on the *block*, which is the thing
 * that was wrong -- checking the command "succeeded" would have passed before
 * the fix too.
 */

let editor: Editor | null = null

function makeEditor(content: string) {
  editor = new Editor({ extensions: editorExtensions, content })
  return editor
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('setLineSpacing', () => {
  it('puts the spacing on the paragraph, not on a span', () => {
    const instance = makeEditor('<p>Cellular respiration</p>')
    instance.commands.selectAll()
    instance.commands.setLineSpacing('2')

    expect(instance.getAttributes('paragraph').lineHeight).toBe('2')

    const html = instance.getHTML()
    expect(html).toContain('line-height: 2')
    // The old implementation produced exactly this, and it did nothing.
    expect(html).not.toMatch(/<span[^>]*line-height/)
  })

  it('renders the spacing as a style on the block element', () => {
    const instance = makeEditor('<p>Text</p>')
    instance.commands.selectAll()
    instance.commands.setLineSpacing('1.15')

    expect(instance.getHTML()).toMatch(/<p[^>]*style="[^"]*line-height: 1\.15/)
  })

  it('applies to the whole paragraph even from a partial selection', () => {
    const instance = makeEditor('<p>one two three four five</p>')
    // A few characters in the middle, not the whole block.
    instance.commands.setTextSelection({ from: 5, to: 9 })
    instance.commands.setLineSpacing('2')

    expect(instance.getAttributes('paragraph').lineHeight).toBe('2')
  })

  it('sets spacing on every paragraph the selection touches', () => {
    const instance = makeEditor('<p>first</p><p>second</p><p>third</p>')
    instance.commands.selectAll()
    instance.commands.setLineSpacing('1.5')

    const spacings: unknown[] = []
    instance.state.doc.descendants((node) => {
      if (node.type.name === 'paragraph') spacings.push(node.attrs.lineHeight)
    })

    expect(spacings).toEqual(['1.5', '1.5', '1.5'])
  })

  it('applies to a heading as well as a paragraph', () => {
    const instance = makeEditor('<h1>Title</h1>')
    instance.commands.selectAll()
    instance.commands.setLineSpacing('2')

    expect(instance.getAttributes('heading').lineHeight).toBe('2')
  })

  it('can be changed again without leaving the old value behind', () => {
    const instance = makeEditor('<p>Text</p>')
    instance.commands.selectAll()
    instance.commands.setLineSpacing('2')
    instance.commands.setLineSpacing('1.15')

    expect(instance.getAttributes('paragraph').lineHeight).toBe('1.15')
    expect(instance.getHTML()).not.toContain('line-height: 2')
  })

  it('unsets back to the stylesheet default, writing no attribute', () => {
    const instance = makeEditor('<p>Text</p>')
    instance.commands.selectAll()
    instance.commands.setLineSpacing('2')
    instance.commands.unsetLineSpacing()

    expect(instance.getAttributes('paragraph').lineHeight).toBeNull()
    expect(instance.getHTML()).not.toContain('line-height')
  })

  // Nothing should be written into the document until somebody asks for it.
  it('leaves untouched paragraphs carrying no attribute at all', () => {
    const instance = makeEditor('<p>Untouched</p>')
    expect(instance.getHTML()).not.toContain('line-height')
  })

  it('survives a round trip through HTML', () => {
    const instance = makeEditor('<p style="line-height: 2">Reloaded</p>')
    expect(instance.getAttributes('paragraph').lineHeight).toBe('2')
  })
})

describe('activeLineHeight', () => {
  it('reports the stylesheet default when nothing is set', () => {
    expect(activeLineHeight({})).toBe(DEFAULT_LINE_HEIGHT)
    expect(activeLineHeight({ lineHeight: null })).toBe(DEFAULT_LINE_HEIGHT)
    expect(activeLineHeight({ lineHeight: '' })).toBe(DEFAULT_LINE_HEIGHT)
  })

  it('reports what is set', () => {
    expect(activeLineHeight({ lineHeight: '1.15' })).toBe('1.15')
  })
})
