import { supabase } from '../lib/supabase'
import { guestSearchNotes } from './guestStore'
import {
  buildSnippet,
  escapeLikePattern,
  rankHits,
  SEARCH_LIMIT,
  type SearchHit,
} from './searchResults'

/**
 * Searching every note.
 *
 * Deliberately not built on the AI. A student looking for the lecture where
 * osmosis came up needs an answer in the time it takes to type, offline, and
 * with the same result every time -- none of which a model gives you, and all
 * of which a `LIKE` gives you. The brief is explicit that search must not
 * depend on the model, and this is why.
 *
 * It searches `content_text`, the denormalised plain text already written on
 * every save for the AI context layer. That column exists, is always current,
 * and is exactly "the note as words" -- so search needed no new storage and
 * cannot drift from what is in the document.
 *
 * ## What this is not
 *
 * `ILIKE '%term%'` cannot use an ordinary index, so this is a scan. At a
 * student's scale -- hundreds of notes, a few megabytes -- that is
 * milliseconds in Postgres and the simplest thing that is correct. It does not
 * stem ("run" will not find "running"), rank by relevance, or tolerate typos.
 *
 * The upgrade when that stops being enough is a `tsvector` column with a GIN
 * index, which is a migration and a ranking function rather than a rewrite:
 * this module's shape -- one query in, ranked results out -- is what the
 * callers depend on, and it would not change.
 */

interface DocumentSearchRow {
  id: string
  title: string
  slug: string
  content_text: string | null
  class_id: string
  classes: { name: string; slug: string } | null
}

export async function searchNotes(
  userId: string | null,
  rawQuery: string,
): Promise<SearchHit[]> {
  const query = rawQuery.trim()
  if (query.length === 0) return []

  if (!userId) return guestSearchNotes(query)

  const pattern = `%${escapeLikePattern(query)}%`

  /*
   * One request, not two. `or` across title and body means Postgres does the
   * union; running them separately and merging in JS would double the round
   * trips and make "matched in both" a case this has to deduplicate.
   *
   * RLS is what scopes this to the caller's notes -- there is no `user_id`
   * filter here because the policy already refuses everything else, and adding
   * one would imply the query is what protects the data.
   */
  const { data, error } = await supabase
    .from('documents')
    .select('id, title, slug, content_text, class_id, classes(name, slug)')
    .or(`title.ilike.${pattern},content_text.ilike.${pattern}`)
    .order('updated_at', { ascending: false })
    .limit(SEARCH_LIMIT)

  if (error) throw error

  const hits = (data ?? []).map((row) => {
    const record = row as unknown as DocumentSearchRow
    return {
      documentId: record.id,
      title: record.title,
      classId: record.class_id,
      className: record.classes?.name ?? 'Unfiled',
      classSlug: record.classes?.slug ?? '',
      slug: record.slug,
      snippet: buildSnippet(record.content_text ?? '', query),
      inTitle: record.title.toLowerCase().includes(query.toLowerCase()),
    }
  })

  return rankHits(hits)
}
