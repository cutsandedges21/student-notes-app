import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { editorExtensions } from './extensions'

/**
 * Tab used to run the block-indent command, which sets `margin-left` on the
 * whole paragraph. In a note written as continuous prose that is one block
 * wrapping over many lines, so a single Tab shifted the entire passage. These
 * pin the split: Tab at the head of a block indents its first line only, Tab
 * mid-sentence advances to a tab stop, and only an explicit selection still
 * moves whole blocks.
 */

let editor: Editor

function press(key: string, shiftKey = false): boolean {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true })
  return Boolean(
    editor.view.someProp('handleKeyDown', (handler) => handler(editor.view, event)),
  )
}

/** Position of the first character of the nth top-level block. */
function blockStart(index: number): number {
  let pos = 0
  let seen = -1
  editor.state.doc.forEach((_node, offset) => {
    seen += 1
    if (seen === index) pos = offset + 1
  })
  return pos
}

const attrs = (index: number) => editor.state.doc.child(index).attrs
const text = () => editor.state.doc.textContent

beforeEach(() => {
  editor = new Editor({
    extensions: editorExtensions,
    content: '<p>First paragraph</p><p>Second paragraph</p>',
  })
})

afterEach(() => editor.destroy())

describe('Tab', () => {
  it('indents only the first line of the block holding the caret', () => {
    editor.commands.setTextSelection(blockStart(0))

    expect(press('Tab')).toBe(true)

    expect(attrs(0).firstLineIndent).toBe(48)
    // The whole-block indent is what made every wrapped line move.
    expect(attrs(0).indent).toBe(0)
  })

  it('leaves every other block alone', () => {
    editor.commands.setTextSelection(blockStart(0))
    press('Tab')

    expect(attrs(1).firstLineIndent).toBe(0)
    expect(attrs(1).indent).toBe(0)
  })

  it('accumulates by half an inch per press', () => {
    editor.commands.setTextSelection(blockStart(0))
    press('Tab')
    editor.commands.setTextSelection(blockStart(0))
    press('Tab')

    expect(attrs(0).firstLineIndent).toBe(96)
  })

  it('inserts a tab stop rather than moving the block when the caret is mid-line', () => {
    // After "First", i.e. not at the head of the paragraph.
    editor.commands.setTextSelection(blockStart(0) + 5)

    expect(press('Tab')).toBe(true)

    expect(attrs(0).firstLineIndent).toBe(0)
    expect(attrs(0).indent).toBe(0)
    expect(text()).toContain('First\t')
  })

  it('still moves whole blocks when a selection spans them', () => {
    editor.commands.setTextSelection({ from: blockStart(0), to: blockStart(1) + 3 })

    press('Tab')

    expect(attrs(0).indent).toBe(48)
    expect(attrs(1).indent).toBe(48)
    expect(attrs(0).firstLineIndent).toBe(0)
  })

  it('reports the key as handled so focus never leaves the document', () => {
    editor.commands.setTextSelection(blockStart(0))
    expect(press('Tab')).toBe(true)
  })
})

describe('Shift+Tab', () => {
  it('takes the first-line indent back down', () => {
    editor.commands.setTextSelection(blockStart(0))
    press('Tab')
    editor.commands.setTextSelection(blockStart(0))

    press('Tab', true)

    expect(attrs(0).firstLineIndent).toBe(0)
  })

  it('falls through to the block indent once the first line is back to zero', () => {
    // What the toolbar's increase-indent button applies.
    editor.commands.setTextSelection(blockStart(0))
    editor.commands.indent()
    expect(attrs(0).indent).toBe(48)

    editor.commands.setTextSelection(blockStart(0))
    press('Tab', true)

    expect(attrs(0).indent).toBe(0)
  })

  it('never drives an indent below zero', () => {
    editor.commands.setTextSelection(blockStart(0))

    press('Tab', true)

    expect(attrs(0).firstLineIndent).toBe(0)
    expect(attrs(0).indent).toBe(0)
  })
})
