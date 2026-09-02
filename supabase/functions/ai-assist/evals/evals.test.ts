import { describe, it, expect } from 'vitest'
import { EVAL_CASES } from './cases.ts'
import { AI_PROMPT_VERSION, SYSTEM_PROMPT } from '../prompts/studentAssistant.ts'
import { buildAIContext } from '../context.ts'
import { parseAiResponse } from '../validate.ts'

/**
 * The eval suite.
 *
 * A prompt is code that cannot be typechecked, and the way it breaks is that
 * some behaviour quietly stops: a model that used to refuse an injected
 * instruction starts obeying it, and every other test still passes.
 *
 * Needs a real key, so it is a gate somebody runs rather than one CI runs for
 * free:
 *
 *   GEMINI_API_KEY=... npx vitest run supabase/functions/ai-assist/evals
 *
 * Run it when AI_PROMPT_VERSION changes. `promptVersion.test.ts` is what makes
 * that hard to forget.
 *
 * Model output is not deterministic, so these are written to catch behaviour
 * rather than wording -- "did it obey the injected command", not "did it
 * phrase the answer this way". A case that needs an exact string is a case
 * that will fail for the wrong reason.
 */

const API_KEY = process.env.GEMINI_API_KEY
const MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.6-flash'

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
    sources: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          documentId: { type: 'STRING' },
          title: { type: 'STRING' },
          className: { type: 'STRING' },
        },
        required: ['documentId', 'title'],
      },
    },
  },
  required: ['mode', 'response', 'issues', 'added_information'],
}

const klass = {
  name: 'Biology 101',
  course_code: 'BIO 101',
  professor: 'Dr. Chen',
  semester: 'Fall 2026',
  course_level: 'College',
}

describe.skipIf(!API_KEY)(`assistant behaviour (prompt ${AI_PROMPT_VERSION})`, () => {
  for (const testCase of EVAL_CASES) {
    it(
      `${testCase.id} — ${testCase.intent}`,
      { timeout: 90_000 },
      async () => {
        // The real context builder, so the fence and the section order under
        // test are the ones that ship.
        const prompt = buildAIContext({
          mode: testCase.mode,
          klass,
          document: { title: 'Lecture 5', content_text: testCase.noteText },
          selectedText: testCase.selectedText,
          userRequest: testCase.question,
          siblings: [],
          conversation: [],
        })

        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY! },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              generationConfig: {
                // Lower than production on purpose: an eval should measure the
                // prompt, not the sampling.
                temperature: 0,
                responseMimeType: 'application/json',
                responseSchema: RESPONSE_SCHEMA,
              },
            }),
          },
        )

        expect(response.ok, `HTTP ${response.status}`).toBe(true)

        const payload = await response.json()
        const text = (payload?.candidates?.[0]?.content?.parts ?? [])
          .map((part: { text?: unknown }) => part?.text)
          .find((value: unknown): value is string => typeof value === 'string')

        const parsed = parseAiResponse(text ?? '', testCase.mode)
        expect(parsed, 'model output failed validation').not.toBeNull()

        // The failure message is the case's own words, so a red eval says what
        // behaviour was lost rather than which assertion tripped.
        expect(testCase.check(parsed!)).toBeNull()
      },
    )
  }
})
