import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/**
 * Draws the passages that have comments on them.
 *
 * Decorations, never marks -- the same rule the AI preview follows, and for the
 * same reason. Nothing here reaches `getJSON()`, so a comment highlight cannot
 * be autosaved into the note, cannot survive into an export, and cannot travel
 * to somebody who is not allowed to read the comment. Marking the text instead
 * would put a permission-controlled fact inside the document body, where the
 * document's own permissions are the only ones that apply.
 *
 * It also means removing a comment needs no undo step: the highlight was never
 * an edit.
 *
 * Ranges are computed outside this plugin, by resolving each thread's anchor
 * against the current document, and pushed in. The plugin deliberately does no
 * anchoring of its own: it maps what it is given through subsequent
 * transactions so highlights track typing between refreshes, and forgets them
 * when told to.
 */

export interface CommentRange {
  threadId: string
  from: number
  to: number
}

interface CommentHighlightState {
  ranges: CommentRange[]
  /** The thread the sidebar is focused on, drawn more strongly. */
  activeThreadId: string | null
}

const empty: CommentHighlightState = { ranges: [], activeThreadId: null }

export const commentHighlightKey = new PluginKey<CommentHighlightState>('commentHighlight')

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    commentHighlight: {
      /** Replaces every highlight with a freshly resolved set. */
      setCommentRanges: (ranges: CommentRange[], activeThreadId: string | null) => ReturnType
      clearCommentRanges: () => ReturnType
    }
  }
}

export const CommentHighlight = Extension.create({
  name: 'commentHighlight',

  addCommands() {
    return {
      setCommentRanges:
        (ranges: CommentRange[], activeThreadId: string | null) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(commentHighlightKey, { ranges, activeThreadId }))
          return true
        },
      clearCommentRanges:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(commentHighlightKey, empty))
          return true
        },
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<CommentHighlightState>({
        key: commentHighlightKey,

        state: {
          init: () => empty,
          apply(tr, value) {
            const next = tr.getMeta(commentHighlightKey) as CommentHighlightState | undefined
            if (next) return next
            if (!tr.docChanged) return value

            /*
             * Map through the edit so a highlight follows the words while
             * somebody types, rather than sitting still until the sidebar
             * re-resolves. A range the edit consumed entirely is dropped: it
             * no longer covers anything, and a zero-width highlight renders as
             * a stray sliver against the next character.
             *
             * Bias inwards (1, -1) so typing at either edge of a commented
             * passage is not silently swallowed into the comment.
             */
            const ranges = value.ranges
              .map((range) => ({
                threadId: range.threadId,
                from: tr.mapping.map(range.from, 1),
                to: tr.mapping.map(range.to, -1),
              }))
              .filter((range) => range.to > range.from)

            return { ...value, ranges }
          },
        },

        props: {
          decorations(state) {
            const current = commentHighlightKey.getState(state)
            if (!current || current.ranges.length === 0) return null

            const size = state.doc.content.size
            const decorations = current.ranges
              // A range can outlive the text under it by a tick, between an
              // edit landing and the sidebar re-resolving. Drawing outside the
              // document throws, which would take the editor down.
              .filter((range) => range.from >= 0 && range.to <= size && range.to > range.from)
              .map((range) =>
                Decoration.inline(range.from, range.to, {
                  class:
                    range.threadId === current.activeThreadId
                      ? 'comment-highlight comment-highlight--active'
                      : 'comment-highlight',
                  'data-comment-thread': range.threadId,
                }),
              )

            return DecorationSet.create(state.doc, decorations)
          },
        },
      }),
    ]
  },
})
