import { describe, it, expect } from 'vitest'
import { functionDeclarations } from './registry.ts'
import { SYSTEM_PROMPT } from '../prompts/studentAssistant.ts'

/**
 * The two things about tool calling that only Google can answer.
 *
 * 1. Does this model accept `tools` and a `responseSchema` in one request?
 *    Gemini 3 documents the combination as supported and the edge function
 *    depends on it. If it stops being true, or the configured model is older,
 *    every AI request fails -- and it fails at the API, not in a unit test.
 * 2. Does the model actually reach for a tool? Declarations the model never
 *    uses are the same as no tools at all, and the only thing that decides it
 *    is the wording of the descriptions and the system prompt.
 *
 * Skipped without a key, so the ordinary suite stays hermetic and offline.
 * With one, this is the check that the wiring is real:
 *
 *   GEMINI_API_KEY=... npx vitest run supabase/functions/ai-assist/tools/live.test.ts
 *
 * It imports the real declarations rather than restating them, so it cannot
 * pass against a copy that has drifted from what ships.
 */

const API_KEY = process.env.GEMINI_API_KEY
const MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.6-flash'

/** Canned tool answers: what is under test is the conversation, not the SQL. */
function answer(name: string, args: Record<string, unknown>) {
  if (name === 'search_notes') {
    return {
      ok: true,
      data: {
        query: args.query,
        found: 1,
        notes: [
          {
            documentId: '33333333-3333-4333-8333-333333333333',
            title: 'Lecture 4 — Respiration',
            className: 'Biology 101',
            excerpt:
              'The electron transport chain is in the inner mitochondrial membrane. ' +
              'Oxygen is the final electron acceptor.',
          },
        ],
      },
    }
  }
  if (name === 'read_note') {
    return {
      ok: true,
      data: {
        documentId: args.documentId,
        title: 'Lecture 4 — Respiration',
        className: 'Biology 101',
        text: 'Oxygen is the final electron acceptor in the electron transport chain.',
        truncated: false,
      },
    }
  }
  return { ok: false, code: 'NOT_FOUND', error: `There is no tool called ${name}.` }
}

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    mode: { type: 'STRING' },
    response: { type: 'STRING' },
    proposed_content: { type: 'STRING', nullable: true },
    issues: { type: 'ARRAY', items: { type: 'OBJECT', properties: {} } },
    added_information: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['mode', 'response', 'issues', 'added_information'],
}

describe.skipIf(!API_KEY)('gemini, live', () => {
  it(
    'takes tools and a response schema together, and uses them',
    { timeout: 90_000 },
    async () => {
      const contents: unknown[] = [
        {
          role: 'user',
          parts: [
            {
              text: [
                'MODE: CHAT',
                'CLASS: Biology 101',
                'NOTE TITLE: Respiration',
                'STUDENT QUESTION: What did my notes say about the final electron ' +
                  'acceptor? Check my notes before answering.',
              ].join('\n\n'),
            },
          ],
        },
      ]

      let toolCalls = 0
      let text: string | undefined

      for (let round = 0; round <= 4; round += 1) {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY! },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
              contents,
              tools: [{ functionDeclarations: functionDeclarations() }],
              generationConfig: {
                temperature: 0.2,
                responseMimeType: 'application/json',
                responseSchema: RESPONSE_SCHEMA,
              },
            }),
          },
        )

        // A 400 here is the interesting failure: it means this model will not
        // take tools and a schema together, which the edge function assumes.
        expect(
          response.ok,
          `HTTP ${response.status}: ${await response.clone().text()}`,
        ).toBe(true)

        const payload = await response.json()
        const candidate = payload?.candidates?.[0]
        const parts: unknown[] = candidate?.content?.parts ?? []

        const requested = parts
          .map((part) => (part as { functionCall?: { name?: string; args?: unknown } })?.functionCall)
          .filter((call): call is { name: string; args: Record<string, unknown> } =>
            typeof call?.name === 'string',
          )

        if (requested.length === 0) {
          text = parts
            .map((part) => (part as { text?: unknown })?.text)
            .find((value): value is string => typeof value === 'string')
          break
        }

        toolCalls += requested.length
        contents.push(candidate.content)
        contents.push({
          role: 'user',
          parts: requested.map((call) => ({
            functionResponse: {
              name: call.name,
              response: answer(call.name, call.args ?? {}),
            },
          })),
        })
      }

      // Asked point blank to check their notes, it should have.
      expect(toolCalls).toBeGreaterThan(0)
      expect(typeof text).toBe('string')
      expect(() => JSON.parse(text!)).not.toThrow()
    },
  )
})
