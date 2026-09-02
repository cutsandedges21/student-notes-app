import { z } from 'zod'
import { defineTool, toolError, toolOk } from './types.ts'

/**
 * Find notes by what is written in them.
 *
 * The reason this is a tool rather than more context in the prompt: the
 * function used to load the ten most recently edited notes in the class and
 * paste all of them in, whether or not any of it was relevant. That is a large
 * prompt to answer "when did we cover osmosis", and it silently misses the
 * answer the moment the note is eleventh.
 *
 * Results carry where they came from, so the assistant can say which note it
 * is drawing on. An answer a student cannot check against their own notes is
 * worth very little.
 */

const SNIPPET_CHARS = 400

export const searchNotesTool = defineTool({
  name: 'search_notes',
  description:
    'Search the student\'s own notes for a word or phrase. Use this before answering ' +
    'anything that depends on what they have written down, rather than assuming. ' +
    'Returns the note title, its class, and the passage that matched, so you can cite ' +
    'which note an answer came from. Searches titles and body text; it does not ' +
    'understand synonyms, so prefer the words the student actually used.',
  mutates: false,
  input: z.object({
    query: z.string().min(2).max(200).describe('The words to look for.'),
    scope: z
      .enum(['class', 'everywhere'])
      .default('class')
      .describe(
        'class searches only the class the open note belongs to, which is almost ' +
          'always what is wanted. everywhere searches every note the student has.',
      ),
    limit: z.number().int().min(1).max(10).default(5),
  }),
  parameters: {
    type: 'OBJECT',
    properties: {
      query: { type: 'STRING', description: 'The words to look for.' },
      scope: {
        type: 'STRING',
        enum: ['class', 'everywhere'],
        description:
          'class searches only the class the open note belongs to, which is almost ' +
          'always what is wanted. everywhere searches every note the student has.',
      },
      limit: { type: 'INTEGER', description: 'How many notes to return, 1 to 10.' },
    },
    required: ['query'],
  },
  async run({ query, scope, limit }, { supabase, userId, classId }) {
    // Escaped for the same reason search.ts escapes it: `%` is a LIKE
    // wildcard, so an unescaped one matches every note the student owns.
    const pattern = `%${query.replace(/[\\%_]/g, (character) => `\\${character}`)}%`

    let request = supabase
      .from('documents')
      .select('id, title, content_text, class_id, classes(name)')
      .eq('user_id', userId)
      .or(`title.ilike.${pattern},content_text.ilike.${pattern}`)
      .order('updated_at', { ascending: false })
      .limit(limit)

    if (scope === 'class') request = request.eq('class_id', classId)

    const { data, error } = await request

    if (error) {
      console.error('[search_notes] failed', error)
      return toolError('FAILED', 'The notes could not be searched just now.')
    }

    const notes = (data ?? []).map((row) => {
      const record = row as {
        id: string
        title: string
        content_text: string | null
        classes: { name: string } | null
      }
      const text = (record.content_text ?? '').replace(/\s+/g, ' ').trim()
      const at = text.toLowerCase().indexOf(query.toLowerCase())
      const from = at === -1 ? 0 : Math.max(0, at - SNIPPET_CHARS / 4)

      return {
        documentId: record.id,
        title: record.title || 'Untitled document',
        className: record.classes?.name ?? 'Unfiled',
        excerpt: text.slice(from, from + SNIPPET_CHARS),
      }
    })

    /*
     * An empty result is a success, not an error. "There is nothing in your
     * notes about this" is a true and useful answer, and returning a failure
     * would push the model toward answering from its own memory instead --
     * which is the fabrication the brief is most concerned about.
     */
    return toolOk({ query, scope, found: notes.length, notes })
  },
})
