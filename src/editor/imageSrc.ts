/**
 * Turning what somebody typed or pasted into an image source.
 *
 * Its own module for the same two reasons as `linkHref.ts`: the dialog file
 * exports only a component, which Fast Refresh needs, and the interesting rule
 * -- which schemes may load into an `<img>` -- is testable without mounting
 * anything.
 */

/**
 * Schemes an image may use.
 *
 * An allowlist again, but a different one from links, because the risk is
 * different. `data:` is refused for links because it can carry a whole HTML
 * document that runs on click; as an `<img src>` it cannot, and it is how a
 * pasted screenshot arrives, so it is allowed here and narrowed to image
 * types. `javascript:` and `blob:` stay out.
 */
const SAFE_SCHEME = /^(https?:|data:image\/(png|jpeg|jpg|gif|webp|avif|svg\+xml);)/i

export type ImageResult = { src: string } | { error: string }

export function normaliseImageSrc(raw: string): ImageResult {
  const value = raw.trim()
  if (!value) return { error: 'Enter an image address.' }

  // Same reasoning as links: a bare domain is what people paste, and left
  // alone it resolves against the app and loads nothing.
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`

  if (!SAFE_SCHEME.test(candidate)) {
    return { error: 'Images can only be loaded over http, https, or a pasted image.' }
  }

  // A data: URL is not a URL the parser will accept a hostname from, and it is
  // already fully specified, so it is returned as typed.
  if (candidate.startsWith('data:')) return { src: candidate }

  try {
    return { src: new URL(candidate).toString() }
  } catch {
    return { error: "That doesn't look like an image address." }
  }
}
