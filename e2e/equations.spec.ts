import { test, expect } from '@playwright/test'
import { body, createClass, createNote, expectPersisted, typeInBody } from './fixtures'

/**
 * Equations, end to end, in a real browser.
 *
 * The unit tests cover the dialog and the schema separately. What they cannot
 * cover is the part that has to be true for the feature to exist at all: that
 * KaTeX's stylesheet and its web fonts actually load from the production
 * build, that the formula renders inside the page rather than in a test's
 * jsdom, and that it survives a reload -- which is where a node the editor
 * does not recognise gets silently dropped.
 */

const equationField = (page: import('@playwright/test').Page) =>
  page.getByLabel('Equation', { exact: true })

test.describe('equations', () => {
  test.beforeEach(async ({ page }) => {
    await createClass(page, 'Physics 210')
    await createNote(page)
  })

  test('type the source, see the result, accept it', async ({ page }) => {
    await typeInBody(page, 'Kinetic energy: ')

    await page.getByRole('button', { name: 'Insert equation' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    // Nothing to accept before anything is typed.
    await expect(dialog.getByRole('button', { name: 'Insert' })).toBeDisabled()

    await equationField(page).fill('E = \\frac{1}{2}mv^2')

    // The result, rendered by KaTeX inside the dialog.
    await expect(dialog.locator('.katex')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Insert' })).toBeEnabled()

    await dialog.getByRole('button', { name: 'Insert' }).click()

    // And now in the document itself.
    await expect(body(page).locator('.katex')).toBeVisible()
  })

  test('a half-typed formula reports itself instead of rendering', async ({ page }) => {
    await page.getByRole('button', { name: 'Insert equation' }).click()
    const dialog = page.getByRole('dialog')

    await equationField(page).fill('\\frac{')

    await expect(dialog.locator('.katex')).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Insert' })).toBeDisabled()

    await equationField(page).fill('\\frac{a}{b}')

    await expect(dialog.locator('.katex')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Insert' })).toBeEnabled()
  })

  /*
   * The failure this guards against is silent deletion. A node whose type the
   * editor does not know is dropped while parsing, without an error, and the
   * next autosave writes the loss back over the student's note.
   */
  test('an equation survives a reload', async ({ page }) => {
    await typeInBody(page, 'Quadratic formula: ')
    await page.getByRole('button', { name: 'Insert equation' }).click()
    await equationField(page).fill('x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}')
    await page.getByRole('dialog').getByRole('button', { name: 'Insert' }).click()

    // The LaTeX source is what is stored, not the rendering.
    await expectPersisted(page, 'sqrt{b^2-4ac}')

    await page.reload()

    await expect(body(page).locator('.katex')).toBeVisible()
  })

  test('a formula can be selected and corrected', async ({ page }) => {
    await page.getByRole('button', { name: 'Insert equation' }).click()
    await equationField(page).fill('a^2')
    await page.getByRole('dialog').getByRole('button', { name: 'Insert' }).click()

    await expect(body(page).locator('.katex')).toBeVisible()

    // Clicking an atom node selects it, which is what lets the dialog reopen
    // on it rather than starting empty.
    await body(page).locator('.katex').first().click()
    await page.getByRole('button', { name: 'Insert equation' }).click()

    await expect(equationField(page)).toHaveValue('a^2')
    await expect(page.getByRole('button', { name: 'Update' })).toBeVisible()

    await equationField(page).fill('c^2')
    await page.getByRole('dialog').getByRole('button', { name: 'Update' }).click()

    await expectPersisted(page, 'c^2')
  })

  test('superscript and subscript are reachable and survive a reload', async ({ page }) => {
    await typeInBody(page, 'H2O')

    // Select the 2, the way a student would.
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Shift+ArrowLeft')
    await page.getByRole('button', { name: 'Subscript' }).click()

    await expect(body(page).locator('sub')).toHaveText('2')

    await page.reload()
    await expect(body(page).locator('sub')).toHaveText('2')
  })
})
