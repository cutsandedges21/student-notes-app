/**
 * Counting what is in the note.
 *
 * Pulled out of the menubar so the counting rules can be tested directly, and
 * so the selection case -- which is the one people actually check, when a
 * word limit applies to one section rather than the whole note -- is not
 * buried inside a click handler.
 */

export interface Counts {
  words: number
  characters: number
  charactersNoSpaces: number
}

/**
 * Words are runs of non-whitespace.
 *
 * Not a dictionary rule: "self-aware" is one word and "e.g." is one word,
 * which is what a person counting by eye would say, and it is what every
 * other editor's counter reports. The empty-string case matters -- splitting
 * '' on whitespace yields one empty entry, which would report a word in a
 * blank note -- so empties are filtered rather than counted.
 */
export function countText(text: string): Counts {
  return {
    words: text.split(/\s+/).filter(Boolean).length,
    characters: text.length,
    charactersNoSpaces: text.replace(/\s/g, '').length,
  }
}
