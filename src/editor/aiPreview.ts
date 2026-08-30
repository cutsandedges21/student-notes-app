import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/**
 * Shows a proposed AI edit in the document, next to the words it would replace.
 *
 * The suggestion is a decoration, never content. Nothing here reaches
 * `getJSON()`, so autosave cannot persist a suggestion the student has not
 * accepted -- closing the tab mid-decision loses the proposal, which is the
 * right outcome, rather than silently writing the model's words into the note.
 * The strike through the original is a decoration class for the same reason:
 * the student's own text is never marked up, so declining needs no undo.
 *
 * Positions are mapped through every transaction, so the preview stays anchored
 * to the right words if the note is edited while the model is still thinking.
 */

export interface AiPreview {
  /** The student's selection, the text being offered a replacement. */
  from: number
  to: number
  /** The suggestion, already rendered to HTML. */
  html: string
  onAccept: () => void
  onDecline: () => void
}

export const aiPreviewKey = new PluginKey<AiPreview | null>('aiPreview')

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    aiPreview: {
      /** Offers a suggestion against a range. Replaces any preview already up. */
      showAiPreview: (preview: AiPreview) => ReturnType
      clearAiPreview: () => ReturnType
    }
  }
}

function button(
  label: string,
  variant: 'accept' | 'decline',
  onClick: () => void,
): HTMLButtonElement {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = `ai-preview__button ai-preview__button--${variant}`
  el.textContent = label
  // The editor would otherwise take focus on press and collapse the selection
  // out from under the range this preview is anchored to.
  el.addEventListener('mousedown', (event) => event.preventDefault())
  el.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    onClick()
  })
  return el
}

function buildWidget(preview: AiPreview): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.className = 'ai-preview'
  // Not part of the editable flow: without this the caret can be placed inside
  // the proposal and the student can type into text that does not exist yet.
  wrapper.contentEditable = 'false'
  wrapper.setAttribute('role', 'group')
  wrapper.setAttribute('aria-label', 'Suggested edit')

  const body = document.createElement('div')
  body.className = 'ai-preview__body ProseMirror'
  body.innerHTML = preview.html
  wrapper.appendChild(body)

  const actions = document.createElement('div')
  actions.className = 'ai-preview__actions'
  actions.appendChild(button('Accept', 'accept', preview.onAccept))
  actions.appendChild(button('Decline', 'decline', preview.onDecline))
  wrapper.appendChild(actions)

  return wrapper
}

export const AiPreviewExtension = Extension.create({
  name: 'aiPreview',

  addCommands() {
    return {
      showAiPreview:
        (preview: AiPreview) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(aiPreviewKey, preview))
          return true
        },
      clearAiPreview:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(aiPreviewKey, null))
          return true
        },
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<AiPreview | null>({
        key: aiPreviewKey,

        state: {
          init: () => null,
          apply(tr, value) {
            // `undefined` means this transaction said nothing about the
            // preview; `null` means it explicitly cleared one.
            const next = tr.getMeta(aiPreviewKey) as AiPreview | null | undefined
            if (next !== undefined) return next
            if (!value) return null
            if (!tr.docChanged) return value

            // Bias outwards so typing at either edge grows the range rather
            // than escaping it.
            const from = tr.mapping.map(value.from, -1)
            const to = tr.mapping.map(value.to, 1)

            // The words being replaced are gone -- the offer no longer means
            // anything, so it goes rather than pointing at nothing.
            return to > from ? { ...value, from, to } : null
          },
        },

        props: {
          decorations(state) {
            const preview = aiPreviewKey.getState(state)
            if (!preview) return null

            return DecorationSet.create(state.doc, [
              Decoration.inline(preview.from, preview.to, {
                class: 'ai-preview-original',
              }),
              Decoration.widget(preview.to, () => buildWidget(preview), {
                // After the selection, so the proposal reads as following the
                // text it would replace.
                side: 1,
                key: `ai-preview-${preview.html.length}`,
                // Clicks belong to the buttons, not to the editor.
                stopEvent: () => true,
                ignoreSelection: true,
              }),
            ])
          },
        },
      }),
    ]
  },
})
