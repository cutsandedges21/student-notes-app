import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TableGridPicker } from './TableGridPicker'

describe('TableGridPicker', () => {
  it('reports the swept size when a cell is clicked', async () => {
    const onSelect = vi.fn()
    render(<TableGridPicker onSelect={onSelect} />)

    await userEvent.click(screen.getByRole('gridcell', { name: '3 rows by 4 columns' }))

    expect(onSelect).toHaveBeenCalledWith({ rows: 3, cols: 4 })
  })

  it('shows the size under the grid as the pointer moves', async () => {
    render(<TableGridPicker onSelect={vi.fn()} />)

    await userEvent.hover(screen.getByRole('gridcell', { name: '2 rows by 5 columns' }))

    expect(screen.getByText('2 × 5')).toBeInTheDocument()
  })

  it('names the single cell in the singular', () => {
    render(<TableGridPicker onSelect={vi.fn()} />)
    expect(screen.getByRole('gridcell', { name: '1 row by 1 column' })).toBeInTheDocument()
  })

  /*
   * A hundred cells means a hundred tab stops unless the grid holds one. The
   * roving tabindex is the whole reason this is navigable by keyboard at all,
   * so it is worth asserting rather than assuming.
   */
  it('exposes exactly one tab stop', () => {
    render(<TableGridPicker onSelect={vi.fn()} />)

    const tabbable = screen
      .getAllByRole('gridcell')
      .filter((cell) => cell.getAttribute('tabindex') === '0')

    expect(tabbable).toHaveLength(1)
    expect(tabbable[0]).toHaveAccessibleName('1 row by 1 column')
  })

  it('sizes the table with the arrow keys and commits on Enter', async () => {
    const onSelect = vi.fn()
    render(<TableGridPicker onSelect={onSelect} />)

    await userEvent.tab()
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowRight}')
    await userEvent.keyboard('{Enter}')

    expect(onSelect).toHaveBeenCalledWith({ rows: 3, cols: 2 })
  })

  it('does not walk off the edge of the grid', async () => {
    const onSelect = vi.fn()
    render(<TableGridPicker onSelect={onSelect} />)

    await userEvent.tab()
    await userEvent.keyboard('{ArrowUp}{ArrowLeft}')
    await userEvent.keyboard('{Enter}')

    expect(onSelect).toHaveBeenCalledWith({ rows: 1, cols: 1 })
  })
})
