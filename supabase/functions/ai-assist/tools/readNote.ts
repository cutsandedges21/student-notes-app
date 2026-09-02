import { z } from 'zod'
import { defineTool, toolError, toolOk } from './types.ts'

/**
 * Read one note in full.
 *
 * Paired with `search_notes`: search returns short excerpts across many notes,
 * and this fetches the one that turned out to matter. Splitting them is what
 * keeps a prompt from carrying ten full notes on the chance one is relevant.
 *
 * The note id has to come from a previous search result. That is not a
 * convention the model is trusted to follow -- ownership is re-checked here --
 * but it is what the description tells it, because a model inventing a UUID
 * gets NOT_FOUND and wastes a turn.
 */

/**
 * Cap on what one note contributes to a prompt.
 *
 * A long note is genuinely long -- a term of lectures in one document is
 * ordinary -- and the whole of it would crowd out everything else, including
 * the question. Truncation is reported rather than silent, so the model can
 * say it has only seen part.
 */
const MAX_NOTE_CHARS = 12_000

export const readNoteTool = defineTool({
  name: 'read_note',
  description:
    'Read the full text of one of the student\'s notes, by the documentId from a ' +
    'search_notes result. Use it when an excerpt is not enough to answer properly. ' +
    'Long notes come back truncated, and the result says so when that happens.',
  mutates: false,
  input: z.object({
    documentId: z.string().uuid().describe('From a search_notes result.'),
  }),
  parameters: {
    type: 'OBJECT',
    properties: {
      documentId: {
        type: 'STRING',
        description: 'The documentId from a search_notes result.',
      },
    },
    required: ['documentId'],
  },
  async run({ documentId }, { supabase, userId }) {
    const { data, error } = await supabase
      .from('documents')
      .select('id, title, content_text, user_id, classes(name)')
      .eq('id', documentId)
      .maybeSingle()

    if (error) {
      console.error('[read_note] failed', error)
      return toolError('FAILED', 'That note could not be read just now.')
    }

    if (!data) return toolError('NOT_FOUND', 'There is no note with that id.')

    const record = data as {
      id: string
      title: string
      content_text: string | null
      user_id: string
      classes: { name: string } | null
    }

    /*
     * Belt and braces. RLS already refuses another user's row, so this branch
     * should be unreachable -- which is exactly why it is here: if RLS is ever
     * loosened by a migration, this is what stops the assistant becoming the
     * way to read somebody else's notes.
     */
    if (record.user_id !== userId) {
      return toolError('FORBIDDEN', 'That note does not belong to this student.')
    }

    const full = record.content_text ?? ''
    const truncated = full.length > MAX_NOTE_CHARS

    return toolOk({
      documentId: record.id,
      title: record.title || 'Untitled document',
      className: record.classes?.name ?? 'Unfiled',
      text: truncated ? full.slice(0, MAX_NOTE_CHARS) : full,
      truncated,
    })
  },
})
