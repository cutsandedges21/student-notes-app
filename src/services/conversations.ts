import { supabase } from '../lib/supabase'
import type { AiMode, AiResponse } from '../types/ai'
import { normaliseAiResponse } from '../lib/aiResponse'

/**
 * The assistant's transcript, kept.
 *
 * `conversations` and `messages` were created in the first migration and have
 * been empty in every deployment since: the panel held its transcript in React
 * state, so a reload, a navigation, or a rotation from phone to tablet lost
 * whatever had been discussed. An assistant that forgets you between page
 * loads is a text box.
 *
 * ## What is restored, and what is deliberately not
 *
 * A restored turn shows what was said, what the model contributed beyond the
 * notes, and which notes it cited. It does **not** offer to apply anything.
 *
 * That is the important half. A suggestion is anchored to a passage in the
 * document as it stood when the suggestion was made -- that anchor is what
 * stops an apply landing in the wrong place, and it is the whole subject of
 * `editor/applySuggestion.ts`. The anchor cannot survive a reload, because the
 * document it points into can be edited in between. Restoring an Apply button
 * without it would be offering to paste old text at a guessed location, which
 * is the exact failure the anchored applier exists to prevent.
 *
 * So history is readable and inert. Ask again to get a fresh, anchored answer.
 *
 * Signed-in only. Guest notes live in one browser with no server to keep a
 * transcript on, and the panel says so rather than quietly forgetting.
 */

export interface StoredTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
  mode: AiMode
  /** The validated response, for an assistant turn that had one. */
  payload: AiResponse | null
  createdAt: string
}

/**
 * How much of a transcript is read back.
 *
 * A conversation about one note does not usefully run longer than this, and
 * the cost of being wrong is a slow panel on open rather than lost history --
 * everything is still stored, just not all shown.
 */
export const TRANSCRIPT_LIMIT = 100

interface MessageRow {
  id: string
  role: 'user' | 'assistant'
  content: string
  mode: string
  payload: unknown
  created_at: string
}

/**
 * The conversation for a note, or null when there has not been one.
 *
 * Never creates. Opening a note should not write a row for a conversation
 * that may never happen, and an empty conversation per note per student is a
 * table that grows with navigation rather than with use.
 */
async function findConversation(documentId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('conversations')
    .select('id')
    .eq('document_id', documentId)
    .order('updated_at', { ascending: false })
    .limit(1)

  if (error) throw error
  return data?.[0]?.id ?? null
}

/** Reads the transcript for a note, oldest first. Empty when there is none. */
export async function loadConversation(
  userId: string | null,
  documentId: string,
): Promise<StoredTurn[]> {
  if (!userId) return []

  const conversationId = await findConversation(documentId)
  if (!conversationId) return []

  const { data, error } = await supabase
    .from('messages')
    .select('id, role, content, mode, payload, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(TRANSCRIPT_LIMIT)

  if (error) throw error

  return (data ?? []).map((row) => {
    const record = row as MessageRow
    return {
      id: record.id,
      role: record.role,
      content: record.content,
      mode: (record.mode as AiMode) ?? 'CHAT',
      /*
       * Normalised on the way out for the same reason the network reply is:
       * a row written before a field existed does not have it, and the card
       * reads several of them unconditionally. A stored transcript is the
       * one place where "written by an older version" is guaranteed rather
       * than possible.
       */
      payload: normaliseAiResponse(record.payload, (record.mode as AiMode) ?? 'CHAT'),
      createdAt: record.created_at,
    }
  })
}

/**
 * Appends a turn, creating the conversation on the first one.
 *
 * Returns the conversation id so a caller writing a pair of turns does not
 * look it up twice, and so the first write of a session is one round trip
 * rather than a lookup followed by an insert.
 */
export async function appendTurn(
  userId: string,
  documentId: string,
  classId: string,
  turn: { role: 'user' | 'assistant'; content: string; mode: AiMode; payload?: AiResponse | null },
  knownConversationId?: string | null,
): Promise<string> {
  let conversationId = knownConversationId ?? (await findConversation(documentId))

  if (!conversationId) {
    const { data, error } = await supabase
      .from('conversations')
      .insert({ user_id: userId, class_id: classId, document_id: documentId })
      .select('id')
      .single()

    if (error) throw error
    conversationId = data.id as string
  }

  const { error } = await supabase.from('messages').insert({
    conversation_id: conversationId,
    user_id: userId,
    role: turn.role,
    mode: turn.mode,
    content: turn.content,
    payload: turn.payload ?? null,
  })

  if (error) throw error
  return conversationId
}

/**
 * Ends the conversation for a note.
 *
 * Deletes rather than starting a second one beside it: "new conversation" in
 * the panel means the student wants the assistant to stop carrying what was
 * said, and leaving the old rows would mean the next reload brought them back.
 * `messages` cascades from `conversations`, so one delete is the whole thing.
 */
export async function clearConversation(
  userId: string | null,
  documentId: string,
): Promise<void> {
  if (!userId) return

  const { error } = await supabase
    .from('conversations')
    .delete()
    .eq('document_id', documentId)
    .eq('user_id', userId)

  if (error) throw error
}
