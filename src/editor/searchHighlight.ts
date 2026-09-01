import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Match } from './findReplace'

/**
 * Marks every search hit, with the current one picked out.
 *
 * Decorations rather than marks, for the same reason comments use them:
 * nothing here reaches `getJSON()`, so a search cannot be autosaved into the
 * note. That matters more here than it looks -- find-and-replace is used on
 * long documents, autosave runs while the panel is open, and a highlight that
 * was part of the content would be persisted to everyone the note is shared
 * with the moment somebody searched it.
 *
 * The state is replaced wholesale on every keystroke in the panel rather than
 * mapped through transactions. Matches are cheap to recompute and the query
 * changes far more often than the document does, so mapping would be effort
 * spent keeping stale answers alive.
 */

interface SearchState {
  matches: Match[]
  /** Index into `matches`, or -1 when nothing is current. */
  current: number
}

const empty: SearchState = { matches: [], current: -1 }

export const searchHighlightKey = new PluginKey<SearchState>('searchHighlight')

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    searchHighlight: {
      setSearchMatches: (matches: Match[], current: number) => ReturnType
      clearSearchMatches: () => ReturnType
    }
  }
}

export const SearchHighlight = Extension.create({
  name: 'searchHighlight',

  addCommands() {
    return {
      setSearchMatches:
        (matches: Match[], current: number) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(searchHighlightKey, { matches, current }))
          return true
        },
      clearSearchMatches:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(searchHighlightKey, empty))
          return true
        },
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchHighlightKey,

        state: {
          init: () => empty,
          apply(tr, value) {
            const next = tr.getMeta(searchHighlightKey) as SearchState | undefined
            if (next) return next
            // The document moved under the results, so they are stale. The
            // panel recomputes on the next keystroke; until then, showing
            // nothing beats showing hits that have drifted off their words.
            if (tr.docChanged) return empty
            return value
          },
        },

        props: {
          decorations(state) {
            const search = searchHighlightKey.getState(state)
            if (!search || search.matches.length === 0) return null

            const size = state.doc.content.size
            const decorations = search.matches
              .filter((match) => match.from >= 0 && match.to <= size && match.to > match.from)
              .map((match, index) =>
                Decoration.inline(match.from, match.to, {
                  class:
                    index === search.current
                      ? 'search-hit search-hit--current'
                      : 'search-hit',
                }),
              )

            return DecorationSet.create(state.doc, decorations)
          },
        },
      }),
    ]
  },
})
