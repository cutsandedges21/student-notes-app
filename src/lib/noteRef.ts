/**
 * The address of a note.
 *
 * A note's identity is its database id and nothing else. The slug is
 * presentation: it makes a link readable, and it is allowed to change whenever
 * the title does.
 *
 * Those two facts used to be in conflict, because the URL carried only the
 * slug. Renaming a note therefore re-slugged the row, which changed the note's
 * address, which made the router navigate, which reloaded the document and
 * pushed the reloaded content back into the editor -- resetting the caret, and
 * racing whatever the writer was still typing. A rename could eat a sentence.
 *
 * A reference carries both parts:
 *
 *     biology-101/lecture-5--0f7c2a1e-...    slug for humans, id for the app
 *
 * Only the id is ever looked up. The slug in front of it is decoration: it can
 * be stale, wrong, or missing entirely and the note still resolves, which is
 * what makes an old link keep working after a rename. When it disagrees with
 * the stored slug the page quietly rewrites the address to the canonical form.
 *
 * One segment rather than two because React Router matches whole segments: a
 * path like `:noteSlug--:documentId` is not a thing it can express, so the
 * segment is parsed here instead.
 */

/**
 * Separates the readable part from the id.
 *
 * Two hyphens, because one appears inside every slug. A uuid contains single
 * hyphens too, so the id is taken from the LAST occurrence -- a slug may
 * contain `--` of its own if a title had punctuation where the slugifier put
 * separators back to back.
 */
const SEPARATOR = '--'

/** Canonical v4-ish uuid, which is what Postgres mints for these tables. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface NoteRef {
  /** Readable part. Never authoritative, and empty for a bare-id reference. */
  slug: string
  /**
   * The note's identity, when the address carries one.
   *
   * Null for a legacy link written before ids were in the URL. Those still
   * resolve, by slug, and are redirected to the canonical form once they do.
   */
  documentId: string | null
}

/** Builds the canonical address of a note. */
export function formatNoteRef(slug: string, documentId: string): string {
  // A note with no title has no slug worth showing; the id alone is a valid
  // address and reads better than `untitled--<uuid>`.
  return slug ? `${slug}${SEPARATOR}${documentId}` : documentId
}

/**
 * Reads an address back into its parts.
 *
 * Deliberately total: any string is a reference to something, even if nothing
 * matches it. Callers decide what to do about a miss.
 */
export function parseNoteRef(ref: string): NoteRef {
  const trimmed = (ref ?? '').trim()
  if (!trimmed) return { slug: '', documentId: null }

  // The whole segment is an id: the canonical form for an untitled note.
  if (UUID.test(trimmed)) return { slug: '', documentId: trimmed }

  const at = trimmed.lastIndexOf(SEPARATOR)
  if (at === -1) return { slug: trimmed, documentId: null }

  const candidate = trimmed.slice(at + SEPARATOR.length)
  // A slug that merely happens to contain `--` is not an id. Falling back to
  // treating the whole thing as a slug keeps such a link working rather than
  // resolving it to nothing.
  if (!UUID.test(candidate)) return { slug: trimmed, documentId: null }

  return { slug: trimmed.slice(0, at), documentId: candidate }
}

/** The full path of a note, for links and redirects. */
export function noteHref(classSlug: string, slug: string, documentId: string): string {
  return `/classes/${classSlug}/${formatNoteRef(slug, documentId)}`
}
