import { describe, it, expect } from 'vitest'
import { caretInitial, caretLabel, renderCollaborationCaret } from './collaborationCaret'

describe('caretInitial', () => {
  it('takes the first letter, capitalised', () => {
    expect(caretInitial('ada')).toBe('A')
    expect(caretInitial('Grace Hopper')).toBe('G')
  })

  it('ignores surrounding space', () => {
    expect(caretInitial('  ada  ')).toBe('A')
  })

  // Taking [0] would split a surrogate pair and render a replacement glyph.
  it('handles a name starting outside the basic plane', () => {
    expect(caretInitial('😀 Ada')).toBe('😀')
  })

  it('falls back rather than rendering an empty disc', () => {
    expect(caretInitial('')).toBe('?')
    expect(caretInitial('   ')).toBe('?')
    expect(caretInitial(undefined)).toBe('?')
  })
})

describe('caretLabel', () => {
  it('uses the name when there is one', () => {
    expect(caretLabel('Ada')).toBe('Ada')
  })

  it('names an anonymous collaborator rather than showing a blank tag', () => {
    expect(caretLabel('')).toBe('Someone')
    expect(caretLabel(undefined)).toBe('Someone')
  })
})

describe('renderCollaborationCaret', () => {
  it('builds a caret carrying the label and initial', () => {
    const caret = renderCollaborationCaret({ name: 'Grace', color: '#ff0000' })

    expect(caret.classList.contains('collaboration-carets__caret')).toBe(true)

    const label = caret.querySelector('.collaboration-carets__label')
    expect(label).not.toBeNull()
    expect(label?.textContent).toBe('Grace')
    expect(label?.getAttribute('data-initial')).toBe('G')
  })

  it('paints both the caret and the tag in the collaborator’s colour', () => {
    const caret = renderCollaborationCaret({ name: 'Ada', color: 'rgb(1, 2, 3)' })
    const label = caret.querySelector('.collaboration-carets__label') as HTMLElement

    expect(caret.getAttribute('style')).toContain('rgb(1, 2, 3)')
    expect(label.getAttribute('style')).toContain('rgb(1, 2, 3)')
  })

  /*
   * A display name is chosen by the person it belongs to, so it is another
   * user's input rendered into the document. Inserted as text, never markup.
   */
  it('does not let a display name carry markup into the document', () => {
    const caret = renderCollaborationCaret({ name: '<img src=x onerror=alert(1)>' })
    const label = caret.querySelector('.collaboration-carets__label') as HTMLElement

    expect(label.querySelector('img')).toBeNull()
    expect(label.textContent).toBe('<img src=x onerror=alert(1)>')
  })

  it('still renders for a collaborator with no name or colour', () => {
    const caret = renderCollaborationCaret({})
    const label = caret.querySelector('.collaboration-carets__label') as HTMLElement

    expect(label.textContent).toBe('Someone')
    expect(label.getAttribute('data-initial')).toBe('?')
  })
})
