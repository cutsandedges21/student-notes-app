import { test, expect } from '@playwright/test'
import { body, createClass, createNote, typeInBody } from './fixtures'

/**
 * The note on a phone.
 *
 * This is the one thing a unit test cannot answer, because the whole defect is
 * about layout: a Letter page is 816px wide, a phone is 390px, and the fit
 * scale bottoms out at half size -- so the note became a page you scrolled
 * sideways through, one line at a time, at a size nobody could read.
 *
 * The assertion that matters is the absence of horizontal scroll. Everything
 * else here is in support of it.
 */

/** iPhone 14-ish. Narrower than any tablet, wider than the smallest phone. */
const PHONE = { width: 390, height: 844 }
/** iPad portrait: the narrowest screen a Letter page still fits on. */
const TABLET = { width: 768, height: 1024 }

async function documentScrollsSideways(page: import('@playwright/test').Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )
}

test.describe('on a phone', () => {
  test.use({ viewport: PHONE })

  test.beforeEach(async ({ page }) => {
    await createClass(page, 'Biology 101')
    await createNote(page)
  })

  test('does not make the reader scroll sideways', async ({ page }) => {
    await typeInBody(
      page,
      'Mitochondria are the powerhouse of the cell, and this sentence is long enough to wrap.',
    )

    expect(await documentScrollsSideways(page)).toBe(false)
  })

  test('lays the note out as a column, not as a page', async ({ page }) => {
    const stack = page.locator('.doc-stack')
    await expect(stack).toHaveAttribute('data-reflow', '')

    // The text column fits the screen rather than overflowing it.
    const width = await stack.evaluate((node) => node.getBoundingClientRect().width)
    expect(width).toBeLessThanOrEqual(PHONE.width)
  })

  test('draws no page shapes, because there are no pages', async ({ page }) => {
    await typeInBody(page, 'A short note.')

    await expect(page.locator('.doc-page')).toHaveCount(0)
  })

  test('is still editable, and still saves', async ({ page }) => {
    await typeInBody(page, 'Typed on a phone.')

    await expect(body(page)).toContainText('Typed on a phone.')

    await page.reload()
    await expect(body(page)).toContainText('Typed on a phone.')
  })

  /**
   * Sized by its text, the sheet stopped at the last line and left the rest of
   * the phone as grey backdrop -- and tapping there put the caret nowhere, so
   * the obvious gesture for "carry on writing" did nothing.
   */
  test('the writing surface fills the screen, not just the text', async ({ page }) => {
    await typeInBody(page, 'One short line.')

    const sheet = await page.locator('.doc-stack').evaluate((node) => {
      const box = node.getBoundingClientRect()
      return { top: box.top, bottom: box.bottom }
    })

    // It reaches the bottom of the viewport rather than stopping under the text.
    expect(sheet.bottom).toBeGreaterThan(PHONE.height * 0.8)
  })

  test('wraps text to the screen rather than to the paper', async ({ page }) => {
    await typeInBody(page, 'word '.repeat(60))

    // The editable element itself must fit; if it were still 816px wide the
    // text would be laid out for paper and clipped or scrolled.
    const width = await body(page).evaluate((node) => node.getBoundingClientRect().width)
    expect(width).toBeLessThanOrEqual(PHONE.width)
  })
})

test.describe('on a tablet', () => {
  test.use({ viewport: TABLET })

  /**
   * The page simulation is the product on anything wide enough to show it.
   * Reflow is for screens that cannot, and 768px can.
   */
  test('keeps its paper', async ({ page }) => {
    await createClass(page, 'Biology 101')
    await createNote(page)

    await expect(page.locator('.doc-stack')).not.toHaveAttribute('data-reflow', '')
  })
})
