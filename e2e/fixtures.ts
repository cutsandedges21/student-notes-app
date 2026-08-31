import { expect, type Page } from '@playwright/test'

/**
 * Shared setup for the E2E suite.
 *
 * Everything here runs signed out. Guest mode is a fully working app backed by
 * localStorage, which means these tests need no credentials, no seeded
 * database and no network -- an E2E suite that needs live secrets is one that
 * stops being run.
 *
 * The trade-off is that the Supabase-only paths (real accounts, sharing, the
 * AI endpoint) are not covered here. Those need a seeded project and belong in
 * a separate suite.
 */

/** Autosave debounce is 1s; allow for the write behind it. */
export const AUTOSAVE_SETTLE_MS = 2_000

/** Creates a class and opens it, leaving the page on the class's note list. */
export async function createClass(page: Page, name: string): Promise<void> {
  await page.goto('/classes')
  await page.getByRole('button', { name: 'Create class' }).first().click()
  await page.getByLabel('Class name').fill(name)
  // The dialog's submit, not the page button that opened it.
  await page.getByRole('button', { name: 'Create class' }).last().click()

  // Creating lands back on the list; the card is a link into the class.
  await page.getByRole('link').filter({ hasText: name }).first().click()
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible()
}

export async function createNote(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'New note' }).first().click()
  await expect(page.getByLabel('Note content')).toBeVisible()
}

/** The editor body. Named once so a class change does not break every spec. */
export const body = (page: Page) => page.getByLabel('Note content')
export const titleInput = (page: Page) => page.locator('#doc-title')

export async function typeInBody(page: Page, text: string): Promise<void> {
  await body(page).click()
  await page.keyboard.type(text)
}

export const headerArea = (page: Page) => page.getByLabel('Header area')
export const headerContent = (page: Page) => page.getByLabel('Header content')

/**
 * Enters the header and types into it.
 *
 * The focus assertion is not decoration. Double-clicking a zone sets React
 * state; the zone then re-renders, and only in the resulting effect does
 * Tiptap take focus. Typing straight after the double-click races that, and
 * the race is not clean -- the first characters land nowhere and the rest
 * arrive, so the note ends up holding a truncated header and the test fails
 * somewhere unrelated. Waiting for focus is what makes it deterministic.
 */
export async function typeInHeader(page: Page, text: string): Promise<void> {
  await headerArea(page).dblclick()
  await expect(headerContent(page)).toBeFocused()
  await page.keyboard.type(text)
}

/**
 * Waits for the save indicator to settle rather than sleeping a fixed time.
 *
 * "Saved" is the app's own claim that the write happened, so asserting on it
 * also asserts that the claim is being made -- which is the thing that used to
 * be a lie when storage refused the write.
 */
export async function expectSaved(page: Page): Promise<void> {
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({
    timeout: AUTOSAVE_SETTLE_MS + 3_000,
  })
}

/**
 * Waits until the text is actually in storage, not merely on screen.
 *
 * `expectSaved` is not enough on its own: "Saved" stays visible from the
 * previous save, so an assertion on it can pass before the current edit has
 * been written at all. That is exactly the gap a reload falls through, so the
 * check has to read what was stored rather than what is claimed.
 */
export async function expectPersisted(page: Page, text: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => localStorage.getItem('margin.guest.documents') ?? ''),
      { timeout: AUTOSAVE_SETTLE_MS + 3_000, message: `waiting for "${text}" to reach storage` },
    )
    .toContain(text)
}
