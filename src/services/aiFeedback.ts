import { supabase } from '../lib/supabase'
import type { AiMode } from '../types/ai'

/**
 * Recording what a student thought of an answer.
 *
 * The reader is the eval suite, not a dashboard. `evals/cases.ts` is a
 * hand-written list of behaviours the assistant must hold, and the honest
 * limitation of hand-written cases is that they cover the failures somebody
 * thought of. A thumbs-down is a failure somebody actually hit, with the mode
 * and prompt version attached -- the shape of a case waiting to be written.
 *
 * Nothing here feeds back into the model, and the UI does not suggest it does.
 * Saying "thanks, this helps improve the assistant" would be the kind of claim
 * this programme has spent its time removing: the loop is a person reading the
 * rows and writing a case, and it only closes if somebody does.
 */

export type FeedbackRating = 'up' | 'down'

export interface FeedbackInput {
  rating: FeedbackRating
  /** The stored turn being rated, when there is one. */
  messageId?: string | null
  documentId?: string | null
  mode: AiMode
  promptVersion?: string
  /** Free text. The "why", which a rating on its own cannot carry. */
  note?: string
}

/**
 * Records a rating.
 *
 * Guests cannot: there is no account to attach it to, and the panel does not
 * offer it to them.
 *
 * Throws rather than swallowing, so a caller can tell the student it did not
 * save. A rating that silently vanished would be worse than no button --
 * somebody who reports a bad answer and is thanked for it has been lied to.
 */
export async function recordFeedback(
  userId: string | null,
  input: FeedbackInput,
): Promise<void> {
  if (!userId) throw new Error('Sign in to send feedback.')

  const { error } = await supabase.from('ai_feedback').insert({
    user_id: userId,
    message_id: input.messageId ?? null,
    document_id: input.documentId ?? null,
    rating: input.rating,
    note: input.note?.trim() || null,
    mode: input.mode,
    prompt_version: input.promptVersion ?? '',
  })

  if (error) throw error
}
