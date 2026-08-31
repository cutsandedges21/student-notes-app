import { test, expect } from '@playwright/test'
import {
  body,
  createClass,
  createNote,
  expectPersisted,
  headerContent,
  titleInput,
  typeInHeader,
} from './fixtures'

/*
 * Page furniture belongs to the document it was loaded for.
 *
 * `PageZone` owns its own Tiptap instance and Tiptap's `content` option is
 * initial content only, so an unkeyed zone kept note A's editor alive across
 * the move to note B: B showed A's header, and the first keystroke in it
 * emitted A's text, which autosave then wrote onto B.
 *
 * The unit suite covers the content side of this. What it cannot cover is the
 * caret: jsdom has no layout, so Tiptap's focus command moves the ProseMirror
 * selection without moving DOM focus, and `toHaveFocus` can never pass there.
 * That assertion lives here instead, which is why this file exists rather than
 * being another case in DocumentEditor.test.tsx.
 */

test.describe('page furniture', () => {
  test.beforeEach(async ({ page }) => {
    await createClass(page, 'Biology 101')
  })

  test('a header is edited where it is shown, and persists', async ({ page }) => {
    await createNote(page)
    await titleInput(page).fill('Note one')

    await typeInHeader(page, 'BIO 101 — Unit 3')

    await expectPersisted(page, 'BIO 101 — Unit 3')

    await page.reload()
    await expect(headerContent(page)).toContainText('BIO 101 — Unit 3')
  })

  test('a second note does not show or inherit the first note’s header', async ({ page }) => {
    await createNote(page)
    await titleInput(page).fill('Note one')
    await typeInHeader(page, 'Header of note one')
    await expectPersisted(page, 'Header of note one')

    await page.getByLabel(/^Back to /).click()
    await createNote(page)

    await expect(headerContent(page)).not.toContainText('Header of note one')
    await expect(page.locator('body')).not.toContainText('Header of note one')
  })

  /*
   * The assertion jsdom could not make.
   *
   * The zone remounts underneath the writer on navigation. Remounting while it
   * is still the active zone drops the caret into a header of a note they
   * never opened, and the next keystroke lands in it rather than in the body.
   */
  test('navigating away does not leave the caret in the new note’s header', async ({ page }) => {
    await createNote(page)
    await typeInHeader(page, 'First note header')
    await expectPersisted(page, 'First note header')

    await page.getByLabel(/^Back to /).click()
    await createNote(page)

    await expect(headerContent(page)).not.toBeFocused()
    await expect(headerContent(page)).toHaveAttribute('contenteditable', 'false')

    // And typing goes where the writer expects it to.
    await body(page).click()
    await page.keyboard.type('Body of the second note.')
    await expect(body(page)).toContainText('Body of the second note.')
    await expect(headerContent(page)).not.toContainText('Body of the second note.')
  })

  test('editing the second note’s header does not touch the first', async ({ page }) => {
    await createNote(page)
    await titleInput(page).fill('First')
    await typeInHeader(page, 'Header A')
    await expectPersisted(page, 'Header A')
    const first = page.url()

    await page.getByLabel(/^Back to /).click()
    await createNote(page)
    await titleInput(page).fill('Second')
    await typeInHeader(page, 'Header B')
    await expectPersisted(page, 'Header B')

    await page.goto(first)
    await expect(headerContent(page)).toContainText('Header A')
    await expect(headerContent(page)).not.toContainText('Header B')
  })
})
