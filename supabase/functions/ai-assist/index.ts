// Supabase Edge Function: ai-assist
//
// The only place the Gemini key exists. The browser calls this function with
// its Supabase session; the key never leaves the server.
//
// Note content is loaded here from the database rather than accepted from the
// client. That keeps request payloads small and means a tampered client cannot
// pull another user's notes into a prompt -- the query is scoped to the
// caller's own id, and RLS enforces it a second time.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { AI_PROMPT_VERSION, SYSTEM_PROMPT } from './prompts/studentAssistant.ts'
import { buildAIContext } from './context.ts'
import { corsHeaders } from './cors.ts'
import { LIMITS, parseAiResponse, requestSchema } from './validate.ts'

// Overridable, because Google retires models on its own schedule: when this
// default dies the fix is a secret, not a redeploy.
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.6-flash'
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
const REQUEST_TIMEOUT_MS = 30_000

/**
 * Cap on generation, not just on what we accept afterwards.
 *
 * Validation rejecting an oversized response still means having paid for it.
 * This is the limit that bounds cost.
 */
const MAX_OUTPUT_TOKENS = 8_192

/** Shape Gemini must return. Enforced by the model, then re-checked by Zod. */
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    mode: { type: 'STRING' },
    response: { type: 'STRING' },
    proposed_content: { type: 'STRING', nullable: true },
    issues: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          original: { type: 'STRING' },
          problem: { type: 'STRING' },
          correction: { type: 'STRING' },
          confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
        },
        required: ['original', 'problem', 'correction', 'confidence'],
      },
    },
    added_information: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['mode', 'response', 'issues', 'added_information'],
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('Origin')
  const CORS = corsHeaders(origin)

  const fail = (code: string, status: number, extra: Record<string, unknown> = {}) =>
    new Response(JSON.stringify({ error: code, ...extra }), {
      status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return fail('BAD_REQUEST', 405)

  // No Allow-Origin header means the origin is not on the list. Refusing here
  // as well as in the headers means a non-browser caller gets the same answer
  // a browser would enforce, rather than a working endpoint.
  if (origin && !CORS['Access-Control-Allow-Origin']) {
    console.warn('[ai-assist] blocked origin', origin)
    return fail('FORBIDDEN_ORIGIN', 403)
  }

  if (!GEMINI_API_KEY) {
    console.error('[ai-assist] GEMINI_API_KEY is not set')
    return fail('NOT_CONFIGURED', 503)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return fail('UNAUTHORIZED', 401)

  // Read the body with a cap before parsing it. Content-Length is a claim, so
  // the actual bytes are measured too.
  const declared = Number(req.headers.get('Content-Length') ?? '0')
  if (declared > LIMITS.requestBytes) return fail('PAYLOAD_TOO_LARGE', 413)

  const rawBody = await req.text()
  if (rawBody.length > LIMITS.requestBytes) return fail('PAYLOAD_TOO_LARGE', 413)

  let parsedBody: unknown
  try {
    parsedBody = JSON.parse(rawBody)
  } catch {
    return fail('BAD_REQUEST', 400)
  }

  const request = requestSchema.safeParse(parsedBody)
  if (!request.success) return fail('BAD_REQUEST', 400)
  const { mode, documentId, classId, selectedText, userRequest, conversation } = request.data

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )

  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return fail('UNAUTHORIZED', 401)
  const userId = userData.user.id

  // Scoped to the caller; RLS enforces the same constraint independently.
  const [classResult, documentResult, siblingsResult] = await Promise.all([
    supabase.from('classes').select('*').eq('id', classId).eq('user_id', userId).maybeSingle(),
    supabase.from('documents').select('*').eq('id', documentId).eq('user_id', userId).maybeSingle(),
    supabase
      .from('documents')
      .select('id, title, content_text')
      .eq('class_id', classId)
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(10),
  ])

  if (classResult.error || documentResult.error || siblingsResult.error) {
    console.error('[ai-assist] database read failed', {
      classError: classResult.error,
      documentError: documentResult.error,
      siblingsError: siblingsResult.error,
    })
    return fail('UPSTREAM_ERROR', 500)
  }

  if (!classResult.data || !documentResult.data) return fail('NOT_FOUND', 404)

  const prompt = buildAIContext({
    mode,
    klass: classResult.data,
    document: documentResult.data,
    selectedText,
    userRequest,
    siblings: siblingsResult.data ?? [],
    conversation,
    currentDocumentId: documentId,
  })

  /*
   * Claim quota before spending money, not after.
   *
   * Enforced in Postgres because edge functions are scaled and cold-started --
   * an in-process counter would limit one instance for as long as it happened
   * to live. The claim also records prompt version and model against the
   * request, so a behaviour change after a prompt edit is a query rather than
   * a guess.
   */
  const { data: claimRows, error: claimError } = await supabase.rpc('claim_ai_request', {
    p_mode: mode,
    p_document_id: documentId,
    p_prompt_version: AI_PROMPT_VERSION,
    p_model: GEMINI_MODEL,
    p_input_chars: prompt.length,
  })

  if (claimError) {
    console.error('[ai-assist] quota claim failed', claimError)
    return fail('UPSTREAM_ERROR', 500)
  }

  const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows
  if (!claim?.allowed) {
    const reason = claim?.reason ?? 'rate_limited'
    return fail(
      reason === 'quota_exceeded' ? 'QUOTA_EXCEEDED' : 'RATE_LIMIT',
      429,
      { retryAfterSeconds: claim?.retry_after_seconds ?? 60 },
    )
  }

  const requestId = claim.request_id as string
  /** Best effort: accounting must never turn a good answer into an error. */
  const close = async (outcome: string, outputChars: number) => {
    const { error } = await supabase.rpc('complete_ai_request', {
      p_request_id: requestId,
      p_outcome: outcome,
      p_output_chars: outputChars,
    })
    if (error) console.error('[ai-assist] failed to close out request', error)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        // The key travels in a header, not the query string. Query strings end
        // up in proxy logs and error reports; headers are less likely to.
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA,
          },
        }),
      },
    )

    if (geminiResponse.status === 429) {
      await close('error', 0)
      return fail('RATE_LIMIT', 429, { retryAfterSeconds: 60 })
    }

    if (!geminiResponse.ok) {
      // Logged for developers; never surfaced to the student.
      console.error('[ai-assist] gemini error', geminiResponse.status, await geminiResponse.text())
      await close('error', 0)
      return fail('UPSTREAM_ERROR', 502)
    }

    const payload = await geminiResponse.json()

    // The first part is not reliably the answer: reasoning models put a
    // thought signature in its own part and the JSON in a later one. Take the
    // first part that actually carries text.
    const parts: unknown[] = payload?.candidates?.[0]?.content?.parts ?? []
    const text = parts
      .map((part) => (part as { text?: unknown })?.text)
      .find((value): value is string => typeof value === 'string')

    if (typeof text !== 'string') {
      console.error('[ai-assist] unexpected gemini payload', JSON.stringify(payload).slice(0, 800))
      await close('error', 0)
      return fail('INVALID_RESPONSE', 502)
    }

    const result = parseAiResponse(text, mode)
    if (!result) {
      console.error('[ai-assist] model output failed validation', text.slice(0, 800))
      await close('refused', text.length)
      return fail('INVALID_RESPONSE', 502)
    }

    await close('ok', text.length)

    return new Response(JSON.stringify(result), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    const aborted = (error as Error)?.name === 'AbortError'
    if (!aborted) console.error('[ai-assist] unexpected failure', error)
    await close('error', 0)
    return aborted ? fail('TIMEOUT', 504) : fail('UPSTREAM_ERROR', 500)
  } finally {
    clearTimeout(timeout)
  }
})
