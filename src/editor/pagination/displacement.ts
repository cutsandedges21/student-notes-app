/**
 * Converts measured coordinates back into natural ones.
 *
 * Measuring happens with the previous pass's spacers still in the DOM, because
 * pulling them out first would cost two extra layouts and could clamp the
 * scroll position under the reader. Instead every spacer's net displacement is
 * recorded when it is applied, and subtracted back out here -- which is exact,
 * and needs no DOM writes at all.
 */

export interface Displacement {
  /** Document position the spacer is anchored to. */
  pos: number
  /** Net vertical displacement it adds to everything at or after `pos`. */
  delta: number
}

export class DisplacementIndex {
  /** Sorted spacer positions. */
  private readonly positions: number[]
  /** `prefix[i]` is the summed delta of the first `i` entries. */
  private readonly prefix: number[]

  constructor(entries: readonly Displacement[] = []) {
    const sorted = [...entries].sort((a, b) => a.pos - b.pos)
    this.positions = sorted.map((entry) => entry.pos)
    this.prefix = new Array(sorted.length + 1)
    this.prefix[0] = 0
    for (let i = 0; i < sorted.length; i += 1) {
      this.prefix[i + 1] = this.prefix[i] + sorted[i].delta
    }
  }

  get isEmpty(): boolean {
    return this.positions.length === 0
  }

  /**
   * Total displacement applied to content sitting at document position `pos`.
   *
   * A spacer anchored exactly at `pos` counts: it renders immediately before
   * that content and pushes it down.
   */
  before(pos: number): number {
    return this.prefix[this.countUpTo(pos)]
  }

  /**
   * Displacement contributed by spacers strictly inside `(from, to)` -- that
   * is, the amount by which a block's measured height overstates its natural
   * height because a line break was inserted within it.
   */
  within(from: number, to: number): number {
    return this.prefix[this.countUpTo(to - 1)] - this.prefix[this.countUpTo(from)]
  }

  /** Number of entries with a position of at most `pos`. */
  private countUpTo(pos: number): number {
    let low = 0
    let high = this.positions.length
    while (low < high) {
      const mid = (low + high) >> 1
      if (this.positions[mid] <= pos) low = mid + 1
      else high = mid
    }
    return low
  }
}

export const EMPTY_DISPLACEMENT = new DisplacementIndex()
