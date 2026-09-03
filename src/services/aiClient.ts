import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { normaliseAiResponse } from '../lib/aiResponse'
import {
  AiRequestError,
  type AiMode,
  type AiRequest,
  type AiResponse,
  type AiErrorCode,
} from '../types/ai'

/**
 * Browser-side AI service.
 *
 * One method per mode, all funnelling through a single `invoke` so every
 * request is shaped identically and every failure is normalised to a typed
 * code. The Gemini key lives only in the edge function.
 */

async function invoke(request: AiRequest, signal?: AbortSignal): Promise<AiResponse> {
  if (!isSupabaseConfigured) throw new AiRequestError('NOT_CONFIGURED')

  const { data, error } = await supabase.functions.invoke('ai-assist', {
    body: request,
    signal,
  })

  if (error) {
    /*
     * A cancelled request is not a failure, and must not be reported as one.
     * `supabase-js` surfaces an abort as an ordinary error, so it is
     * recognised here rather than at every call site -- the alternative is an
     * error toast every time somebody changes their mind.
     */
    if (signal?.aborted) throw new AiRequestError('CANCELLED')

    // supabase-js wraps non-2xx responses; the body still carries our code.
    let code: AiErrorCode = 'UPSTREAM_ERROR'
    try {
      const parsed = await (error as { context?: Response }).context?.json()
      if (parsed?.error) code = parsed.error as AiErrorCode
    } catch {
      // Keep the generic code; the real cause is in the function logs.
    }
    console.error('[aiClient] request failed:', error)
    throw new AiRequestError(code)
  }

  /*
   * Normalised, not cast.
   *
   * `data as AiResponse` was a promise the compiler could not keep: the thing
   * on the other side of this call is a deployed function, and it is not
   * guaranteed to be the version this build expects. Adding `sources` and
   * `proposed_actions` to the type turned every reply from an edge function
   * that had not been redeployed into a blank screen, because the card reads
   * `result.sources.length`.
   */
  const normalised = normaliseAiResponse(data, request.mode)
  if (!normalised) {
    console.error('[aiClient] malformed response payload:', data)
    throw new AiRequestError('INVALID_RESPONSE')
  }

  return normalised
}

interface Target {
  documentId: string
  classId: string
  selectedText?: string
}

const call = (mode: AiMode, target: Target, userRequest?: string, signal?: AbortSignal) =>
  invoke({ mode, ...target, userRequest }, signal)

/*
 * `userRequest` steers a re-run: when a student declines a suggestion and says
 * what was wrong with it, the same action runs again on the same text with
 * that instruction attached.
 */
export const AIService = {
  improveNotes: (target: Target, userRequest?: string, signal?: AbortSignal) =>
    call('IMPROVE_NOTES', target, userRequest, signal),
  checkNotes: (target: Target, userRequest?: string, signal?: AbortSignal) =>
    call('CHECK_NOTES', target, userRequest, signal),
  explain: (target: Target, userRequest?: string, signal?: AbortSignal) =>
    call('EXPLAIN', target, userRequest, signal),
  makeClearer: (target: Target, userRequest?: string, signal?: AbortSignal) =>
    call('MAKE_CLEARER', target, userRequest, signal),
  examReady: (target: Target, userRequest?: string, signal?: AbortSignal) =>
    call('EXAM_READY', target, userRequest, signal),
  chat: (
    target: Target,
    question: string,
    conversation: AiRequest['conversation'],
    signal?: AbortSignal,
  ) => invoke({ mode: 'CHAT', ...target, userRequest: question, conversation }, signal),
}

export const AI_ACTIONS: {
  mode: Exclude<AiMode, 'CHAT'>
  run: (t: Target, userRequest?: string, signal?: AbortSignal) => Promise<AiResponse>
}[] =
  [
    { mode: 'IMPROVE_NOTES', run: AIService.improveNotes },
    { mode: 'CHECK_NOTES', run: AIService.checkNotes },
    { mode: 'EXPLAIN', run: AIService.explain },
    { mode: 'MAKE_CLEARER', run: AIService.makeClearer },
    { mode: 'EXAM_READY', run: AIService.examReady },
  ]
