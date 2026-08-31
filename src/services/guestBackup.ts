import { guestExportFilename, guestExportJson } from './guestStore'

/**
 * Writes the guest store out as a file the user keeps.
 *
 * The recovery path for a browser that will not persist: the notes are still in
 * memory and in whatever was last written, and this is how they leave. A blob
 * URL rather than a data URL because guest stores routinely exceed the length a
 * data URL can carry in some browsers.
 *
 * Lives here rather than beside the component that calls it so that file
 * exports components only -- a module mixing the two breaks Fast Refresh, and
 * this is a service, not UI.
 */
export function downloadGuestBackup(): void {
  const blob = new Blob([guestExportJson()], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = guestExportFilename()
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Freed on the next tick: revoking synchronously can beat the download in
  // some browsers and produce an empty file.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
