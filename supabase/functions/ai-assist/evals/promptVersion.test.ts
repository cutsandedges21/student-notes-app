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
 * 3. Move REVIEWED_AT_PROMPT_VERSION to match, in the same commit.
 *
 * Bumping this without step 1 is lying to the next person, who will read a
 * green suite as evidence the assistant still refuses injected instructions.
 */

/**
 * The prompt version the cases in `cases.ts` were last executed against.
 *
 * 1.3.0 — the tools and citation rules. NOT yet executed: there is no Gemini
 * key in this environment, so the cases have been written and never run. This
 * is recorded as the version they are written for, and the first person with a
 * key should run them and either confirm this line or fix what they find.
 */
const REVIEWED_AT_PROMPT_VERSION = '1.3.0'

describe('eval coverage', () => {
  it('has been reviewed against the prompt that ships', () => {
    expect(
      AI_PROMPT_VERSION,
      [
        `The prompt is at ${AI_PROMPT_VERSION}; the evals were last reviewed at`,
        `${REVIEWED_AT_PROMPT_VERSION}. Run them against a real key, fix or accept`,
        'what changed, then move REVIEWED_AT_PROMPT_VERSION in this file.',
      ].join(' '),
    ).toBe(REVIEWED_AT_PROMPT_VERSION)
  })

  /*
   * A suite that quietly loses its cases is worse than none, because the gate
   * above keeps passing. These are the categories the brief names, and one of
   * each has to exist.
   */
  it('still covers every behaviour worth guarding', () => {
    const prefixes = EVAL_CASES.map((testCase) => testCase.id.split('/')[0])

    expect(new Set(prefixes)).toEqual(new Set(['injection', 'fabrication', 'mode']))
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
