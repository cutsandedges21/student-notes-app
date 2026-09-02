import { AI_MODE_LABELS, AI_MODE_VERBS, type AiActionMode } from '../types/ai'

/**
 * The app's keyboard shortcuts, declared once.
 *
 * The dialog that lists them and the handler that fires them read the same
 * table, so a binding cannot be documented without working (or vice versa).
 */

/**
 * Physical keys rather than characters.
 *
 * `event.key` under Alt is layout-dependent -- on a Mac, Option+I produces a
 * dead-key circumflex, and on several European layouts Ctrl+Alt is AltGr and
 * yields a symbol. `event.code` names the key's position, so the binding holds
 * wherever the keycaps happen to say something else.
 */
const AI_SHORTCUT_CODES: Record<string, AiActionMode> = {
  KeyI: 'IMPROVE_NOTES',
  KeyE: 'EXPLAIN',
  KeyC: 'CHECK_NOTES',
  KeyX: 'EXAM_READY',
  KeyS: 'MAKE_CLEARER',
}

/** Display strings, in the order the shortcuts were specified. */
export const AI_SHORTCUT_KEYS: Record<AiActionMode, string> = {
  IMPROVE_NOTES: 'Ctrl+Alt+I',
  EXPLAIN: 'Ctrl+Alt+E',
  CHECK_NOTES: 'Ctrl+Alt+C',
  EXAM_READY: 'Ctrl+Alt+X',
  MAKE_CLEARER: 'Ctrl+Alt+S',
}

/** Order the AI actions are listed in, matching the shortcut letters I-E-C-X-S. */
export const AI_SHORTCUT_ORDER: AiActionMode[] = [
  'IMPROVE_NOTES',
  'EXPLAIN',
  'CHECK_NOTES',
  'EXAM_READY',
  'MAKE_CLEARER',
]

type KeyLike = Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'code' | 'key'>

/**
 * Resolves a keydown to an AI action, or null if it isn't one of ours.
 *
 * Shift is excluded rather than ignored: leaving it unchecked would swallow
 * future Ctrl+Alt+Shift bindings and make this one fire on chords the student
 * meant for something else.
 */
export function matchAiShortcut(event: KeyLike): AiActionMode | null {
  if (!event.altKey || event.shiftKey) return null
  if (!event.ctrlKey && !event.metaKey) return null

  const byCode = AI_SHORTCUT_CODES[event.code]
  if (byCode) return byCode

  // Fallback for environments that don't populate `code` (synthetic events,
  // some virtual keyboards).
  const letter = event.key?.length === 1 ? `Key${event.key.toUpperCase()}` : ''
  return AI_SHORTCUT_CODES[letter] ?? null
}

/**
 * What the assistant says when an action fires with nothing highlighted.
 *
 * These actions rewrite the student's own words, so running them on a guess --
 * the whole document, or the paragraph the caret happens to sit in -- produces
 * an edit nobody asked for. Ask instead.
 */
export function describeSelectionNeeded(mode: AiActionMode): string {
  return `Which part of your notes should I ${AI_MODE_VERBS[mode]}? Highlight it in the document, then run this again (${AI_SHORTCUT_KEYS[mode]}).`
}

export interface Shortcut {
  keys: string
  description: string
}

export interface ShortcutGroup {
  title: string
  items: Shortcut[]
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'AI assistant',
    items: [
      ...AI_SHORTCUT_ORDER.map((mode) => ({
        keys: AI_SHORTCUT_KEYS[mode],
        description: AI_MODE_LABELS[mode],
      })),
      { keys: 'Ctrl+Shift+A', description: 'Open or close the AI panel' },
    ],
  },
  {
    title: 'Writing',
    items: [
      { keys: 'Ctrl+Enter', description: 'Page break' },
      { keys: 'Shift+Enter', description: 'Line break' },
      { keys: 'Ctrl+K', description: 'Insert link' },
      { keys: 'Ctrl+H', description: 'Find and replace' },
      { keys: 'Ctrl+P', description: 'Print' },
    ],
  },
  {
    title: 'Formatting',
    items: [
      { keys: 'Ctrl+B', description: 'Bold' },
      { keys: 'Ctrl+I', description: 'Italic' },
      { keys: 'Ctrl+U', description: 'Underline' },
      { keys: 'Ctrl+Z', description: 'Undo' },
      { keys: 'Ctrl+Shift+Z', description: 'Redo' },
      { keys: 'Ctrl+A', description: 'Select all' },
    ],
  },
]
