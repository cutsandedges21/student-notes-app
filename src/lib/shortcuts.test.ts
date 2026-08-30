import { describe, it, expect } from 'vitest'
import {
  AI_SHORTCUT_KEYS,
  SHORTCUT_GROUPS,
  describeSelectionNeeded,
  matchAiShortcut,
} from './shortcuts'
import { AI_MODE_LABELS } from '../types/ai'

const press = (over: Partial<KeyboardEvent>) =>
  ({ altKey: true, ctrlKey: true, metaKey: false, shiftKey: false, code: '', key: '', ...over }) as KeyboardEvent

describe('matchAiShortcut', () => {
  it.each([
    ['KeyI', 'IMPROVE_NOTES'],
    ['KeyE', 'EXPLAIN'],
    ['KeyC', 'CHECK_NOTES'],
    ['KeyX', 'EXAM_READY'],
    ['KeyS', 'MAKE_CLEARER'],
  ])('maps Ctrl+Alt+%s', (code, mode) => {
    expect(matchAiShortcut(press({ code }))).toBe(mode)
  })

  it('accepts Cmd+Alt on macOS', () => {
    expect(matchAiShortcut(press({ ctrlKey: false, metaKey: true, code: 'KeyI' }))).toBe(
      'IMPROVE_NOTES',
    )
  })

  // Option+E on a Mac reports key '´'; the position is the only reliable signal.
  it('ignores the character Alt produces and uses the physical key', () => {
    expect(matchAiShortcut(press({ code: 'KeyE', key: '´' }))).toBe('EXPLAIN')
  })

  it('falls back to the key when code is unavailable', () => {
    expect(matchAiShortcut(press({ code: '', key: 'c' }))).toBe('CHECK_NOTES')
  })

  it.each([
    ['no Alt', { altKey: false, code: 'KeyI' }],
    ['no Ctrl or Cmd', { ctrlKey: false, code: 'KeyI' }],
    ['Shift held', { shiftKey: true, code: 'KeyI' }],
    ['an unbound key', { code: 'KeyQ' }],
  ])('returns null for %s', (_case, over) => {
    expect(matchAiShortcut(press(over))).toBeNull()
  })
})

describe('describeSelectionNeeded', () => {
  it("asks in the mode's own words and names the key", () => {
    expect(describeSelectionNeeded('MAKE_CLEARER')).toBe(
      'Which part of your notes should I simplify? Highlight it in the document, then run this again (Ctrl+Alt+S).',
    )
  })
})

describe('SHORTCUT_GROUPS', () => {
  // The dialog is only useful if it lists what actually fires, so it is built
  // from the same table the handler matches against.
  it('documents every AI shortcut with its current label', () => {
    const ai = SHORTCUT_GROUPS.find((group) => group.title === 'AI assistant')!
    for (const [mode, keys] of Object.entries(AI_SHORTCUT_KEYS)) {
      const row = ai.items.find((item) => item.keys === keys)
      expect(row, `${keys} missing from the dialog`).toBeDefined()
      expect(row!.description).toBe(AI_MODE_LABELS[mode as keyof typeof AI_MODE_LABELS])
    }
  })

  it('lists the page break', () => {
    const keys = SHORTCUT_GROUPS.flatMap((group) => group.items).map((item) => item.keys)
    expect(keys).toContain('Ctrl+Enter')
  })
})
