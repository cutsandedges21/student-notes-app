import { test, expect } from '@playwright/test'
import { body, createClass, createNote, expectPersisted, titleInput, typeInBody } from './fixtures'

/**
 * Getting a note out and back in, in a real browser.
 *
 * Neither half can be proved by a unit test. Export ends in a browser download
 * -- a blob URL and a synthetic click -- and import begins with a file picker.
 * What the converters do is covered in Vitest; whether a file actually leaves
 * and arrives is only answerable here.
 */

test.describe('export', () => {
  test.beforeEach(async ({ page }) => {
    await createClass(page, 'Biology 101')
    await createNote(page)
  })

  test('downloads the note as markdown, named after it', async ({ page }) => {
    await titleInput(page).fill('Lecture 5')
    await typeInBody(page, 'Mitochondria produce ATP.')

    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'File' }).click()
    await page.getByRole('menuitem', { name: 'Download as Markdown' }).click()

    const file = await download
    expect(file.suggestedFilename()).toBe('Lecture 5.md')
  })

  test('the file holds the note, with its title as a heading', async ({ page }) => {
    await titleInput(page).fill('Lecture 5')
    await typeInBody(page, 'Mitochondria produce ATP.')

    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'File' }).click()
    await page.getByRole('menuitem', { name: 'Download as Markdown' }).click()

    const stream = await (await download).createReadStream()
    const contents = await new Promise<string>((resolve, reject) => {
      let text = ''
      stream.on('data', (chunk) => (text += chunk))
      stream.on('end', () => resolve(text))
      stream.on('error', reject)
    })

    expect(contents).toContain('# Lecture 5')
    expect(contents).toContain('Mitochondria produce ATP.')
  })
})

test.describe('import', () => {
  test.beforeEach(async ({ page }) => {
    await createClass(page, 'Biology 101')
    await createNote(page)
  })

  /**
   * Into a new note, never over the open one. Importing over what is on screen
   * would replace work with no way back, which is the class of failure this
   * app's anchored-apply rules exist to prevent.
   */
  test('reads a markdown file into a new note', async ({ page }) => {
    await typeInBody(page, 'The note that was already open.')
    await expectPersisted(page, 'The note that was already open.')

    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'File' }).click()
    await page.getByRole('menuitem', { name: 'Import a file…' }).click()

    await (await chooser).setFiles({
      name: 'Photosynthesis.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# Photosynthesis\n\n- Light reactions\n- Calvin cycle\n'),
    })

    // Lands in the imported note...
    await expect(titleInput(page)).toHaveValue('Photosynthesis')
    await expect(body(page)).toContainText('Light reactions')
    // ...as a list, not as prose.
    await expect(body(page).locator('ul li')).toHaveCount(2)

    // ...and the note that was open still holds what was written in it.
    // Checked against storage rather than by navigating back: what is being
    // asserted is that the import did not overwrite it, and that is a fact
    // about what was stored, not about what a back button lands on.
    await expectPersisted(page, 'The note that was already open.')
  })

  test('says why it will not read a Word file, rather than failing silently', async ({ page }) => {
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'File' }).click()
    await page.getByRole('menuitem', { name: 'Import a file…' }).click()

    await (await chooser).setFiles({
      name: 'essay.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.from('PK not really a docx'),
    })

    await expect(page.getByText(/Save it as Markdown or plain text/)).toBeVisible()
  })
})
