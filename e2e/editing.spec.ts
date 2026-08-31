import { test, expect } from '@playwright/test'
import {
  body,
  createClass,
  createNote,
  expectPersisted,
  expectSaved,
  titleInput,
  typeInBody,
} from './fixtures'

test.describe('editing and persistence', () => {
  test.beforeEach(async ({ page }) => {
    await createClass(page, 'Biology 101')
    await createNote(page)
  })

  // The baseline promise of a notes app.
  test('typed content survives a reload', async ({ page }) => {
    await typeInBody(page, 'Mitochondria produce ATP.')
    await expectSaved(page)

    await page.reload()

    await expect(body(page)).toContainText('Mitochondria produce ATP.')
  })

  /*
   * The rename bug, end to end.
   *
   * A note's address used to carry only its slug, and every save re-slugged
   * from the title. Typing a title therefore changed the address mid-sentence:
   * the router navigated, the load effect re-ran, and the reloaded content was
   * pushed back into the editor -- resetting the caret and racing whatever was
   * still being typed. A rename could eat a sentence.
   *
   * This is the test jsdom could not write, because the failure was about
   * where the caret physically ended up.
   */
  test('renaming does not disturb the body or move the caret', async ({ page }) => {
    await typeInBody(page, 'Start of the note. ')
    await expectSaved(page)

    await titleInput(page).click()
    await titleInput(page).fill('Lecture 5 — Cellular Respiration')
    await expectSaved(page)

    // Straight back into the body and keep going. If the document reloaded
    // under the caret, this lands somewhere else -- or nowhere.
    await body(page).click()
    await page.keyboard.press('End')
    await page.keyboard.type('and the rest of it.')

    await expect(body(page)).toContainText('Start of the note. and the rest of it.')
    await expectPersisted(page, 'and the rest of it.')

    await page.reload()
    await expect(body(page)).toContainText('Start of the note. and the rest of it.')
    await expect(titleInput(page)).toHaveValue('Lecture 5 — Cellular Respiration')
  })

  /*
   * The address is the note's id, so renaming must not change it. This is what
   * keeps an already-shared or bookmarked link working after a rename.
   */
  test('renaming leaves the note at the same address', async ({ page }) => {
    await typeInBody(page, 'Anything.')
    await expectSaved(page)

    const before = page.url()

    await titleInput(page).fill('A completely different title')
    await expectSaved(page)

    expect(page.url()).toBe(before)
  })

  test('an old slug-only link still opens the note', async ({ page }) => {
    await typeInBody(page, 'Reachable by an old link.')
    await titleInput(page).fill('Lecture 5')
    await expectSaved(page)

    const canonical = page.url()
    // Everything before the `--<id>` is the legacy form of the same address.
    const legacy = canonical.replace(/--[0-9a-f-]{36}$/i, '')
    expect(legacy).not.toBe(canonical)

    await page.goto(legacy)

    await expect(body(page)).toContainText('Reachable by an old link.')
    // ...and is rewritten to the canonical address rather than left stale.
    await expect(page).toHaveURL(canonical)
  })

  /*
   * Autosave debounces for a second. Anything typed inside that window exists
   * only in the editor until the timer fires, so closing the tab or hitting
   * reload straight after a sentence is a real way to lose it -- and it is the
   * moment a student is most likely to do exactly that.
   *
   * Deliberately no wait before reloading: that is the point of the test.
   */
  test('content typed immediately before a reload is not lost', async ({ page }) => {
    await typeInBody(page, 'Typed and immediately reloaded.')
    await page.reload()

    await expect(body(page)).toContainText('Typed and immediately reloaded.')
  })

  test('a second note does not inherit the first note’s content', async ({ page }) => {
    await typeInBody(page, 'Note one body.')
    await titleInput(page).fill('Note one')
    await expectSaved(page)

    await page.getByLabel(/^Back to /).click()
    await createNote(page)

    await expect(body(page)).not.toContainText('Note one body.')
  })
})
