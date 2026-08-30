// Supabase Edge Function: ai-assist
//
// The only place the Gemini key exists. The browser calls this function with
// its Supabase session; the key never leaves the server.
//
// Content is loaded here from the database rather than accepted from the
// client. That keeps request payloads small and means a tampered client cannot
// be used to pull another user's notes into a prompt -- the query is scoped to
// the caller's own id, and RLS enforces it a second time.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { AI_PROMPT_VERSION, SYSTEM_PROMPT } from './prompts/studentAssistant.ts'
import { buildAIContext, type ConversationTurn } from './context.ts'

// Overridable, because Google retires models on its own schedule: when this
// default dies the fix is a secret, not a redeploy. `gemini-2.0-flash` was the
// previous default and now returns 404 from the API.
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.6-flash'
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
const REQUEST_TIMEOUT_MS = 30_000

const VALID_MODES = new Set([
  'IMPROVE_NOTES',
  'CHECK_NOTES',
  'EXPLAIN',
  'MAKE_CLEARER',
  'EXAM_READY',
  'CHAT',
])

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** Shape Gemini must return. Enforced by the model, then re-checked here. */
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

function fail(code: string, status: number): Response {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

/**
 * Validates Gemini's JSON by hand rather than trusting it.
 *
 * responseSchema makes malformed output unlikely, not impossible, and a
 * half-valid object reaching the UI would surface as a confusing render rather
 * than a clean error.
 */
function parseAiResponse(raw: string, mode: string): Record<string, unknown> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) return null
  const value = parsed as Record<string, unknown>

  if (typeof value.response !== 'string') return null

  const issues = Array.isArray(value.issues) ? value.issues : []
  const validIssues = issues.filter((issue: unknown) => {
    if (typeof issue !== 'object' || issue === null) return false
    const i = issue as Record<string, unknown>
    return (
      typeof i.original === 'string' &&
      typeof i.problem === 'string' &&
      typeof i.correction === 'string'
    )
  })

  return {
    mode,
    response: value.response,
    proposed_content:
      typeof value.proposed_content === 'string' && value.proposed_content.trim()
        ? value.proposed_content
        : null,
    issues: validIssues,
    added_information: Array.isArray(value.added_information)
      ? value.added_information.filter((item: unknown) => typeof item === 'string')
      : [],
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return fail('BAD_REQUEST', 405)

  if (!GEMINI_API_KEY) {
    console.error('[ai-assist] GEMINI_API_KEY is not set')
    return fail('NOT_CONFIGURED', 503)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return fail('UNAUTHORIZED', 401)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )

  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return fail('UNAUTHORIZED', 401)
  const userId = userData.user.id

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return fail('BAD_REQUEST', 400)
  }

  const mode = String(body.mode ?? '')
  const documentId = String(body.documentId ?? '')
  const classId = String(body.classId ?? '')

  if (!VALID_MODES.has(mode) || !documentId || !classId) return fail('BAD_REQUEST', 400)

  const selectedText = typeof body.selectedText === 'string' ? body.selectedText : undefined
  const userRequest = typeof body.userRequest === 'string' ? body.userRequest : undefined
  const conversation = Array.isArray(body.conversation)
    ? (body.conversation as ConversationTurn[])
    : []

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

  if (!classResult.data || !documentResult.data) return fail('BAD_REQUEST', 404)

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

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.4,
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA,
          },
        }),
      },
    )

    if (geminiResponse.status === 429) return fail('RATE_LIMIT', 429)

    if (!geminiResponse.ok) {
      // Logged for developers; never surfaced to the student.
      console.error('[ai-assist] gemini error', geminiResponse.status, await geminiResponse.text())
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
      return fail('INVALID_RESPONSE', 502)
    }

    const result = parseAiResponse(text, mode)
    if (!result) {
      console.error('[ai-assist] unparsable model output', text.slice(0, 800))
      return fail('INVALID_RESPONSE', 502)
    }

    console.log('[ai-assist] ok', { mode, promptVersion: AI_PROMPT_VERSION, userId })

    return new Response(JSON.stringify(result), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') return fail('TIMEOUT', 504)
    console.error('[ai-assist] unexpected failure', error)
    return fail('UPSTREAM_ERROR', 500)
  } finally {
    clearTimeout(timeout)
  }
})
