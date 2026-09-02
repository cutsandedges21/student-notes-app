import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PageSetupDialog } from './PageSetupDialog'
import { A4, DEFAULT_PAGE_SETUP, INCH } from './pagination/geometry'

/**
 * Page setup.
 *
 * A4 is the paper almost everywhere outside the US, and until now only Letter
 * was reachable -- so for most students the app printed onto the wrong sheet.
 */

function setup(over: Partial<Parameters<typeof PageSetupDialog>[0]> = {}) {
  const onApply = vi.fn()
  const onClose = vi.fn()
  render(
    <PageSetupDialog
      open
      setup={DEFAULT_PAGE_SETUP}
      onApply={onApply}
      onClose={onClose}
      {...over}
    />,
  )
  return { onApply, onClose, user: userEvent.setup() }
}

const apply = () => screen.getByRole('button', { name: 'Apply' })
const margin = (side: string) => screen.getByLabelText(side)

describe('PageSetupDialog', () => {
  it('opens on the note’s current setup', () => {
    setup({
      setup: { paper: 'a4', landscape: true, margins: DEFAULT_PAGE_SETUP.margins },
    })

    expect(screen.getByLabelText('Paper size')).toHaveValue('a4')
    expect(screen.getByLabelText('Landscape')).toBeChecked()
  })

  it('changes the paper', async () => {
    const { user, onApply } = setup()

    await user.selectOptions(screen.getByLabelText('Paper size'), 'a4')
    await user.click(apply())

    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ paper: 'a4', landscape: false }),
    )
  })

  it('turns the page', async () => {
    const { user, onApply } = setup()

    await user.click(screen.getByLabelText('Landscape'))
    await user.click(apply())

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ landscape: true }))
  })

  /** Inches are what the ruler shows and what a coursework brief specifies. */
  it('takes margins in inches and hands back pixels', async () => {
    const { user, onApply } = setup()

    await user.clear(margin('Top'))
    await user.type(margin('Top'), '0.5')
    await user.click(apply())

    expect(onApply.mock.calls[0][0].margins.top).toBe(INCH / 2)
  })

  it('refuses margins that leave no room for text', async () => {
    const { user, onApply } = setup()

    await user.clear(margin('Left'))
    await user.type(margin('Left'), '9')

    expect(apply()).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(/no room for text/i)

    await user.click(apply())
    expect(onApply).not.toHaveBeenCalled()
  })

  /**
   * The same margins can be fine on one paper and impossible on another, so
   * the check has to be against the paper actually chosen.
   */
  it('judges margins against the chosen paper', async () => {
    const { user } = setup()

    // 4.2in each side fits Letter landscape (11in wide) but not A4 portrait
    // (8.27in wide).
    await user.clear(margin('Left'))
    await user.type(margin('Left'), '4.2')
    await user.clear(margin('Right'))
    await user.type(margin('Right'), '4.2')

    await user.selectOptions(screen.getByLabelText('Paper size'), 'a4')
    expect(apply()).toBeDisabled()

    await user.click(screen.getByLabelText('Landscape'))
    expect(apply()).toBeEnabled()
  })

  it('refuses a negative margin', async () => {
    const { user } = setup()

    await user.clear(margin('Bottom'))
    await user.type(margin('Bottom'), '-1')

    expect(apply()).toBeDisabled()
  })

  /**
   * Clearing a field to retype it must not be read as zero: the page would
   * jump to full width under the cursor on the way to the intended value.
   */
  it('does not treat a half-typed margin as a value', async () => {
    const { user, onApply } = setup()

    await user.clear(margin('Top'))

    expect(apply()).toBeDisabled()
    expect(onApply).not.toHaveBeenCalled()
  })

  it('resets to the defaults', async () => {
    const { user, onApply } = setup({
      setup: { paper: 'legal', landscape: true, margins: { top: 12, right: 12, bottom: 12, left: 12 } },
    })

    await user.click(screen.getByRole('button', { name: 'Reset' }))
    await user.click(apply())

    expect(onApply).toHaveBeenCalledWith(DEFAULT_PAGE_SETUP)
  })

  it('lists every paper the engine understands', () => {
    setup()

    const options = screen.getAllByRole('option').map((node) => node.getAttribute('value'))
    expect(options).toEqual(expect.arrayContaining(['letter', 'a4', 'legal']))
  })

  it('names A4 by its real dimensions', () => {
    setup()

    expect(screen.getByRole('option', { name: /210 × 297 mm/ })).toBeInTheDocument()
    expect(A4.pageWidth).toBe(794)
  })
})
