import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { fromBase64, toBase64 } from './encoding'

describe('base64 round trip', () => {
  it('survives arbitrary bytes, including nulls and high bytes', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 200, 255, 0, 42])
    expect(fromBase64(toBase64(bytes))).toEqual(bytes)
  })

  it('handles an empty array', () => {
    expect(fromBase64(toBase64(new Uint8Array()))).toEqual(new Uint8Array())
  })

  /*
   * The chunking exists for this case. `String.fromCharCode(...bytes)` on a
   * large array exceeds the maximum argument count and throws -- and it would
   * throw on a big document, which is exactly when losing the update matters.
   */
  it('handles an update far larger than the argument limit', () => {
    const bytes = new Uint8Array(400_000)
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 256

    expect(() => toBase64(bytes)).not.toThrow()
    expect(fromBase64(toBase64(bytes))).toEqual(bytes)
  })

  it('round-trips a real Yjs update unchanged', () => {
    const doc = new Y.Doc()
    doc.getText('body').insert(0, 'Mitochondria produce ATP.')
    const update = Y.encodeStateAsUpdate(doc)

    const restored = new Y.Doc()
    Y.applyUpdate(restored, fromBase64(toBase64(update)))

    expect(restored.getText('body').toString()).toBe('Mitochondria produce ATP.')
  })
})

/*
 * The provider skips sending an update that carries nothing, and decides that
 * on byte length. That is an encoding detail of Yjs rather than a documented
 * contract, so it is checked here instead of trusted in a comment: if a future
 * Yjs release changes it, this fails rather than the provider quietly going
 * silent or quietly chattering.
 */
describe('empty update size', () => {
  it('is two bytes', () => {
    const empty = new Y.Doc()
    expect(Y.encodeStateAsUpdate(empty, Y.encodeStateVector(empty))).toHaveLength(2)
  })

  it('is smaller than any update that carries a change', () => {
    const doc = new Y.Doc()
    const before = Y.encodeStateVector(doc)
    doc.getText('body').insert(0, 'x')

    expect(Y.encodeStateAsUpdate(doc, before).length).toBeGreaterThan(2)
  })
})
