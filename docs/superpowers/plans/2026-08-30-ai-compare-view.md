# AI Compare View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the in-document Accept/Decline widget with a side-by-side comparison — the current note on the left, the note with the AI edit applied on the right — with the chat collapsing while the student decides.

**Architecture:** `EditorPage` holds one nullable `AiCompare` state that drives everything. When a proposal arrives its target is resolved against the live document *before* the split opens; an unresolvable target refuses immediately and never opens a comparison. `DocumentEditor` gains a `compare` prop that swaps the editing chrome for a decision bar, freezes the live editor, collapses the docked chat by class (never by unmounting), and renders a second read-only Tiptap editor beside the first. That second editor is seeded with the live document and has the *same insertion* run on it that Accept will run, so the preview is the result rather than a rendering that resembles it.

**Tech Stack:** React 19, TypeScript, Tiptap 3 / ProseMirror, Tailwind 3, Vitest + Testing Library, jsdom.

**Spec:** `docs/superpowers/specs/2026-08-30-ai-compare-view-design.md`

---

## Baseline

Before starting, confirm the suite is green:

```bash
cd student-notes-app && npx vitest run
```

Expected: `Test Files 22 passed (22)`, `Tests 159 passed (159)`.

## File Structure

| File | Responsibility |
|---|---|
| `src/editor/aiRange.ts` | **New.** Decoration extension marking one range per editor, in two variants. Replaces `aiPreview.ts`. |
| `src/editor/previewSuggestion.ts` | **New.** Applies a proposal to a preview editor and reports the inserted range. |
| `src/editor/StaticPageZone.tsx` | **New.** Read-only header/footer band. Extracted from `DocumentEditor`, used by both it and `ComparePane`. |
| `src/editor/ComparePane.tsx` | **New.** The right-hand pane: its own editor, controller and sheet. A display — nothing is read back out of it. |
| `src/editor/CompareBar.tsx` | **New.** Pane labels, Accept/Reject, narrow-screen switch. Presentational. |
| `src/editor/applySuggestion.ts` | Modify: export `suggestionBody` so the preview and the applier cannot drift. |
| `src/editor/extensions.ts` | Modify: swap `AiPreviewExtension` for `AiRangeExtension`. |
| `src/editor/DocumentEditor.tsx` | Modify: `compare` prop, panes row, chrome swap, class-based sidebar collapse. |
| `src/pages/EditorPage.tsx` | Modify: compare state, up-front resolution, accept/reject/refuse, drawer restore, Escape. |
| `src/index.css` | Modify: `.ai-preview*` rules replaced by `.ai-range--*`. |
| `src/editor/aiPreview.ts` | **Deleted** in Task 7. |

**Ordering rule:** the old widget keeps working until Task 6 wires the new path, and is deleted in Task 7. Every task leaves the app shippable.

---

### Task 1: The range decoration extension

Marks a single range per editor. The left pane outlines the words being replaced; the right pane highlights the words replacing them. Keeps the position mapping from `aiPreview.ts` and drops the widget, the buttons and the callbacks.

**Files:**
- Create: `src/editor/aiRange.ts`
- Create: `src/editor/aiRange.test.ts`
- Modify: `src/index.css` (append near the existing `.ai-preview` block, around line 530)

- [ ] **Step 1: Write the failing test**

Create `src/editor/aiRange.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { AiRangeExtension } from './aiRange'

let editor: Editor | null = null

afterEach(() => {
  editor?.destroy()
  editor = null
})

function makeEditor(html: string): Editor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  return new Editor({ element, extensions: [StarterKit, AiRangeExtension], content: html })
}

describe('AiRangeExtension', () => {
  it('marks a range with the variant class', () => {
    editor = makeEditor('<p>Mitochondria make ATP</p>')

    editor.commands.setAiRange({ from: 1, to: 14, variant: 'proposed' })

    const marked = editor.view.dom.querySelector('.ai-range--proposed')
    expect(marked).not.toBeNull()
    expect(marked?.textContent).toBe('Mitochondria')
  })

  it('uses a different class for the original variant', () => {
    editor = makeEditor('<p>Mitochondria make ATP</p>')

    editor.commands.setAiRange({ from: 1, to: 14, variant: 'original' })

    expect(editor.view.dom.querySelector('.ai-range--original')).not.toBeNull()
    expect(editor.view.dom.querySelector('.ai-range--proposed')).toBeNull()
  })

  it('clears the mark', () => {
    editor = makeEditor('<p>Mitochondria make ATP</p>')
    editor.commands.setAiRange({ from: 1, to: 14, variant: 'proposed' })

    editor.commands.clearAiRange()

    expect(editor.view.dom.querySelector('.ai-range--proposed')).toBeNull()
  })

  // Positions go stale the moment anything above them changes. The mark has to
  // travel with its words or it ends up outlining unrelated text.
  it('follows its words when text is inserted above them', () => {
    editor = makeEditor('<p>Mitochondria make ATP</p>')
    editor.commands.setAiRange({ from: 1, to: 14, variant: 'proposed' })

    editor.commands.insertContentAt(1, 'The ')

    expect(editor.view.dom.querySelector('.ai-range--proposed')?.textContent).toBe('Mitochondria')
  })

  // A mark pointing at nothing is worse than no mark: it claims a decision is
  // pending about text that no longer exists.
  it('drops itself when its words are deleted', () => {
    editor = makeEditor('<p>Mitochondria make ATP</p>')
    editor.commands.setAiRange({ from: 1, to: 14, variant: 'proposed' })

    editor.commands.deleteRange({ from: 1, to: 14 })

    expect(editor.view.dom.querySelector('.ai-range--proposed')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd student-notes-app && npx vitest run src/editor/aiRange.test.ts
```

Expected: FAIL — `Failed to resolve import "./aiRange"`.

- [ ] **Step 3: Write the extension**

Create `src/editor/aiRange.ts`:

```ts
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/**
 * Marks the range an AI suggestion concerns.
 *
 * Two variants, one per pane of the compare view: `original` outlines the
 * words being replaced in the student's own document, `proposed` highlights
 * the words replacing them in the preview beside it.
 *
 * A decoration, never content. Nothing here reaches `getJSON()`, so autosave
 * cannot persist a mark, and rejecting needs no undo -- the student's text was
 * never touched. Positions are mapped through every transaction so the mark
 * stays on its words, and the mark drops itself if those words are deleted
 * rather than pointing at nothing.
 */

export interface AiRange {
  from: number
  to: number
  variant: 'original' | 'proposed'
}

export const aiRangeKey = new PluginKey<AiRange | null>('aiRange')

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    aiRange: {
      /** Marks a range. Replaces any mark already set. */
      setAiRange: (range: AiRange) => ReturnType
      clearAiRange: () => ReturnType
    }
  }
}

export const AiRangeExtension = Extension.create({
  name: 'aiRange',

  addCommands() {
    return {
      setAiRange:
        (range: AiRange) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(aiRangeKey, range))
          return true
        },
      clearAiRange:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(aiRangeKey, null))
          return true
        },
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<AiRange | null>({
        key: aiRangeKey,

        state: {
          init: () => null,
          apply(tr, value) {
            // `undefined` means this transaction said nothing about the mark;
            // `null` means it explicitly cleared one.
            const next = tr.getMeta(aiRangeKey) as AiRange | null | undefined
            if (next !== undefined) return next
            if (!value) return null
            if (!tr.docChanged) return value

            // Bias outwards so typing at either edge grows the range rather
            // than escaping it.
            const from = tr.mapping.map(value.from, -1)
            const to = tr.mapping.map(value.to, 1)

            return to > from ? { ...value, from, to } : null
          },
        },

        props: {
          decorations(state) {
            const range = aiRangeKey.getState(state)
            if (!range) return null

            return DecorationSet.create(state.doc, [
              Decoration.inline(range.from, range.to, {
                class: `ai-range ai-range--${range.variant}`,
              }),
            ])
          },
        },
      }),
    ]
  },
})
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd student-notes-app && npx vitest run src/editor/aiRange.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Add the styles**

In `src/index.css`, immediately **above** the existing `.ai-preview-original` rule (around line 532), insert:

```css
/*
 * The range an AI suggestion concerns, marked in both panes of the compare
 * view. Decorations only -- no mark is applied to the document, so rejecting
 * needs no undo.
 */
.ai-range {
  border-radius: 2px;
}

/* The words being replaced, in the student's own document. Outlined rather
   than struck through: the pane beside it shows the replacement, so marking
   these as deleted would overstate what is being offered. */
.ai-range--original {
  outline: 1px dashed #9aa0a6;
  outline-offset: 1px;
  background: rgba(154, 160, 166, 0.1);
}

/* The words replacing them, in the preview. */
.ai-range--proposed {
  background: rgba(26, 115, 232, 0.14);
  box-shadow: 0 0 0 1px rgba(26, 115, 232, 0.25);
}
```

- [ ] **Step 6: Commit**

```bash
cd student-notes-app
git add src/editor/aiRange.ts src/editor/aiRange.test.ts src/index.css
git commit -m "feat(editor): mark the range an AI suggestion concerns"
```

---

### Task 2: Preview insertion that cannot drift from the applier

The whole design rests on the preview showing the actual result. That holds only if the preview and `applyResolvedSuggestion` derive their insertion body the same way — so the derivation becomes one exported function that both call.

Note the outgoing widget used `escapeHtml(content)` for inline suggestions. That is right for display and wrong for a preview of the result; the applier passes inline content through unescaped.

**Files:**
- Modify: `src/editor/applySuggestion.ts:251-269`
- Create: `src/editor/previewSuggestion.ts`
- Create: `src/editor/previewSuggestion.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/editor/previewSuggestion.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { editorExtensions } from './extensions'
import { applyResolvedSuggestion } from './applySuggestion'
import { applyPreview } from './previewSuggestion'

const editors: Editor[] = []

afterEach(() => {
  editors.forEach((editor) => editor.destroy())
  editors.length = 0
})

function makeEditor(html: string): Editor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new Editor({ element, extensions: editorExtensions, content: html })
  editors.push(editor)
  return editor
}

const NOTE = '<p>Mitochondria are the powerhouse of the cell.</p><p>They have two membranes.</p>'

/** The range covering "the powerhouse of the cell." in NOTE. */
const RANGE = { from: 19, to: 45 }

describe('applyPreview', () => {
  // The property the compare view rests on: what the student is shown on the
  // right is what accepting produces, not something that resembles it.
  it('produces the same document as applying an inline suggestion', () => {
    const preview = makeEditor(NOTE)
    const applied = makeEditor(NOTE)

    applyPreview(preview, 'the organelle that generates ATP.', RANGE)
    applyResolvedSuggestion(applied, 'the organelle that generates ATP.', RANGE)

    expect(preview.getJSON()).toEqual(applied.getJSON())
  })

  it('produces the same document as applying a multi-block suggestion', () => {
    const suggestion = '## Mitochondria\n\n- Generate ATP\n- Have two membranes'
    const preview = makeEditor(NOTE)
    const applied = makeEditor(NOTE)

    applyPreview(preview, suggestion, RANGE)
    applyResolvedSuggestion(applied, suggestion, RANGE)

    expect(preview.getJSON()).toEqual(applied.getJSON())
  })

  it('reports the range the inserted text occupies', () => {
    const preview = makeEditor(NOTE)

    const inserted = applyPreview(preview, 'the organelle that generates ATP.', RANGE)

    expect(preview.state.doc.textBetween(inserted.from, inserted.to, ' ')).toContain(
      'the organelle that generates ATP.',
    )
  })

  it('leaves the rest of the note alone', () => {
    const preview = makeEditor(NOTE)

    applyPreview(preview, 'the organelle that generates ATP.', RANGE)

    expect(preview.getText()).toContain('They have two membranes.')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd student-notes-app && npx vitest run src/editor/previewSuggestion.test.ts
```

Expected: FAIL — `Failed to resolve import "./previewSuggestion"`.

- [ ] **Step 3: Export the shared derivation from the applier**

In `src/editor/applySuggestion.ts`, replace the body of `applyResolvedSuggestion` (currently lines 251-269) with:

```ts
/**
 * How a suggestion becomes something insertable.
 *
 * Exported because the compare view's preview pane has to insert byte-for-byte
 * what accepting will insert. Two call sites deriving this separately is
 * exactly how a preview starts lying about the result.
 *
 * A single run of prose replaces exactly the range and inherits the
 * surrounding formatting; anything with block structure has to become nodes.
 */
export function suggestionBody(content: string): string {
  return isInlineSuggestion(content) ? content : markdownToHtml(content)
}

/**
 * Writes the suggestion over a range that has already been resolved.
 *
 * One chain, so one transaction, so one Ctrl+Z takes the whole AI edit back
 * out. `closeHistory` opens a fresh undo step first: without it ProseMirror
 * groups transactions that land within half a second of each other, and an
 * edit accepted right after typing would be undone together with the typing.
 */
export function applyResolvedSuggestion(
  editor: Editor,
  content: string,
  range: { from: number; to: number },
): void {
  editor
    .chain()
    .command(({ tr }) => {
      closeHistory(tr)
      return true
    })
    .focus()
    .insertContentAt({ from: range.from, to: range.to }, suggestionBody(content))
    .run()
}
```

- [ ] **Step 4: Write the preview helper**

Create `src/editor/previewSuggestion.ts`:

```ts
import type { Editor } from '@tiptap/core'
import { suggestionBody } from './applySuggestion'

/**
 * Shows a suggestion in a preview editor, and says where it landed.
 *
 * Deliberately runs the same insertion `applyResolvedSuggestion` runs, through
 * the same `suggestionBody`, so the preview pane is the result of accepting
 * rather than a rendering that resembles it.
 *
 * What it does NOT copy is the rest of that chain. `.focus()` would steal the
 * caret from the document the student is actually looking at, and `closeHistory`
 * exists to keep an accepted edit as one undo step -- neither changes the
 * document, which is the only thing being previewed.
 */
export function applyPreview(
  editor: Editor,
  content: string,
  range: { from: number; to: number },
): { from: number; to: number } {
  const before = editor.state.doc.content.size
  editor.commands.insertContentAt({ from: range.from, to: range.to }, suggestionBody(content))
  const after = editor.state.doc.content.size

  // The replaced span plus however much the document grew or shrank. Derived
  // from the size delta rather than from the content, which may have been
  // reshaped by the schema on the way in.
  return { from: range.from, to: range.to + (after - before) }
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd student-notes-app && npx vitest run src/editor/previewSuggestion.test.ts
```

Expected: PASS, 4 tests.

If the first two fail on an off-by-one in `RANGE`, print `preview.state.doc.textBetween(19, 45, ' ')` and adjust `RANGE` so it covers exactly `the powerhouse of the cell.` — the equality assertions are the point, not the literal offsets.

- [ ] **Step 6: Run the whole suite**

```bash
cd student-notes-app && npx vitest run
```

Expected: all green. `suggestionBody` is a pure extraction, so nothing else moves.

- [ ] **Step 7: Commit**

```bash
cd student-notes-app
git add src/editor/applySuggestion.ts src/editor/previewSuggestion.ts src/editor/previewSuggestion.test.ts
git commit -m "feat(editor): preview a suggestion through the applier's own insertion"
```

---

### Task 3: Static page furniture

`DocumentEditor` renders header/footer as live editors on page 0 and static HTML everywhere else. The compare pane needs the static form on every page — the preview is not a place to edit furniture. Extract it so both use one implementation.

**Files:**
- Create: `src/editor/StaticPageZone.tsx`
- Modify: `src/editor/DocumentEditor.tsx:229-278`

- [ ] **Step 1: Write the component**

Create `src/editor/StaticPageZone.tsx`:

```tsx
import { generateHTML } from '@tiptap/core'
import type { JSONContent } from '@tiptap/react'
import { zoneExtensions, type PageZoneKind } from './PageZone'
import type { PageNumberPosition } from './pagination/types'

/**
 * A header or footer band that cannot be edited.
 *
 * Used for every page after the first -- one editable element cannot exist in
 * several places, and spinning up an editor per page for what is usually a
 * single line would be waste -- and for every page of the compare view's
 * preview, which is a display rather than somewhere to write.
 */

interface StaticPageZoneProps {
  kind: PageZoneKind
  content: JSONContent
  /** Zero-based; the printed number is this plus one. */
  pageIndex: number
  pageNumbers: PageNumberPosition
}

export function StaticPageZone({
  kind,
  content,
  pageIndex,
  pageNumbers,
}: StaticPageZoneProps) {
  const body = (
    <div
      aria-hidden="true"
      className="ProseMirror pointer-events-none text-ink-faint"
      dangerouslySetInnerHTML={{ __html: generateHTML(content, zoneExtensions) }}
    />
  )

  if (kind === 'header' || pageNumbers === 'off') return body

  /*
   * The number gets its own line under the writer's footer text rather than
   * sharing one, so turning numbering on can never shove what they wrote out
   * of the band. Wrapped, not a fragment: the band is a flex row whose direct
   * children are each forced to `width: 100%`, so two of them would share the
   * row at half width apiece and the number would align inside its own half.
   */
  return (
    <div className="flex w-full flex-col">
      {body}
      <div className="doc-page-number" data-align={pageNumbers} aria-hidden="true">
        {pageIndex + 1}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Use it in DocumentEditor**

In `src/editor/DocumentEditor.tsx`, add the import beside the other editor imports:

```tsx
import { StaticPageZone } from './StaticPageZone'
```

Then in `renderZone`, replace the static branch of `zoneBody` — the `<div aria-hidden="true" className="ProseMirror pointer-events-none text-ink-faint" dangerouslySetInnerHTML=... />` — so the assignment reads:

```tsx
    const zoneBody =
      pageIndex === 0 ? (
        <PageZone
          kind={kind}
          content={content}
          active={zone === kind}
          enabled={editable}
          onActivate={() => setZone(kind)}
          onChange={(next) =>
            kind === 'header' ? onHeaderChange?.(next) : onFooterChange?.(next)
          }
        />
      ) : (
        // Later pages carry a static copy, which is what makes it read as
        // repeating furniture. The page number is added below, so this asks
        // for the header treatment regardless of which band it is.
        <StaticPageZone kind="header" content={content} pageIndex={pageIndex} pageNumbers="off" />
      )
```

Everything below that in `renderZone` — the `if (kind === 'header' || pageNumbers === 'off') return zoneBody` guard and the wrapper that adds the number — stays exactly as it is. It already applies to both branches, so page 0 and later pages keep numbering identically.

- [ ] **Step 3: Run the editor tests**

```bash
cd student-notes-app && npx vitest run src/editor/
```

Expected: all green. This is a pure extraction — same markup, same classes.

- [ ] **Step 4: Commit**

```bash
cd student-notes-app
git add src/editor/StaticPageZone.tsx src/editor/DocumentEditor.tsx
git commit -m "refactor(editor): extract the read-only page furniture band"
```

---

### Task 4: The compare pane

The right-hand document: its own editor, its own pagination controller, seeded with the live note and shown the proposal.

**Files:**
- Create: `src/editor/ComparePane.tsx`
- Create: `src/editor/ComparePane.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/editor/ComparePane.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ComparePane } from './ComparePane'
import { US_LETTER } from './pagination/geometry'

const NOTE = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Mitochondria are the powerhouse of the cell.' }],
    },
  ],
}

function renderPane(props: Partial<React.ComponentProps<typeof ComparePane>> = {}) {
  return render(
    <ComparePane
      source={NOTE}
      content="the organelle that generates ATP."
      range={{ from: 19, to: 45 }}
      geometry={US_LETTER}
      zoom={1}
      pageNumbers="off"
      {...props}
    />,
  )
}

describe('ComparePane', () => {
  it('shows the note with the suggestion applied', async () => {
    renderPane()

    await waitFor(() =>
      expect(screen.getByLabelText('Note with AI edits')).toHaveTextContent(
        'Mitochondria are the organelle that generates ATP.',
      ),
    )
  })

  it('highlights the text the suggestion inserted', async () => {
    const { container } = renderPane()

    await waitFor(() => expect(container.querySelector('.ai-range--proposed')).not.toBeNull())
    expect(container.querySelector('.ai-range--proposed')?.textContent).toContain(
      'the organelle that generates ATP.',
    )
  })

  // A preview the student can type into is not a preview. The decision is
  // accept or reject; editing here would produce a third document nobody asked
  // for and no button applies.
  it('cannot be edited', async () => {
    renderPane()

    const pane = await screen.findByLabelText('Note with AI edits')
    expect(pane).toHaveAttribute('contenteditable', 'false')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd student-notes-app && npx vitest run src/editor/ComparePane.test.tsx
```

Expected: FAIL — `Failed to resolve import "./ComparePane"`.

- [ ] **Step 3: Write the component**

Create `src/editor/ComparePane.tsx`:

```tsx
import { useEffect, useMemo, useRef } from 'react'
import { EditorContent, useEditor, type JSONContent } from '@tiptap/react'
import { editorExtensions } from './extensions'
import { PaginatedSheet } from './PaginatedSheet'
import { StaticPageZone } from './StaticPageZone'
import { PaginationController } from './pagination/controller'
import { Pagination } from './pagination/Pagination'
import { PAGE_BREAK_NAME } from './pagination/PageBreak'
import type { PageGeometry } from './pagination/geometry'
import type { PageNumberPosition } from './pagination/types'
import { applyPreview } from './previewSuggestion'

/**
 * The note as it would read with the AI edit accepted.
 *
 * A display, and only a display: nothing is ever read back out of this editor.
 * Accepting re-runs the real applier on the real document rather than
 * transplanting what is shown here, which is what keeps undo history and the
 * caret behaving. What makes the two agree is that both insert through
 * `suggestionBody` at the same resolved range.
 *
 * It carries its own pagination controller because one per editor is a hard
 * requirement of that engine -- the controller holds this document's live
 * margins, zoom and page count.
 */

const EMPTY_ZONE: JSONContent = { type: 'doc', content: [] }

interface ComparePaneProps {
  /** The live document, as it stands right now. */
  source: JSONContent
  /** The model's proposal. */
  content: string
  /** Where it goes, already resolved against `source`. */
  range: { from: number; to: number }
  /** Matched to the live pane so page breaks fall in comparable places. */
  geometry: PageGeometry
  zoom: number
  pageNumbers: PageNumberPosition
  header?: JSONContent
  footer?: JSONContent
  /**
   * The proposal could not be rendered at all. There is no error boundary
   * around this route, so an exception here would take the whole editor down
   * and cost the student their note rather than one suggestion.
   */
  onError?: (message: string) => void
}

export function ComparePane({
  source,
  content,
  range,
  geometry,
  zoom,
  pageNumbers,
  header,
  footer,
  onError,
}: ComparePaneProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const controller = useMemo(
    () => new PaginationController({ pageBreakName: PAGE_BREAK_NAME }),
    [],
  )

  const extensions = useMemo(
    () => [...editorExtensions, Pagination.configure({ controller })],
    [controller],
  )

  const editor = useEditor({
    extensions,
    content: source,
    editable: false,
    editorProps: {
      attributes: {
        class: 'outline-none',
        'aria-label': 'Note with AI edits',
      },
    },
  })

  /*
   * Seeded content is reset before the proposal goes in rather than trusted.
   * `useEditor` only takes `content` on creation, so a pane that outlives a
   * change of proposal would otherwise stack the second suggestion on top of
   * the first.
   *
   * Deps are primitives on purpose: the parent rebuilds the range object every
   * render, and depending on its identity would re-apply the suggestion on
   * every keystroke elsewhere in the page.
   */
  useEffect(() => {
    if (!editor) return
    try {
      editor.commands.setContent(source, { emitUpdate: false })
      const inserted = applyPreview(editor, content, range)
      editor.commands.setAiRange({ ...inserted, variant: 'proposed' })
    } catch (caught) {
      console.error('[ComparePane] failed to build the preview:', caught)
      onError?.("I couldn't show that suggestion. Try asking for it again.")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, source, content, range.from, range.to])

  // Bring the change into view. A preview whose only difference is three pages
  // down reads as an identical copy of the note.
  useEffect(() => {
    if (!editor) return
    const frame = requestAnimationFrame(() => {
      scrollRef.current
        ?.querySelector('.ai-range--proposed')
        ?.scrollIntoView({ block: 'center' })
    })
    return () => cancelAnimationFrame(frame)
  }, [editor, content, range.from])

  return (
    <div
      ref={scrollRef}
      className="doc-scroll flex-1 overflow-auto bg-surface-backdrop [scrollbar-gutter:stable_both-edges] sm:px-4"
    >
      <PaginatedSheet
        controller={controller}
        geometry={geometry}
        zoom={zoom}
        pageNumbers={pageNumbers}
        renderHeader={(page) => (
          <StaticPageZone
            kind="header"
            content={header ?? EMPTY_ZONE}
            pageIndex={page}
            pageNumbers={pageNumbers}
          />
        )}
        renderFooter={(page) => (
          <StaticPageZone
            kind="footer"
            content={footer ?? EMPTY_ZONE}
            pageIndex={page}
            pageNumbers={pageNumbers}
          />
        )}
      >
        <EditorContent editor={editor} />
      </PaginatedSheet>
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd student-notes-app && npx vitest run src/editor/ComparePane.test.tsx
```

Expected: PASS, 3 tests.

If jsdom throws on `scrollIntoView`, add this to `src/test/setup.ts` beside the existing `scrollTo` stub:

```ts
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}
```

- [ ] **Step 5: Commit**

```bash
cd student-notes-app
git add src/editor/ComparePane.tsx src/editor/ComparePane.test.tsx src/test/setup.ts
git commit -m "feat(editor): add the compare pane showing a note with AI edits applied"
```

---

### Task 5: The decision bar

Replaces the formatting toolbar and ruler while a decision is pending. Presentational — it holds no state of its own.

**Files:**
- Create: `src/editor/CompareBar.tsx`
- Create: `src/editor/CompareBar.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/editor/CompareBar.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CompareBar } from './CompareBar'

function renderBar(props: Partial<React.ComponentProps<typeof CompareBar>> = {}) {
  const onAccept = vi.fn()
  const onReject = vi.fn()
  const onPaneChange = vi.fn()
  render(
    <CompareBar
      pane="proposed"
      onPaneChange={onPaneChange}
      onAccept={onAccept}
      onReject={onReject}
      {...props}
    />,
  )
  return { onAccept, onReject, onPaneChange }
}

describe('CompareBar', () => {
  it('accepts', async () => {
    const { onAccept } = renderBar()
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }))
    expect(onAccept).toHaveBeenCalledOnce()
  })

  it('rejects', async () => {
    const { onReject } = renderBar()
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }))
    expect(onReject).toHaveBeenCalledOnce()
  })

  it('switches to the student’s own copy', async () => {
    const { onPaneChange } = renderBar()
    await userEvent.click(screen.getByRole('radio', { name: 'Yours' }))
    expect(onPaneChange).toHaveBeenCalledWith('yours')
  })

  it('reports which pane is showing', () => {
    renderBar({ pane: 'proposed' })
    expect(screen.getByRole('radio', { name: 'With AI edits' })).toBeChecked()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd student-notes-app && npx vitest run src/editor/CompareBar.test.tsx
```

Expected: FAIL — `Failed to resolve import "./CompareBar"`.

- [ ] **Step 3: Write the component**

Create `src/editor/CompareBar.tsx`:

```tsx
import { cn } from '../lib/cn'

/**
 * The bar shown while a proposed edit is being decided.
 *
 * Takes the place of the formatting toolbar and ruler rather than sitting
 * alongside them, which is both the room the two panes need and the signal
 * that this is a decision rather than a writing session.
 *
 * Wide enough for two pages, it labels the columns. Narrower, it switches
 * between them -- two full-width pages need roughly 1700px, and shrinking them
 * to fit a phone produces a comparison nobody can read.
 */

export type ComparePaneKind = 'yours' | 'proposed'

const PANE_LABELS: Record<ComparePaneKind, string> = {
  yours: 'Yours',
  proposed: 'With AI edits',
}

interface CompareBarProps {
  /** Which pane the narrow layout is showing. Ignored at `lg` and above. */
  pane: ComparePaneKind
  onPaneChange: (pane: ComparePaneKind) => void
  onAccept: () => void
  onReject: () => void
}

export function CompareBar({ pane, onPaneChange, onAccept, onReject }: CompareBarProps) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-3 py-2">
      {/* Column headings, at the width where there are two columns to head. */}
      <div className="hidden flex-1 lg:flex">
        <span className="flex-1 font-ui text-sm text-ink-muted">Your notes</span>
        <span className="flex-1 font-ui text-sm text-ink-muted">With AI edits</span>
      </div>

      {/* The same choice as a control, at the width where only one fits. */}
      <div
        role="radiogroup"
        aria-label="Which version to show"
        className="flex flex-1 gap-1 lg:hidden"
      >
        {(['yours', 'proposed'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={pane === kind}
            onClick={() => onPaneChange(kind)}
            className={cn(
              'rounded-full px-3 py-1 font-ui text-sm transition-colors',
              pane === kind
                ? 'bg-accent text-white'
                : 'text-ink-muted hover:bg-surface-hover',
            )}
          >
            {PANE_LABELS[kind]}
          </button>
        ))}
      </div>

      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={onReject}
          className="rounded-full px-3 py-1 font-ui text-sm text-ink transition-colors hover:bg-surface-hover"
        >
          Reject
        </button>
        <button
          type="button"
          onClick={onAccept}
          className="rounded-full bg-accent px-4 py-1 font-ui text-sm font-medium text-white transition-colors hover:bg-accent-hover"
        >
          Accept
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd student-notes-app && npx vitest run src/editor/CompareBar.test.tsx
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
cd student-notes-app
git add src/editor/CompareBar.tsx src/editor/CompareBar.test.tsx
git commit -m "feat(editor): add the compare decision bar"
```

---

### Task 6: Wire the split into DocumentEditor

Adds the `compare` prop and everything that follows from it: the panes row, the chrome swap, the freeze, and the class-based sidebar collapse.

**Files:**
- Modify: `src/editor/DocumentEditor.tsx`
- Modify: `src/editor/DocumentEditor.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append inside the existing top-level `describe('DocumentEditor', ...)` block in `src/editor/DocumentEditor.test.tsx`:

```tsx
  describe('comparing a proposed edit', () => {
    const compare = {
      content: 'the organelle that generates ATP.',
      range: { from: 19, to: 45 },
      onAccept: vi.fn(),
      onReject: vi.fn(),
      onError: vi.fn(),
    }

    const note = paragraph('Mitochondria are the powerhouse of the cell.')

    it('shows both documents and the decision bar', async () => {
      render(
        <DocumentEditor
          documentId="doc-1"
          version={1}
          initialContent={note}
          onChange={vi.fn()}
          compare={compare}
        />,
      )

      expect(await screen.findByLabelText('Note content')).toBeInTheDocument()
      expect(await screen.findByLabelText('Note with AI edits')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument()
    })

    // The formatting toolbar still drives commands on a non-editable editor,
    // so leaving it up would let the student bold text in a document they are
    // supposed to be deciding about.
    it('replaces the editing chrome so the frozen document cannot be changed', () => {
      render(
        <DocumentEditor
          documentId="doc-1"
          version={1}
          initialContent={note}
          onChange={vi.fn()}
          compare={compare}
        />,
      )

      expect(screen.queryByRole('toolbar', { name: 'Text formatting' })).toBeNull()
    })

    it('freezes the live document', async () => {
      render(
        <DocumentEditor
          documentId="doc-1"
          version={1}
          initialContent={note}
          onChange={vi.fn()}
          compare={compare}
        />,
      )

      await waitFor(() =>
        expect(screen.getByLabelText('Note content')).toHaveAttribute(
          'contenteditable',
          'false',
        ),
      )
    })

    /*
     * Regression, and the reason the sidebar is collapsed by class rather than
     * by unmounting. Rejecting depends on the panel's transcript surviving: the
     * decline handler appends "What should I change about that suggestion?" to
     * the conversation that produced the proposal. Unmount it here and that
     * conversation is gone by the time the student gets an answer.
     */
    it('keeps the assistant panel mounted while it is collapsed', () => {
      const mounted = vi.fn()
      function Panel() {
        useEffect(() => {
          mounted()
          return () => mounted.mockClear()
        }, [])
        return <p>transcript</p>
      }

      const { rerender } = render(
        <DocumentEditor
          documentId="doc-1"
          version={1}
          initialContent={note}
          onChange={vi.fn()}
          sidebar={<Panel />}
        />,
      )
      expect(mounted).toHaveBeenCalledTimes(1)

      rerender(
        <DocumentEditor
          documentId="doc-1"
          version={1}
          initialContent={note}
          onChange={vi.fn()}
          sidebar={<Panel />}
          compare={compare}
        />,
      )

      // Still one mount: collapsed, not destroyed and rebuilt.
      expect(mounted).toHaveBeenCalledTimes(1)
      expect(screen.getByText('transcript')).toBeInTheDocument()
    })
  })
```

Add `waitFor` to the `@testing-library/react` import and `useEffect` to a React import at the top of the file:

```tsx
import { useEffect } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd student-notes-app && npx vitest run src/editor/DocumentEditor.test.tsx
```

Expected: FAIL — the `compare` prop does not exist, so no compare pane and no Accept button.

- [ ] **Step 3: Add the prop and state**

In `src/editor/DocumentEditor.tsx`, add imports:

```tsx
import { ComparePane } from './ComparePane'
import { CompareBar, type ComparePaneKind } from './CompareBar'
```

Add to `DocumentEditorProps`, after `onEditableChange`:

```tsx
  /**
   * A proposed AI edit awaiting a decision.
   *
   * Non-null splits the document area in two -- the note as it stands beside
   * the note as it would stand -- freezes this editor, swaps the editing
   * chrome for a decision bar, and collapses the assistant panel.
   */
  compare?: {
    content: string
    /** Already resolved against the live document by the page. */
    range: { from: number; to: number }
    onAccept: () => void
    onReject: () => void
    /** The preview could not be built; abandon the comparison and say so. */
    onError: (message: string) => void
  } | null
```

Add `compare = null,` to the destructured parameter list.

Add beside the other `useState` calls:

```tsx
  // Which document the narrow layout is showing. Defaults to the proposal:
  // that is what the student opened the comparison to look at.
  const [comparePane, setComparePane] = useState<ComparePaneKind>('proposed')
  /*
   * The document the preview is built from, captured when the comparison
   * opens. Held as state rather than read inline so the preview is not rebuilt
   * on every render, and keyed on primitives because the page rebuilds the
   * `compare` object each time it renders.
   */
  const [compareSource, setCompareSource] = useState<JSONContent | null>(null)

  useEffect(() => {
    if (!editor || !compare) {
      setCompareSource(null)
      return
    }
    setComparePane('proposed')
    setCompareSource(editor.getJSON())
    // Outline the words being replaced, so the two panes can be lined up.
    editor.commands.setAiRange({ ...compare.range, variant: 'original' })
    return () => {
      editor.commands.clearAiRange()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, compare?.content, compare?.range.from, compare?.range.to])
```

Extend the editable effect so a pending decision freezes the document:

```tsx
  useEffect(() => {
    editor?.setEditable(editable && zone === null && !compare, false)
  }, [editor, editable, zone, compare])
```

- [ ] **Step 4: Swap the chrome and split the panes**

Still in `src/editor/DocumentEditor.tsx`, change the formatting toolbar condition so it stands down during a decision, and render the decision bar in its place:

```tsx
      {editable && !fullScreen && !compare && (
        <FormattingToolbar
          editor={editor}
          zoom={zoom}
          onZoomChange={setZoom}
          compact={compact}
          onToggleCompact={onToggleCompact}
          onPrint={onPrint}
        />
      )}

      {compare && (
        <CompareBar
          pane={comparePane}
          onPaneChange={setComparePane}
          onAccept={compare.onAccept}
          onReject={compare.onReject}
        />
      )}
```

Change the sidebar `aside` so it collapses by class instead of unmounting:

```tsx
        {sidebar && editable && !fullScreen && (
          <aside
            aria-label="AI assistant"
            className={cn(
              'w-[var(--ai-panel-w)] shrink-0 flex-col bg-surface',
              // Collapsed, never unmounted: the panel's transcript is what
              // rejecting replies into, and remounting would throw it away.
              compare ? 'hidden' : 'hidden lg:flex',
              AI_SIDEBAR_SIDE === 'left' ? 'border-r border-line' : 'border-l border-line',
            )}
          >
            {sidebar}
          </aside>
        )}
```

Change the ruler condition to `showRuler && editable && !fullScreen && !compare`.

Wrap the existing scroll container in a panes row and add the second pane. Find `<div className="flex min-w-0 flex-1 flex-col">` (the column holding the ruler and the scroll container) and, **inside it, after the ruler block**, wrap the `doc-scroll` div:

```tsx
          <div className="flex min-h-0 flex-1">
            <div
              className={cn(
                'doc-scroll flex-1 overflow-auto bg-surface-backdrop [scrollbar-gutter:stable_both-edges] sm:px-4',
                fullScreen && 'flex items-start justify-center py-10',
                // Below `lg` only one document fits, so the switch decides.
                compare && comparePane !== 'yours' && 'hidden lg:block',
              )}
              onMouseDown={(event) => {
                if (!zone) return
                if ((event.target as HTMLElement).closest('.doc-furniture')) return
                setZone(null)
              }}
            >
              {/* ...existing contents unchanged: the Mode dropdown and the
                  PaginatedSheet wrapping <EditorContent editor={editor} />... */}
            </div>

            {compare && compareSource && (
              <div
                className={cn(
                  'flex min-w-0 flex-1',
                  comparePane !== 'proposed' && 'hidden lg:flex',
                )}
              >
                <ComparePane
                  source={compareSource}
                  content={compare.content}
                  range={compare.range}
                  geometry={geometry}
                  zoom={zoom}
                  pageNumbers={pageNumbers}
                  header={header}
                  footer={footer}
                  onError={compare.onError}
                />
              </div>
            )}
          </div>
```

Two things matter here:

1. The existing `doc-scroll` subtree keeps its position in the tree — the new pane is a **sibling after it**, and the row wrapper is added unconditionally. Move it or make the wrapper conditional and `EditorContent` detaches, remounting the editor and forcing the pagination engine to re-measure from scratch.
2. Add `&& !compare` to the condition on the sticky Editing/Viewing `Mode` dropdown inside the scroll container, so it does not float over a document nobody can edit.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd student-notes-app && npx vitest run src/editor/DocumentEditor.test.tsx
```

Expected: PASS, 8 tests (4 existing + 4 new).

- [ ] **Step 6: Run the whole suite**

```bash
cd student-notes-app && npx vitest run
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
cd student-notes-app
git add src/editor/DocumentEditor.tsx src/editor/DocumentEditor.test.tsx
git commit -m "feat(editor): split the document area while an AI edit is decided"
```

---

### Task 7: Wire the page

Turns the sidebar's `onPreview` into a comparison instead of an in-document widget.

**Files:**
- Modify: `src/pages/EditorPage.tsx`

- [ ] **Step 1: Add the state**

In `src/pages/EditorPage.tsx`, add `resolveSuggestionTarget` to the existing import from `../editor/applySuggestion`, and add beside the other `useState` calls:

```tsx
  /**
   * A proposed AI edit awaiting a decision, with the panel's outcome callbacks
   * carried along. Non-null is the single source of truth for the split view:
   * panes, frozen editor, swapped chrome and collapsed chat all follow from it.
   */
  const [compare, setCompare] = useState<{
    content: string
    target: SuggestionTarget
    range: { from: number; to: number }
    onAccept: () => void
    onDecline: () => void
    onRefused: (message: string) => void
  } | null>(null)

  // Whether the drawer was open when the comparison started, so returning to
  // the chat returns it to where the student left it.
  const drawerBeforeCompare = useRef(false)
```

- [ ] **Step 2: Replace handlePreviewSuggestion**

Replace the whole of `handlePreviewSuggestion` (currently lines 394-448, including its doc comment) with:

```tsx
  /**
   * Opens a side-by-side comparison against the words the suggestion is about.
   *
   * The target is resolved here, before anything is shown. A suggestion whose
   * text can no longer be found -- or is found in several places, with nothing
   * to say which was meant -- is refused outright rather than opening a
   * comparison the student would only be able to reject.
   *
   * Nothing is written either way: the proposal lives in a second editor that
   * the document never sees, so rejecting is not an undo.
   */
  function handlePreviewSuggestion(
    content: string,
    target: AiSelection,
    outcome: {
      onAccept: () => void
      onDecline: () => void
      onRefused: (message: string) => void
    },
  ) {
    if (!editor) return

    const anchored: SuggestionTarget = { text: target.text, from: target.from, to: target.to }
    const decision = resolveSuggestionTarget(editor.state.doc, anchored)
    if (decision.status === 'refused') {
      outcome.onRefused(describeRefusal(decision))
      return
    }

    drawerBeforeCompare.current = sidebarOpen
    setSidebarOpen(false)
    setCompare({
      content,
      target: anchored,
      range: { from: decision.from, to: decision.to },
      onAccept: outcome.onAccept,
      onDecline: outcome.onDecline,
      onRefused: outcome.onRefused,
    })
  }

  /** Leaves the comparison, restoring the chat to where it was. */
  function closeCompare() {
    setCompare(null)
    setSidebarOpen(drawerBeforeCompare.current)
  }

  async function handleCompareAccept() {
    if (!compare) return
    const { content, target, onAccept, onRefused } = compare
    // Closed first: the applier writes into a document that has to be editable
    // again, and the outlined range has served its purpose.
    closeCompare()

    const result = await handleApplySuggestion(content, target)
    if (result.status === 'refused') onRefused(result.message)
    else onAccept()
  }

  function handleCompareReject() {
    if (!compare) return
    const { onDecline } = compare
    closeCompare()
    // The selection stays: a rejection is followed by saying what to change,
    // and the re-run needs the same words still highlighted.
    onDecline()
  }

  /**
   * The preview could not be built at all.
   *
   * Abandons the comparison and reports it through the panel's refusal path,
   * so the student is told rather than left in a split view showing one
   * document twice.
   */
  function handleCompareError(message: string) {
    if (!compare) return
    const { onRefused } = compare
    closeCompare()
    onRefused(message)
  }
```

- [ ] **Step 3: Add the exits**

Add after the other keyboard effects:

```tsx
  // Escape rejects. Capture phase so it settles the decision before the
  // full-screen handler on `document` sees the same key and leaves full screen
  // instead -- which would answer a question the student did not ask.
  useEffect(() => {
    if (!compare) return

    function handleKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      handleCompareReject()
    }

    window.addEventListener('keydown', handleKey, true)
    return () => window.removeEventListener('keydown', handleKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compare])

  // A proposal is about one note. Moving to another must not carry it across.
  useEffect(() => {
    setCompare(null)
  }, [doc?.id])
```

- [ ] **Step 4: Pass it down and suppress the selection toolbar**

On the `<DocumentEditor>` element, add:

```tsx
          compare={
            compare
              ? {
                  content: compare.content,
                  range: compare.range,
                  onAccept: () => void handleCompareAccept(),
                  onReject: handleCompareReject,
                  onError: handleCompareError,
                }
              : null
          }
```

And change the `SelectionToolbar` so highlighting cannot start a second action mid-decision:

```tsx
      <SelectionToolbar
        position={compare ? null : (selection?.coords ?? null)}
        onAction={(mode) => {
          if (!selection || compare) return
          setSidebarOpen(true)
          setPendingMode({ mode, selection })
        }}
      />
```

- [ ] **Step 5: Run the whole suite**

```bash
cd student-notes-app && npx vitest run
```

Expected: all green.

- [ ] **Step 6: Typecheck and lint**

```bash
cd student-notes-app && npx tsc -b && npm run lint
```

Expected: no errors. `isInlineSuggestion`, `escapeHtml`, `markdownToHtml` and `aiPreviewKey` may now be unused imports in `EditorPage.tsx` — remove any the compiler or linter flags.

- [ ] **Step 7: Commit**

```bash
cd student-notes-app
git add src/pages/EditorPage.tsx
git commit -m "feat(ai): decide a proposed edit by comparing two documents"
```

---

### Task 8: Delete the widget

The in-document Accept/Decline widget now has no callers. Removing it is what stops the codebase carrying two ways to answer the same question.

**Files:**
- Delete: `src/editor/aiPreview.ts`
- Modify: `src/editor/extensions.ts:17,62`
- Modify: `src/index.css:530-596`

- [ ] **Step 1: Confirm nothing still uses it**

```bash
cd student-notes-app && grep -rn "aiPreview\|showAiPreview\|clearAiPreview\|AiPreviewExtension" src/
```

Expected: hits only in `src/editor/aiPreview.ts` and `src/editor/extensions.ts`. Anything else must be migrated before deleting.

- [ ] **Step 2: Swap the extension**

In `src/editor/extensions.ts`, change the import on line 17 to:

```ts
import { AiRangeExtension } from './aiRange'
```

and the last entry of the `editorExtensions` array from `AiPreviewExtension,` to:

```ts
  AiRangeExtension,
```

- [ ] **Step 3: Delete the file and its styles**

```bash
cd student-notes-app && git rm src/editor/aiPreview.ts
```

In `src/index.css`, delete the `.ai-preview-original`, `.ai-preview`, `.ai-preview__body`, `.ai-preview__actions` and `.ai-preview__button*` rules (the block running from roughly line 530 to 596, ending at `.ai-preview__button--decline:hover`), along with the comment above them describing the widget. Leave the `.ai-range*` rules added in Task 1.

- [ ] **Step 4: Verify**

```bash
cd student-notes-app && npx vitest run && npx tsc -b && npm run lint
```

Expected: all green, no type errors, no lint errors.

- [ ] **Step 5: Commit**

```bash
cd student-notes-app
git add src/editor/extensions.ts src/index.css
git commit -m "refactor(editor): drop the in-document accept/decline widget"
```

---

### Task 9: Verify in the browser

`EditorPage` has no test harness in this codebase — mounting it needs the router, the auth context and every service mocked, and building that is a change of its own. The wiring added in Task 7 is therefore verified by hand.

**Files:** none.

- [ ] **Step 1: Start the app**

```bash
cd student-notes-app && npm run dev
```

Open the printed URL, sign in, and open a note with several paragraphs.

- [ ] **Step 2: Walk the happy path**

1. Highlight a sentence and run an action (the floating toolbar, or Ctrl+Alt+I).
2. When the answer arrives, confirm: the chat collapses, the formatting toolbar and ruler are replaced by the decision bar, two documents appear, the left one outlines your sentence, the right one highlights the replacement, and both are scrolled to it.
3. Confirm you cannot type into either pane.

- [ ] **Step 3: Reject**

Press Reject. Confirm the chat returns with its transcript intact and "What should I change about that suggestion?" appended, the document is unchanged, and you can type again.

- [ ] **Step 4: Accept**

Re-run the action and press Accept. Confirm the edit lands, the chat returns with a cleared transcript, the note saves ("Saved" in the title bar), and **one Ctrl+Z takes the whole edit back out as a single step**.

- [ ] **Step 5: Check the exits**

- Escape during a comparison rejects, and does not leave full screen.
- Navigating to another note mid-decision closes the comparison.
- At a narrow window (or DevTools device mode), the switch shows one document at a time and Accept/Reject still work.

- [ ] **Step 6: Commit any fixes**

```bash
cd student-notes-app
git add -A
git commit -m "fix(ai): <what the walkthrough turned up>"
```

If the walkthrough is clean, skip this step.

---

## Notes for whoever executes this

- **`applySuggestion.ts` has no tests.** 311 lines of target resolution — the module that decides which words an AI edit lands on — with no coverage. Out of scope here, and worth its own task.
- **The repo committed itself mid-session while this was being designed.** If `git status` shows work you did not do, check `git log` before assuming a clean base.
- Run `npx vitest run` after every task, not just the ones that say so. The pagination engine is measurement-driven and reacts badly to layout changes in ways unit tests catch late.
