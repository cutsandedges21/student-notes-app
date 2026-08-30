import { generateHTML, type JSONContent } from '@tiptap/core'
import { editorExtensions } from './extensions'
import { zoneExtensions } from './PageZone'
import { printableHeight, printableWidth, type PageGeometry } from './pagination/geometry'
import type { PageNumberPosition } from './pagination/types'

/**
 * Printing and PDF export.
 *
 * Two decisions shape this file.
 *
 * First, it prints a separate document rather than styling the app out of the
 * way. The editor sits in a full-height shell around a scrolling column with an
 * absolutely positioned page stack; a print stylesheet had to unpick every
 * layer of that, and one missed constraint printed the whole interface.
 *
 * Second, `@page` carries no margin. Browsers draw their own furniture -- the
 * document title, the date, the URL, the page count -- into that margin, and
 * there is no property to turn it off. Removing the margin removes the space
 * they are drawn in. The page's real margins are then laid out here instead,
 * which is also what lets the header, footer and page number sit exactly where
 * the editor shows them.
 *
 * Because margins are ours, pagination is ours too: content is measured and
 * distributed into page boxes rather than poured into one flow.
 */

export interface PrintPayload {
  title: string
  content: JSONContent
  header?: JSONContent
  footer?: JSONContent
  geometry: PageGeometry
  pageNumbers: PageNumberPosition
}

/**
 * Copies the app's stylesheets into the print document.
 *
 * The note has to look on paper exactly as it does on screen -- same fonts,
 * sizes, list markers and spacing. Restating that here would mean maintaining a
 * second copy of the editor's typography and watching the two drift apart.
 */
function collectStyles(doc: Document): void {
  document.querySelectorAll('style').forEach((node) => {
    const copy = doc.createElement('style')
    copy.textContent = node.textContent
    doc.head.appendChild(copy)
  })

  document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]').forEach((node) => {
    const copy = doc.createElement('link')
    copy.rel = 'stylesheet'
    copy.href = node.href
    doc.head.appendChild(copy)
  })
}

function pageCss(geometry: PageGeometry): string {
  return `
  /*
   * No margin, deliberately. It is the only way to stop the browser printing
   * its own header and footer -- the title, date, URL and page number -- which
   * have no property to disable them and are drawn into this margin.
   */
  @page {
    size: ${geometry.pageWidth}px ${geometry.pageHeight}px;
    margin: 0;
  }

  html, body {
    margin: 0;
    padding: 0;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .print-page {
    position: relative;
    box-sizing: border-box;
    width: ${geometry.pageWidth}px;
    height: ${geometry.pageHeight}px;
    padding: ${geometry.marginTop}px ${geometry.marginRight}px ${geometry.marginBottom}px ${geometry.marginLeft}px;
    overflow: hidden;
    break-after: page;
    page-break-after: always;
  }

  /* Without this the last page emits a trailing blank sheet. */
  .print-page:last-child {
    break-after: auto;
    page-break-after: auto;
  }

  /*
   * The header and footer bands, rebuilt to match \`.doc-furniture\` on screen.
   *
   * Each band fills its whole margin and centres its contents, which is what
   * puts a one-line header where the writer sees it rather than jammed against
   * the paper's edge. The measurements are not chosen here: they are the ones
   * the editor already uses, so what prints lines up with what was on screen.
   */
  .print-header,
  .print-footer {
    position: absolute;
    left: 0;
    right: 0;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    padding-left: ${geometry.marginLeft}px;
    padding-right: ${geometry.marginRight}px;
  }

  .print-header { top: 0; height: ${geometry.marginTop}px; }
  .print-footer { bottom: 0; height: ${geometry.marginBottom}px; }

  /* Mirrors \`.doc-furniture > *\`: one full-width child to align against. */
  .print-header > *,
  .print-footer > * { width: 100%; }

  /* The footer text keeps its own line; the number sits under it. */
  .print-footer-stack {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  /*
   * Matches the \`min-h-[24px] px-1\` the on-screen zone carries. The minimum
   * height is not cosmetic: the band centres its contents, so a zone that
   * collapsed to its one line of text would sit three pixels off from where
   * the writer saw it.
   */
  .print-zone {
    box-sizing: border-box;
    min-height: 24px;
    padding: 0 4px;
  }

  /* \`.doc-furniture .ProseMirror\` on screen: 10pt, leading-snug. */
  .print-zone,
  .print-page-number {
    font-size: 10pt;
    line-height: 1.375;
  }

  .print-zone p,
  .print-footer p { margin: 0; }

  .print-page-number { width: 100%; }
  .print-page-number[data-align='left'] { text-align: left; }
  .print-page-number[data-align='center'] { text-align: center; }
  .print-page-number[data-align='right'] { text-align: right; }

  .print-body img { max-width: 100%; }

  /* Layout spacers exist only to push text down on screen. Pages are measured
     here, so keeping them would double every gap. */
  .print-body [data-page-spacer] { display: none; }
  .print-body [data-page-break] { display: none; }
`
}

/** Height of a node including the margins that collapse around it. */
function outerHeight(node: HTMLElement): number {
  const style = getComputedStyle(node)
  return (
    node.getBoundingClientRect().height +
    parseFloat(style.marginTop || '0') +
    parseFloat(style.marginBottom || '0')
  )
}

/**
 * Splits the rendered body into pages.
 *
 * Measured in a container the same width as the printable area, so line breaks
 * match the editor. Blocks are kept whole: a paragraph that will not fit starts
 * the next page rather than being cut mid-line, which is what the on-screen
 * pagination does too.
 */
function paginate(
  source: HTMLElement,
  limitHeight: number,
): HTMLElement[][] {
  const pages: HTMLElement[][] = []
  let current: HTMLElement[] = []
  let used = 0

  const flush = () => {
    pages.push(current)
    current = []
    used = 0
  }

  Array.from(source.children).forEach((child) => {
    const node = child as HTMLElement

    // A manual page break in the note is honoured exactly where it sits.
    if (node.hasAttribute('data-page-break')) {
      if (current.length) flush()
      return
    }

    const height = outerHeight(node)

    // A block taller than a whole page cannot be made to fit; give it its own
    // page rather than looping forever trying to place it.
    if (height > limitHeight && current.length === 0) {
      current.push(node)
      flush()
      return
    }

    if (used + height > limitHeight && current.length > 0) flush()

    current.push(node)
    used += height
  })

  if (current.length || pages.length === 0) pages.push(current)
  return pages
}

/**
 * Builds the print document inside a frame and hands it to the browser.
 *
 * A frame rather than a popup: popups get blocked, and a blocked print is a
 * silent failure.
 */
export async function printNote(payload: PrintPayload): Promise<void> {
  const { title, content, header, footer, geometry, pageNumbers } = payload

  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText =
    'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  document.body.appendChild(frame)

  const doc = frame.contentDocument
  const win = frame.contentWindow
  if (!doc || !win) {
    frame.remove()
    throw new Error('Could not create the print document')
  }

  doc.open()
  // The title is what a browser would print in its header and what it suggests
  // as the PDF filename. The header is suppressed by the zero margin; the
  // filename is still worth setting.
  doc.write('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>')
  doc.close()

  doc.title = title || 'Untitled document'
  collectStyles(doc)

  const style = doc.createElement('style')
  style.textContent = pageCss(geometry)
  doc.head.appendChild(style)

  // Rendered off-screen at the printable width so measurements match the
  // wrapping the reader will actually get.
  const measure = doc.createElement('div')
  measure.className = 'print-body ProseMirror'
  measure.style.cssText = `position:absolute;visibility:hidden;left:-10000px;top:0;width:${printableWidth(geometry)}px`
  measure.innerHTML = generateHTML(content, editorExtensions)
  doc.body.appendChild(measure)

  // Web fonts change line heights, so pages must not be measured until they
  // have loaded, or the printout breaks in different places than it should.
  try {
    await doc.fonts?.ready
  } catch {
    // Best effort: a fallback face is better than refusing to print.
  }

  const pages = paginate(measure, printableHeight(geometry))

  const headerHtml = header ? generateHTML(header, zoneExtensions) : ''
  const footerHtml = footer ? generateHTML(footer, zoneExtensions) : ''
  const hasHeader = Boolean(headerHtml.replace(/<[^>]*>/g, '').trim())
  const hasFooter = Boolean(footerHtml.replace(/<[^>]*>/g, '').trim())

  const numbered = pageNumbers !== 'off'

  pages.forEach((nodes, index) => {
    const page = doc.createElement('div')
    page.className = 'print-page'

    if (hasHeader) {
      const band = doc.createElement('div')
      band.className = 'print-header'
      const zone = doc.createElement('div')
      zone.className = 'print-zone ProseMirror'
      zone.innerHTML = headerHtml
      band.appendChild(zone)
      page.appendChild(band)
    }

    const body = doc.createElement('div')
    body.className = 'print-body ProseMirror'
    body.style.width = `${printableWidth(geometry)}px`
    nodes.forEach((node) => body.appendChild(node))
    page.appendChild(body)

    // The band is drawn for either reason: a writer can number pages without
    // having written a footer, and can write one without numbering.
    if (hasFooter || numbered) {
      const band = doc.createElement('div')
      band.className = 'print-footer'

      // One stacked child, matching the screen. The band forces its direct
      // children to full width, so footer text and number as siblings would
      // split the row in half and align inside their own halves.
      const stack = doc.createElement('div')
      stack.className = 'print-footer-stack'

      if (hasFooter) {
        const zone = doc.createElement('div')
        zone.className = 'print-zone ProseMirror'
        zone.innerHTML = footerHtml
        stack.appendChild(zone)
      }

      // Each page box is real here, so every sheet can carry its own number --
      // unlike a running footer, which would repeat "1" throughout.
      if (numbered) {
        const number = doc.createElement('div')
        number.className = 'print-page-number'
        number.setAttribute('data-align', pageNumbers)
        number.textContent = String(index + 1)
        stack.appendChild(number)
      }

      band.appendChild(stack)
      page.appendChild(band)
    }

    doc.body.appendChild(page)
  })

  measure.remove()

  win.focus()
  win.print()

  // Chrome's dialog is modal and returns here once dismissed; other engines
  // return immediately, so the frame goes on a delay rather than being pulled
  // out from under a dialog that is still open.
  window.setTimeout(() => frame.remove(), 1000)
}
