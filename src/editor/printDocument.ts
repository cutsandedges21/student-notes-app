import { generateHTML, type JSONContent } from '@tiptap/core'
import { editorExtensions } from './extensions'
import { zoneExtensions } from './PageZone'
import type { PageGeometry } from './pagination/geometry'

/**
 * Printing and PDF export.
 *
 * Rather than styling the app out of the way with `@media print`, this builds a
 * separate document containing nothing but the note and prints that. The
 * earlier approach kept losing: the editor lives inside a full-height shell
 * with a scrolling column, and print stylesheets had to unpick every layer of
 * it -- one missed constraint and the printout was a screenshot of the app.
 *
 * A standalone document has no chrome to hide, no scroll container to unclip
 * and no flex shell to flatten. The browser paginates plain flowing content,
 * which is the one thing it is reliably good at.
 */

export interface PrintPayload {
  title: string
  /** Tiptap JSON for the body, header and footer. */
  content: JSONContent
  header?: JSONContent
  footer?: JSONContent
  geometry: PageGeometry
}

/**
 * Copies the app's stylesheets into the print document.
 *
 * The note has to look the same on paper as on screen -- same fonts, same
 * sizes, same list markers. Re-declaring that here would mean maintaining two
 * copies of the editor's typography and watching them drift.
 */
function collectStyles(): string {
  const parts: string[] = []

  document.querySelectorAll('style').forEach((node) => {
    parts.push(`<style>${node.textContent ?? ''}</style>`)
  })

  document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]').forEach((node) => {
    parts.push(`<link rel="stylesheet" href="${node.href}">`)
  })

  return parts.join('\n')
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function buildPrintHtml({
  title,
  content,
  header,
  footer,
  geometry,
}: PrintPayload): string {
  const body = generateHTML(content, editorExtensions)
  const headerHtml = header ? generateHTML(header, zoneExtensions) : ''
  const footerHtml = footer ? generateHTML(footer, zoneExtensions) : ''

  const hasHeader = Boolean(headerHtml.replace(/<[^>]*>/g, '').trim())
  const hasFooter = Boolean(footerHtml.replace(/<[^>]*>/g, '').trim())

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title || 'Untitled document')}</title>
${collectStyles()}
<style>
  /*
   * The page itself. Margins belong to @page so every sheet gets them --
   * padding on a block would only apply to the first and last.
   */
  @page {
    size: ${geometry.pageWidth}px ${geometry.pageHeight}px;
    margin: ${geometry.marginTop}px ${geometry.marginRight}px ${geometry.marginBottom}px ${geometry.marginLeft}px;
  }

  html, body {
    margin: 0;
    padding: 0;
    background: #fff;
  }

  /* Running header and footer: fixed elements repeat on every printed sheet,
     which is the only way to get running heads out of a browser. They sit in
     the margin @page reserved, hence the negative offsets. */
  .print-header,
  .print-footer {
    position: fixed;
    left: 0;
    right: 0;
    font-size: 10pt;
    line-height: 1.3;
  }

  .print-header { top: -${Math.round(geometry.marginTop * 0.6)}px; }
  .print-footer { bottom: -${Math.round(geometry.marginBottom * 0.6)}px; }

  .print-header p,
  .print-footer p { margin: 0; }

  /* The body is a plain flow. No positioning, no containment, nothing that
     could stop the browser breaking it across pages. */
  .print-body {
    position: static;
  }

  /* Images must not straddle a page boundary. */
  .print-body img {
    max-width: 100%;
    break-inside: avoid;
  }

  /* Headings should not be left stranded at the foot of a page. */
  .print-body h1,
  .print-body h2,
  .print-body h3 {
    break-after: avoid;
  }

  .print-body p,
  .print-body li {
    orphans: 2;
    widows: 2;
  }

  /* A manual page break in the note is honoured on paper. */
  .print-body [data-page-break] {
    height: 0;
    border: 0;
    break-after: page;
  }

  /* Layout spacers exist only to push text onto the next page on screen. The
     printer does its own pagination, so they would double the gap. */
  .print-body [data-page-spacer] {
    display: none;
  }
</style>
</head>
<body>
${hasHeader ? `<div class="print-header ProseMirror">${headerHtml}</div>` : ''}
${hasFooter ? `<div class="print-footer ProseMirror">${footerHtml}</div>` : ''}
<div class="print-body ProseMirror">${body}</div>
</body>
</html>`
}

/**
 * Renders the note into a hidden frame and opens the browser's print dialog on
 * it.
 *
 * A frame rather than a popup: popups get blocked, and a blocked print is a
 * silent failure. The frame is removed once the dialog closes.
 */
export async function printNote(payload: PrintPayload): Promise<void> {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText =
    'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  document.body.appendChild(frame)

  const doc = frame.contentDocument
  if (!doc) {
    frame.remove()
    throw new Error('Could not create the print document')
  }

  doc.open()
  doc.write(buildPrintHtml(payload))
  doc.close()

  const win = frame.contentWindow
  if (!win) {
    frame.remove()
    throw new Error('Could not reach the print document')
  }

  // Web fonts load asynchronously. Printing before they arrive produces a
  // fallback typeface on paper and the right one on screen.
  try {
    await doc.fonts?.ready
  } catch {
    // Font loading is best-effort; a fallback face beats not printing.
  }

  win.focus()
  win.print()

  // Chrome's print dialog is modal and returns here once dismissed; other
  // engines return immediately, so the frame is removed on a delay rather than
  // torn out from under a dialog that is still open.
  window.setTimeout(() => frame.remove(), 1000)
}
