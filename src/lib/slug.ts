/**
 * URL slugs for classes and notes.
 *
 * Slugs are readable, not identifiers: rows are still keyed by id everywhere
 * internally. They exist so a link reads /classes/biology-101/lecture-5 rather
 * than a pair of UUIDs.
 */

const MAX_LENGTH = 60
const FALLBACK = 'untitled'

/**
 * Turns a name into a URL-safe slug.
 *
 * Accents are folded rather than stripped, so "Économie" becomes "economie"
 * instead of "conomie". Non-latin scripts are kept as-is: percent-encoded CJK
 * is still far more readable than dropping the title entirely and falling back
 * to "untitled" for every note.
 */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    // Combining marks left behind by NFKD; removing them is what turns
    // "é" into "e" rather than leaving a bare accent.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    // Keep letters and numbers in any script; everything else separates.
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')

  if (!slug) return FALLBACK

  if (slug.length <= MAX_LENGTH) return slug

  // Trim the trailing hyphen the cut can leave behind.
  return slug.slice(0, MAX_LENGTH).replace(/-+$/, '') || FALLBACK
}

/**
 * Makes a slug unique within its scope: classes within a user, notes within a
 * class.
 *
 * `currentSlug` is the row's existing slug when renaming. Without it, saving a
 * note under its own unchanged name would collide with itself and walk the
 * counter up on every save.
 */
export function uniqueSlug(
  name: string,
  taken: string[],
  currentSlug?: string,
): string {
  const base = slugify(name)
  const conflicts = new Set(taken.filter((slug) => slug !== currentSlug))

  if (!conflicts.has(base)) return base

  let counter = 2
  while (conflicts.has(`${base}-${counter}`)) counter += 1
  return `${base}-${counter}`
}
