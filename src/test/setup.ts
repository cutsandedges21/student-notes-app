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

/*
 * `scrollIntoView` is missing for the same reason and is stubbed for the same
 * reason: keeping a highlighted row on screen is a real requirement in a list
 * longer than its box, and a component that does it correctly should not
 * throw in a test that is asking about something else.
 */
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

/*
 * jsdom has no layout, so it does not implement the CSSOM View methods that
 * turn a point into a node. ProseMirror calls `elementFromPoint` from
 * `posAtCoords` on every mousedown, to work out where a click landed.
 *
 * Left unstubbed this throws *asynchronously*, inside an event listener, so it
 * does not fail the test that caused it. It surfaces as "Vitest caught 1
 * unhandled error" and gets attributed to whichever test happens to be running
 * when the event loop gets to it -- which is why the suite had three tests
 * that failed in a full run, passed in isolation, and moved around between
 * runs. That looked like flakiness and was not: it was one missing method.
 *
 * Returning null is honest rather than convenient. It is what the real method
 * returns for a point outside any element, ProseMirror already handles it, and
 * inventing a node would make click-to-position tests pass for the wrong
 * reason. Tests that genuinely need hit-testing belong in Playwright.
 */
if (typeof Document !== 'undefined' && !Document.prototype.elementFromPoint) {
  Document.prototype.elementFromPoint = () => null
}

if (typeof Document !== 'undefined' && !Document.prototype.elementsFromPoint) {
  Document.prototype.elementsFromPoint = () => []
}

/*
 * Same reasoning: `Range` has no geometry in jsdom, and ProseMirror measures
 * one when scrolling a new selection into view. Several editor specs stubbed
 * this locally; one shared stub is fewer places to forget it.
 */
if (typeof Range !== 'undefined' && !Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () =>
    Object.assign([] as unknown as DOMRectList, { item: () => null })
  Range.prototype.getBoundingClientRect = () =>
    ({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect
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
