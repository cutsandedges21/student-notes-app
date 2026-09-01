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

  it('separates consecutive list blocks', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Glycolysis' }] }],
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Krebs cycle' }] }],
            },
          ],
        },
        {
          type: 'orderedList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Step one' }] }],
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Step two' }] }],
            },
          ],
        },
      ],
    }
    expect(extractPlainText(doc)).toBe('Glycolysis\nKrebs cycle\nStep one\nStep two')
  })

  // hardBreak (Shift+Enter) is inline for layout purposes -- it doesn't start
  // a new block -- but it still represents a line break the user explicitly
  // typed. Dropping it silently would mash the surrounding words together
  // ("Line oneLine two"), the exact class of bug this file was fixed for
  // above. So it contributes its own newline instead of nothing.
  it('treats hardBreak as an inline line break, not a no-op', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Line one' },
            { type: 'hardBreak' },
            { type: 'text', text: 'Line two' },
          ],
        },
      ],
    }
    expect(extractPlainText(doc)).toBe('Line one\nLine two')
  })

  /*
   * Cells are block nodes, so the generic rule would give each one its own
   * line and the row grouping would be gone. That grouping is the entire
   * meaning of a table -- without it the AI reading the note back cannot tell
   * which value belongs to which column.
   */
  it('keeps a table row on one line, cells separated by pipes', () => {
    const cell = (text: string) => ({
      type: 'tableCell',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    })
    const header = (text: string) => ({
      type: 'tableHeader',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    })

    const doc = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            { type: 'tableRow', content: [header('D'), header('B')] },
            { type: 'tableRow', content: [cell('T'), cell('F')] },
          ],
        },
      ],
    }

    expect(extractPlainText(doc)).toBe('D | B\nT | F')
  })
})
