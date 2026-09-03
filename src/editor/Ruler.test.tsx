import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Ruler } from './Ruler'

/**
 * The ruler.
 *
 * It listened for mouse events, which never fire for a finger or a stylus --
 * so on every touch screen wide enough to show it (an iPad in landscape, a
 * touchscreen laptop) it was decoration. These drive it with pointer events,
 * which is what covers all three inputs.
 */

function setup(onChange = vi.fn()) {
  render(<Ruler leftMargin={96} rightMargin={96} onChange={onChange} />)
  return { onChange }
}

const leftMarker = () => screen.getByRole('slider', { name: 'Left margin' })

describe('Ruler', () => {
  it('exposes each margin as a slider with its value', () => {
    setup()

    expect(leftMarker()).toHaveAttribute('aria-valuenow', '96')
    expect(screen.getByRole('slider', { name: 'Right margin' })).toBeVisible()
  })

  it('drags with a pointer, which is what a finger sends', () => {
    const { onChange } = setup()

    fireEvent.pointerDown(leftMarker())
    fireEvent.pointerMove(document, { clientX: 200 })

    expect(onChange).toHaveBeenCalled()
  })

  it('stops when the pointer is released', () => {
    const { onChange } = setup()

    fireEvent.pointerDown(leftMarker())
    fireEvent.pointerUp(document)
    onChange.mockClear()
    fireEvent.pointerMove(document, { clientX: 300 })

    expect(onChange).not.toHaveBeenCalled()
  })

  /**
   * A touch that becomes a browser gesture is cancelled rather than released.
   * Without this the marker stays stuck to a finger that has gone.
   */
  it('stops when the touch is cancelled rather than released', () => {
    const { onChange } = setup()

    fireEvent.pointerDown(leftMarker())
    fireEvent.pointerCancel(document)
    onChange.mockClear()
    fireEvent.pointerMove(document, { clientX: 300 })

    expect(onChange).not.toHaveBeenCalled()
  })

  it('moves on the arrow keys, for anyone not using a pointer at all', () => {
    const { onChange } = setup()

    fireEvent.keyDown(leftMarker(), { key: 'ArrowRight' })

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ left: 104 }))
  })

  it('will not drag a margin past the other one', () => {
    const onChange = vi.fn()
    render(<Ruler leftMargin={96} rightMargin={96} onChange={onChange} />)

    fireEvent.pointerDown(leftMarker())
    // Far beyond the right margin.
    fireEvent.pointerMove(document, { clientX: 5000 })

    const { left } = onChange.mock.calls.at(-1)![0]
    expect(left).toBeLessThan(816 - 96)
  })
})
