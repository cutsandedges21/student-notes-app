import { describe, it, expect } from 'vitest'
import { normaliseAiResponse } from './aiResponse'

/**
 * The boundary that was a cast.
 *
 * `data as AiResponse` is a promise the compiler cannot keep. Adding `sources`
 * and `proposed_actions` to the type turned every reply from an edge function
 * that had not been redeployed into a blank screen, because the card reads
 * `result.sources.length` and an older server does not send the field.
 *
 * The first test here is that exact payload.
 */

describe('normaliseAiResponse', () => {
  /** Precisely what a server from before sources and actions returns. */
  it('accepts a reply from an older deployment', () => {
    const older = {
      mode: 'CHAT',
      response: 'Oxygen is the final electron acceptor.',
      proposed_content: null,
      issues: [],
      added_information: [],
    }

    const result = normaliseAiResponse(older, 'CHAT')

    expect(result).not.toBeNull()
    // The fields the UI reads unconditionally must exist, or it throws.
    expect(result!.sources).toEqual([])
    expect(result!.proposed_actions).toEqual([])
  })

  it('accepts a reply missing everything but the prose', () => {
    const result = normaliseAiResponse({ response: 'An answer.' }, 'CHAT')

    expect(result).toMatchObject({
      response: 'An answer.',
      mode: 'CHAT',
      proposed_content: null,
      issues: [],
      added_information: [],
      sources: [],
      proposed_actions: [],
    })
  })

  it('refuses a reply with no answer in it', () => {
    expect(normaliseAiResponse({ response: '' }, 'CHAT')).toBeNull()
    expect(normaliseAiResponse({ response: '   ' }, 'CHAT')).toBeNull()
    expect(normaliseAiResponse({}, 'CHAT')).toBeNull()
    expect(normaliseAiResponse(null, 'CHAT')).toBeNull()
    expect(normaliseAiResponse('a string', 'CHAT')).toBeNull()
  })

  it('keeps a well-formed reply intact', () => {
    const full = {
      mode: 'CHECK_NOTES',
      response: 'Two things to check.',
      proposed_content: 'A tidier version.',
      issues: [
        { original: 'chloroplast', problem: 'Wrong organelle.', correction: 'mitochondrion', confidence: 'high' },
      ],
      added_information: ['ATP yield is about 30.'],
      sources: [{ documentId: 'd1', title: 'Lecture 4', className: 'Biology' }],
      proposed_actions: [
        { kind: 'create_note', title: 'Study guide', content: '# Guide', reason: 'Pulls it together.' },
      ],
    }

    expect(normaliseAiResponse(full, 'CHECK_NOTES')).toEqual(full)
  })

  describe('issues', () => {
    it('drops one with nothing to anchor to', () => {
      const result = normaliseAiResponse(
        { response: 'x', issues: [{ problem: 'Vague', correction: 'y', confidence: 'high' }] },
        'CHECK_NOTES',
      )

      expect(result!.issues).toEqual([])
    })

    /** A confidence the card does not know would assert one never expressed. */
    it('reads an unknown confidence as the most cautious one', () => {
      const result = normaliseAiResponse(
        {
          response: 'x',
          issues: [{ original: 'a', problem: 'b', correction: 'c', confidence: 'banana' }],
        },
        'CHECK_NOTES',
      )

      expect(result!.issues[0].confidence).toBe('low')
    })

    it('is not fooled by issues that are not a list', () => {
      const result = normaliseAiResponse({ response: 'x', issues: 'lots' }, 'CHECK_NOTES')
      expect(result!.issues).toEqual([])
    })
  })

  describe('sources', () => {
    /** The UI turns these into links; one with no id goes nowhere. */
    it('drops a citation with no id or no title', () => {
      const result = normaliseAiResponse(
        {
          response: 'x',
          sources: [
            { documentId: 'd1', title: 'Good' },
            { documentId: '', title: 'No id' },
            { documentId: 'd2', title: '' },
            'not an object',
          ],
        },
        'CHAT',
      )

      expect(result!.sources).toEqual([{ documentId: 'd1', title: 'Good', className: '' }])
    })
  })

  describe('proposed actions', () => {
    it('drops an offer with no content to create', () => {
      const result = normaliseAiResponse(
        {
          response: 'x',
          proposed_actions: [
            { kind: 'create_note', title: 'Real', content: '# Yes', reason: '' },
            { kind: 'create_note', title: 'Empty', content: '' },
            { kind: 'delete_everything', title: 'No', content: 'No' },
          ],
        },
        'CHAT',
      )

      expect(result!.proposed_actions).toEqual([
        { kind: 'create_note', title: 'Real', content: '# Yes', reason: '' },
      ])
    })

    /** A kind this build does not implement must not reach a button. */
    it('ignores an action kind it does not know', () => {
      const result = normaliseAiResponse(
        { response: 'x', proposed_actions: [{ kind: 'rewrite_everything', title: 'a', content: 'b' }] },
        'CHAT',
      )

      expect(result!.proposed_actions).toEqual([])
    })
  })

  it('treats whitespace-only proposed content as no proposal', () => {
    const result = normaliseAiResponse({ response: 'x', proposed_content: '   ' }, 'IMPROVE_NOTES')
    expect(result!.proposed_content).toBeNull()
  })

  it('falls back to the requested mode when the reply omits one', () => {
    const result = normaliseAiResponse({ response: 'x' }, 'EXPLAIN')
    expect(result!.mode).toBe('EXPLAIN')
  })
})
