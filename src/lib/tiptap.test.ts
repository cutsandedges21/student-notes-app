import { describe, it, expect } from 'vitest'
import { extractPlainText } from './tiptap'

describe('extractPlainText', () => {
  it('returns an empty string for an empty document', () => {
    expect(extractPlainText({ type: 'doc', content: [] })).toBe('')
  })

  it('separates block-level nodes with newlines', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'First line' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second line' }] },
      ],
    }
    expect(extractPlainText(doc)).toBe('First line\nSecond line')
  })

  it('concatenates inline runs without inserting separators', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Krebs cycle ' },
            { type: 'text', text: 'makes ATP', marks: [{ type: 'bold' }] },
          ],
        },
      ],
    }
    expect(extractPlainText(doc)).toBe('Krebs cycle makes ATP')
  })

  it('includes text nested inside list items', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Glycolysis' }] },
              ],
            },
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Krebs cycle' }] },
              ],
            },
          ],
        },
      ],
    }
    expect(extractPlainText(doc)).toBe('Glycolysis\nKrebs cycle')
  })

  it('ignores nodes with no text content', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
        { type: 'horizontalRule' },
        { type: 'paragraph', content: [{ type: 'text', text: 'After' }] },
      ],
    }
    expect(extractPlainText(doc)).toBe('Before\nAfter')
  })
})
