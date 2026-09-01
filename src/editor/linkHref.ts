/**
 * Turning what somebody typed into a link.
 *
 * Its own module rather than living beside the dialog, so the dialog file
 * exports only a component (Fast Refresh needs that), and so the interesting
 * rule -- which schemes are allowed -- can be tested without mounting
 * anything.
 */

/**
 * Schemes a link may use.
 *
 * An allowlist, not a blocklist. `javascript:` is the obvious one to keep out,
 * but `data:` can carry an HTML document and `blob:` can outlive its origin,
 * and a blocklist would have to keep growing to stay correct. Tiptap's Link
 * extension also protocol-checks at render time; this is the earlier of the
 * two, and the one that can explain itself to the person typing.
 */
const SAFE_SCHEME = /^(https?|mailto|tel):/i

export type LinkResult = { href: string } | { error: string }

export function normaliseLinkHref(raw: string): LinkResult {
  const value = raw.trim()
  if (!value) return { error: 'Enter a web address.' }

  /*
   * A bare domain or path is what people actually paste. Left alone it becomes
   * a relative link that navigates inside the app -- `example.com` would open
   * /classes/example.com -- so a missing scheme is filled in rather than
   * treated as an error.
   */
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`

  if (!SAFE_SCHEME.test(candidate)) {
    return { error: 'Links can only point at http, https, mailto or tel addresses.' }
  }

  try {
    return { href: new URL(candidate).toString() }
  } catch {
    return { error: "That doesn't look like a web address." }
  }
}
