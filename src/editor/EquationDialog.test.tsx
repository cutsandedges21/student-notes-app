import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EquationDialog } from './EquationDialog'

/**
 * The equation dialog is type-source, see-result, accept.
 *
 * The preview is the point: LaTeX is write-only for most students, and asking
 * someone to commit `\frac{-b \pm \sqrt{b^2-4ac}}{2a}` to a document without
 * showing them what it becomes is asking them to guess. So these check that a
 * result appears while typing, that a formula which is not yet valid says so
 * rather than rendering something wrong, and that only a real result can be
 * accepted.
 */

function setup(props: Partial<Parameters<typeof EquationDialog>[0]> = {}) {
  const onSubmit = vi.fn()
  const onClose = vi.fn()
  render(
    <EquationDialog open onSubmit={onSubmit} onClose={onClose} {...props} />,
  )
  return { onSubmit, onClose, user: userEvent.setup() }
}

const field = () => screen.getByLabelText('Equation')
const accept = () => screen.getByRole('button', { name: /insert|update/i })

describe('EquationDialog', () => {
  it('starts with nothing to accept', () => {
    setup()
    expect(screen.getByText(/type an equation above/i)).toBeInTheDocument()
    expect(accept()).toBeDisabled()
  })

  it('renders the equation as it is typed', async () => {
    const { user } = setup()

    await user.click(field())
    await user.paste('a^2 + b^2 = c^2')

    // KaTeX marks its output with this class; its presence is the result.
    expect(document.querySelector('.katex')).not.toBeNull()
    expect(accept()).toBeEnabled()
  })

  it('says what is wrong instead of rendering a half-typed formula', async () => {
    const { user } = setup()

    await user.click(field())
    await user.paste('\\frac{')

    expect(document.querySelector('.katex')).toBeNull()
    expect(accept()).toBeDisabled()
    // KaTeX names the token it choked on; the prefix is stripped.
    expect(screen.queryByText(/^KaTeX parse error/)).toBeNull()
  })

  it('recovers once the formula is completed', async () => {
    const { user } = setup()

    await user.click(field())
    await user.paste('\\frac{')
    expect(accept()).toBeDisabled()

    await user.paste('a}{b}')
    expect(document.querySelector('.katex')).not.toBeNull()
    expect(accept()).toBeEnabled()
  })

  it('hands back the source, not the rendering', async () => {
    const { user, onSubmit } = setup()

    await user.click(field())
    await user.paste('x^2')
    await user.click(accept())

    expect(onSubmit).toHaveBeenCalledWith({ latex: 'x^2', display: false })
  })

  it('accepts on Ctrl+Enter, because Enter belongs to the equation', async () => {
    const { user, onSubmit } = setup()

    await user.click(field())
    await user.paste('x^2')
    await user.keyboard('{Control>}{Enter}{/Control}')

    expect(onSubmit).toHaveBeenCalledWith({ latex: 'x^2', display: false })
  })

  it('will not accept a formula that has no result', async () => {
    const { user, onSubmit } = setup()

    await user.click(field())
    await user.paste('\\frac{')
    await user.keyboard('{Control>}{Enter}{/Control}')

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('opens on an existing equation with its source and its placement', () => {
    setup({ initialLatex: '\\int_0^1 x', initialDisplay: true, editing: true })

    expect(field()).toHaveValue('\\int_0^1 x')
    expect(screen.getByLabelText(/on its own line/i)).toBeChecked()
    expect(screen.getByRole('button', { name: 'Update' })).toBeEnabled()
  })
})
