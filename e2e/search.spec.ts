import { test, expect } from '@playwright/test'
import { createClass, createNote, expectPersisted, titleInput, typeInBody } from './fixtures'

/**
 * Search across every note, in a real browser.
 *
 * Guest notes make this testable without credentials: the same dialog runs
 * against localStorage instead of Postgres, through the same pure ranking and
 * snippet code, so what is checked here is the part both paths share -- and
 * the navigation, which no unit test can exercise for real.
 */

const search = (page: import('@playwright/test').Page) =>
  page.getByRole('searchbox', { name: 'Search your notes' })

test.describe('search', () => {
  test.beforeEach(async ({ page }) => {
    await createClass(page, 'Biology 101')

    await createNote(page)
    await titleInput(page).fill('Osmosis and diffusion')
    await typeInBody(page, 'Water moves across a semipermeable membrane.')
    await expectPersisted(page, 'semipermeable')

    await page.goto('/classes')
  })

  test('finds a note by a word in its body and opens it', async ({ page }) => {
    await page.getByRole('button', { name: 'Search your notes' }).click()
    await search(page).fill('semipermeable')

    const hit = page.getByRole('button', { name: /Osmosis and diffusion/ })
    await expect(hit).toBeVisible()
    // The class it belongs to, so two notes with the same title can be told
    // apart. Scoped to the dialog: the page behind it lists the class too.
    await expect(hit).toContainText('Biology 101')

    await hit.click()

    await expect(page.getByLabel('Note content')).toContainText('semipermeable')
  })

  test('finds a note by its title', async ({ page }) => {
    await page.getByRole('button', { name: 'Search your notes' }).click()
    await search(page).fill('Osmosis')

    await expect(page.getByRole('button', { name: /Osmosis and diffusion/ })).toBeVisible()
  })

  test('opens on the keyboard, and Enter opens the note', async ({ page }) => {
    await page.getByRole('button', { name: 'Search your notes' }).click()
    await search(page).fill('osmosis')
    await expect(page.getByRole('button', { name: /Osmosis and diffusion/ })).toBeVisible()

    await page.keyboard.press('Enter')

    await expect(page.getByLabel('Note content')).toContainText('semipermeable')
  })

  test('says so when nothing matches', async ({ page }) => {
    await page.getByRole('button', { name: 'Search your notes' }).click()
    await search(page).fill('mitochondria')

    await expect(page.getByText(/No notes match/)).toBeVisible()
  })

  /**
   * `%` is a LIKE wildcard. Unescaped it matches everything, so a student
   * searching for a percentage would get every note back.
   */
  test('treats a percent sign as text, not as a wildcard', async ({ page }) => {
    await page.getByRole('button', { name: 'Search your notes' }).click()
    await search(page).fill('%')

    // Below the minimum length, so it does not run at all -- and certainly
    // does not return every note.
    await expect(page.getByText(/at least 2 characters/i)).toBeVisible()

    await search(page).fill('50%')
    await expect(page.getByText(/No notes match/)).toBeVisible()
  })
})
