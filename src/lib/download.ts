/**
 * Handing a file to the browser.
 *
 * A blob URL and a synthetic click, which is the only way to name a downloaded
 * file without a server. The URL is revoked afterwards: each one pins its blob
 * in memory until the document is discarded, so a student who exports a dozen
 * notes in a session would otherwise be holding a dozen copies of them.
 *
 * Revoked on a later turn of the event loop rather than immediately -- Safari
 * cancels a download whose object URL is released in the same tick.
 */
export function downloadTextFile(filename: string, contents: string, type = 'text/markdown') {
  const url = URL.createObjectURL(new Blob([contents], { type: `${type};charset=utf-8` }))

  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  // Firefox needs the element in the document for a programmatic click.
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()

  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * Asks for one file and hands it back.
 *
 * Resolves with null when the picker is dismissed. That is not an error and
 * must not be reported as one -- changing your mind about opening a file is an
 * ordinary thing to do.
 *
 * There is no cancel event that fires reliably across browsers, so the input
 * is discarded rather than waited on: an abandoned picker simply never
 * resolves, and the element is garbage once the promise is dropped.
 */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.addEventListener('change', () => {
      resolve(input.files?.[0] ?? null)
      input.remove()
    })
    input.style.display = 'none'
    document.body.appendChild(input)
    input.click()
  })
}
