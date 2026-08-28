import { supabase, isSupabaseConfigured } from '../lib/supabase'
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

async function invoke(request: AiRequest): Promise<AiResponse> {
  if (!isSupabaseConfigured) throw new AiRequestError('NOT_CONFIGURED')

  const { data, error } = await supabase.functions.invoke('ai-assist', {
    body: request,
  })

  if (error) {
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

  if (!data || typeof data.response !== 'string') {
    console.error('[aiClient] malformed response payload:', data)
    throw new AiRequestError('INVALID_RESPONSE')
  }

  return data as AiResponse
}

interface Target {
  documentId: string
  classId: string
  selectedText?: string
}

const call = (mode: AiMode, target: Target, userRequest?: string) =>
  invoke({ mode, ...target, userRequest })

export const AIService = {
  improveNotes: (target: Target) => call('IMPROVE_NOTES', target),
  checkNotes: (target: Target) => call('CHECK_NOTES', target),
  explain: (target: Target) => call('EXPLAIN', target),
  makeClearer: (target: Target) => call('MAKE_CLEARER', target),
  examReady: (target: Target) => call('EXAM_READY', target),
  chat: (target: Target, question: string, conversation: AiRequest['conversation']) =>
    invoke({ mode: 'CHAT', ...target, userRequest: question, conversation }),
}

export const AI_ACTIONS: { mode: Exclude<AiMode, 'CHAT'>; run: (t: Target) => Promise<AiResponse> }[] =
  [
    { mode: 'IMPROVE_NOTES', run: AIService.improveNotes },
    { mode: 'CHECK_NOTES', run: AIService.checkNotes },
    { mode: 'EXPLAIN', run: AIService.explain },
    { mode: 'MAKE_CLEARER', run: AIService.makeClearer },
    { mode: 'EXAM_READY', run: AIService.examReady },
  ]
