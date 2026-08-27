import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MenuButton } from './MenuButton'

describe('MenuButton', () => {
  it('keeps the menu closed until the trigger is activated', () => {
    render(
      <MenuButton label="Class options" items={[{ label: 'Rename', onSelect: vi.fn() }]} />,
    )
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('opens the menu and reports expanded state', async () => {
    render(
      <MenuButton label="Class options" items={[{ label: 'Rename', onSelect: vi.fn() }]} />,
    )
    const trigger = screen.getByRole('button', { name: 'Class options' })
    await userEvent.click(trigger)

    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })

  it('runs the selected item and closes the menu', async () => {
    const onSelect = vi.fn()
    render(<MenuButton label="Class options" items={[{ label: 'Rename', onSelect }]} />)

    await userEvent.click(screen.getByRole('button', { name: 'Class options' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))

    expect(onSelect).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    render(
      <MenuButton label="Class options" items={[{ label: 'Rename', onSelect: vi.fn() }]} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Class options' }))
    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
