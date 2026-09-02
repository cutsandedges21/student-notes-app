import { describe, it, expect } from 'vitest'
import { AI_PROMPT_VERSION } from '../prompts/studentAssistant.ts'
import { EVAL_CASES } from './cases.ts'

/**
 * The gate that makes the eval suite mean something.
 *
 * The evals need a real key, so CI cannot run them — which would make them a
 * file nobody opens. This runs everywhere and fails when the prompt has moved
 * on from the last version the evals were actually run against.
 *
 * The failure is the point. It cannot check that anybody ran them; it can make
 * changing the prompt require saying, in a commit, that they were run and what
 * happened. That is the difference between a suite and an intention.
 *
 * ## When this fails
 *
 * 1. Run the evals against the new prompt:
 *      GEMINI_API_KEY=... npx vitest run supabase/functions/ai-assist/evals
 * 2. Fix whatever regressed, or add a case if the change was deliberate.
 * 3. Move EVALS_WRITTEN_FOR_PROMPT_VERSION to match, in the same commit.
 *
 * Skipping step 1 while moving the constant is lying to the next person, who
 * will read a green suite as evidence the assistant still refuses injected
 * instructions.
 */

/**
 * The prompt version the cases in `cases.ts` were written against.
 *
 * Named for what it can honestly assert. It was `REVIEWED_AT` for one commit,
 * which claimed something this file cannot check and which was not true: there
 * is no Gemini key in this environment, so the cases have never been executed
 * at any version. A constant that quietly overstates itself is exactly the
 * kind of thing the rest of this programme has been removing.
 *
 * What it does enforce is still the useful half: the prompt cannot move
 * without somebody opening this file, and the cases cannot silently fall
 * behind a behaviour that was added after them.
 *
 * 1.4.0 — tools, citations, and offering to create a note.
 *
 * **Never executed.** The first person with a key should run them, then record
 * the result here.
 */
const EVALS_WRITTEN_FOR_PROMPT_VERSION = '1.4.0'

describe('eval coverage', () => {
  it('keeps pace with the prompt that ships', () => {
    expect(
      AI_PROMPT_VERSION,
      [
        `The prompt is at ${AI_PROMPT_VERSION}; the eval cases were written for`,
        `${EVALS_WRITTEN_FOR_PROMPT_VERSION}. Add or adjust cases for whatever the`,
        'prompt change was, run them against a real key, then move',
        'EVALS_WRITTEN_FOR_PROMPT_VERSION in this file.',
      ].join(' '),
    ).toBe(EVALS_WRITTEN_FOR_PROMPT_VERSION)
  })

  /*
   * A suite that quietly loses its cases is worse than none, because the gate
   * above keeps passing. These are the categories the brief names, and one of
   * each has to exist.
   */
  it('still covers every behaviour worth guarding', () => {
    const prefixes = EVAL_CASES.map((testCase) => testCase.id.split('/')[0])

    expect(new Set(prefixes)).toEqual(
      new Set(['injection', 'fabrication', 'mode', 'actions']),
    )
  })

  it('gives every case a stable id and a stated intent', () => {
    for (const testCase of EVAL_CASES) {
      expect(testCase.id, 'id').toMatch(/^[a-z]+\/[a-z0-9-]+$/)
      expect(testCase.intent.length, `${testCase.id} intent`).toBeGreaterThan(20)
    }
  })

  it('has no duplicate ids, so a result names one case', () => {
    const ids = EVAL_CASES.map((testCase) => testCase.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
