/**
 * The parts of search that are the same wherever the notes are stored.
 *
 * Its own module so `search.ts` (Postgres) and `guestStore.ts` (localStorage)
 * can both use them without importing each other -- they did, briefly, and a
 * cycle that only works because function declarations hoist is not a thing to
 * leave in place.
 */

export interface SearchHit {
  documentId: string
  title: string
  classId: string
  className: string
  classSlug: string
  slug: string
  /** The text around the first match, for showing why this note matched. */
  snippet: string
  /** True when the query matched the title rather than only the body. */
  inTitle: boolean
}

/** How much text to show around a match. */
const SNIPPET_RADIUS = 60

export const SEARCH_LIMIT = 30

/**
 * Escapes a query for use inside a PostgREST `ilike` pattern.
 *
 * `%` and `_` are wildcards there, so a student searching for "50%" would
 * otherwise match every note.
 */
export function escapeLikePattern(query: string): string {
  return query.replace(/[\\%_]/g, (character) => `\\${character}`)
}

/**
 * Text around the first match, with the match itself left in place.
 *
 * Returns the head of the text when there is no match -- which happens when
 * the query matched the title and not the body, and showing the opening of
 * the note is more use than showing nothing.
 */
export function buildSnippet(text: string, query: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (!flat) return ''

  const at = flat.toLowerCase().indexOf(query.toLowerCase())
  if (at === -1) return flat.slice(0, SNIPPET_RADIUS * 2).trim()

  const from = Math.max(0, at - SNIPPET_RADIUS)
  const to = Math.min(flat.length, at + query.length + SNIPPET_RADIUS)

  return `${from > 0 ? '…' : ''}${flat.slice(from, to).trim()}${to < flat.length ? '…' : ''}`
}

/**
 * Orders hits so a title match outranks a body match.
 *
 * Someone who types "osmosis" and has a note called "Osmosis" means that note.
 * Beyond that the order is left alone, which is the recency the callers
 * already sorted by.
 */
export function rankHits(hits: SearchHit[]): SearchHit[] {
  return [...hits].sort((a, b) => Number(b.inTitle) - Number(a.inTitle))
}
