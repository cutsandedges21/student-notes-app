import '@testing-library/jest-dom/vitest'

/**
 * jsdom ships `<dialog>` but not its modal methods, so any component built on
 * the native element throws "showModal is not a function" the moment it
 * mounts. Stub them to the one behaviour the tests care about -- toggling the
 * `open` attribute -- rather than pulling in a full polyfill for two methods.
 */
/**
 * jsdom has no layout, so it omits the scrolling methods entirely. Components
 * that keep a transcript pinned to the bottom call them on every render and
 * would otherwise throw before any assertion runs.
 */
if (typeof Element !== 'undefined' && !Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {}
}

if (typeof HTMLDialogElement !== 'undefined') {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.open = true
    }
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close() {
      this.open = false
      this.dispatchEvent(new Event('close'))
    }
  }
}
