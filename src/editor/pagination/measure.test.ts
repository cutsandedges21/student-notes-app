import { describe, expect, it } from 'vitest'
import { toLineBoxes, type GlyphRun } from './measure'

/*
 * The line-box reconstruction, tested on its own because both of the bugs
 * found while bringing the engine up in a browser lived here, and neither was
 * visible from the page count -- one put every page a few pixels off its band,
 * the other walked the split further up the paragraph on each pass.
 *
 * The numbers below are Arial 11pt at line-height 1.75: a 25.67px line box
 * holding a 17px glyph rect, so 4.33px of half-leading above and below.
 */

const LINE = 25.67
const GLYPH = 17
const HALF_LEADING = (LINE - GLYPH) / 2

/** Glyph rects as `Range.getClientRects` reports them: text, not line boxes. */
function glyphs(count: number, firstTop = 100): GlyphRun[] {
  return Array.from({ length: count }, (_, index) => ({
    pos: 10 + index,
    top: firstTop + index * LINE,
    bottom: firstTop + index * LINE + GLYPH,
  }))
}

describe('toLineBoxes', () => {
  it('recovers the line box from the glyph rect, not the other way round', () => {
    const [first, second] = toLineBoxes(glyphs(3))

    // The break belongs at the top of the box, half a leading above the text.
    expect(first.top).toBeCloseTo(100 - HALF_LEADING, 4)
    expect(second.top).toBeCloseTo(100 + LINE - HALF_LEADING, 4)
  })

  it('produces boxes that tile the paragraph with no gaps', () => {
    const boxes = toLineBoxes(glyphs(6))

    for (let index = 1; index < boxes.length; index += 1) {
      expect(boxes[index].top).toBeCloseTo(boxes[index - 1].bottom, 4)
    }
    for (const box of boxes) {
      expect(box.bottom - box.top).toBeCloseTo(LINE, 4)
    }
  })

  it('keeps the document positions it was handed', () => {
    expect(toLineBoxes(glyphs(4)).map((box) => box.pos)).toEqual([10, 11, 12, 13])
  })

  /*
   * Regression. A spacer inserted inside a paragraph on an earlier pass opens
   * a several-hundred-pixel gap between two glyph runs. Read as leading, it
   * would place the following line's box top hundreds of pixels above the
   * text -- and since each pass measured the spacer it had just inserted, the
   * split walked further up the paragraph every time instead of settling.
   *
   * Measurements reach this function already converted to natural
   * coordinates, so the gap is gone; the clamp is the second line of defence
   * if anything else ever opens one.
   */
  it('does not read an outsized gap as leading', () => {
    const runs = glyphs(4)
    runs[2].top += 400
    runs[2].bottom += 400

    const boxes = toLineBoxes(runs)

    // At most one glyph height of leading is credited, not 200px of it.
    expect(runs[2].top - boxes[2].top).toBeLessThanOrEqual(GLYPH)
  })

  it('gives the first line the same leading as the rest', () => {
    const boxes = toLineBoxes(glyphs(3))
    expect(boxes[0].bottom - boxes[0].top).toBeCloseTo(LINE, 4)
  })

  it('handles a single-line paragraph and an empty one', () => {
    expect(toLineBoxes([])).toEqual([])

    const [only] = toLineBoxes(glyphs(1))
    // Nothing to infer leading from, so the glyph rect is used as-is rather
    // than guessed at.
    expect(only.top).toBe(100)
    expect(only.bottom).toBe(100 + GLYPH)
  })
})
