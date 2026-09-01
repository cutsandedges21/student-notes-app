/**
 * How another person's cursor is drawn.
 *
 * The extension's default is a caret with a name tag. Two changes here:
 *
 * 1. The label carries `data-initial`, which the stylesheet renders as a small
 *    disc in front of the name. CSS cannot take the first character of an
 *    attribute, so the initial has to be computed here. Two carets in the same
 *    paragraph are then tellable apart at a glance rather than by reading both
 *    names.
 * 2. The label is always present rather than revealed on hover, so a
 *    collaborator is noticed without being looked for. It fades while idle;
 *    see the animation in index.css.
 *
 * Built with DOM calls rather than innerHTML: `name` is another user's display
 * name, which they chose, and it is inserted with `textContent` so it cannot
 * carry markup into the document.
 */

export interface CaretUser {
  name?: string
  color?: string
}

/** The letter shown on the disc. Falls back rather than rendering an empty one. */
export function caretInitial(name: string | undefined): string {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return '?'
  // Intl-aware enough for names that begin with an astral character: taking
  // [0] would split a surrogate pair and render a replacement glyph.
  return [...trimmed][0].toUpperCase()
}

/** The name shown on the tag. */
export function caretLabel(name: string | undefined): string {
  const trimmed = (name ?? '').trim()
  return trimmed || 'Someone'
}

export function renderCollaborationCaret(user: CaretUser): HTMLElement {
  const caret = document.createElement('span')
  caret.classList.add('collaboration-carets__caret')
  caret.setAttribute('style', `border-color: ${user.color ?? '#666'}`)

  const label = document.createElement('div')
  label.classList.add('collaboration-carets__label')
  label.setAttribute('style', `background-color: ${user.color ?? '#666'}`)
  label.setAttribute('data-initial', caretInitial(user.name))
  label.textContent = caretLabel(user.name)

  caret.append(label)
  return caret
}
