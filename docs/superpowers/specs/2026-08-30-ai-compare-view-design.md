# AI compare view — design

Date: 2026-08-30

## Problem

When the assistant proposes a rewrite, the offer is shown twice and neither
place shows what the note would actually become.

A `SuggestionCard` renders the proposal as plain text in the sidebar
transcript, with Apply/Reject. At the same time `showAiPreview` injects a
decoration widget into the document itself — the proposal in a bordered box
wedged after the selection, its own Accept/Decline buttons floating over the
corner, and the student's own words struck through in red beneath it.

The widget answers "here is some replacement text" but not the question the
student is actually asking: *what will my notes look like if I say yes?* The
proposal sits in a box that is not the paragraph, at a width that is not the
column, breaking pages that are not the note's pages. A multi-paragraph
rewrite reads as a wall of chrome dropped into the middle of the page.

## Solution

Replace the in-document widget with a side-by-side comparison of two whole
documents: the note as it stands, and the note as it would stand. The chat
collapses to make room. Accept or Reject brings it back.

### Flow

1. Student highlights text; an action fires (toolbar, shortcut, or panel
   button). *(existing, unchanged)*
2. The model returns `proposed_content`. *(existing, unchanged)*
3. The chat collapses. The editing chrome is replaced by a decision bar, and
   the document area splits into two panes: the current note on the left,
   frozen; the note with the edit applied on the right.
4. **Reject** — the chat returns with its revision prompt, the panes collapse
   back to one, and editing resumes. The document was never touched.
5. **Accept** — the edit is written into the real document, the chat returns
   with its transcript cleared, the panes collapse back to one, and editing
   resumes.

### Deliberate departure from the original request

The request described the left pane as remaining editable. It is read-only
instead, chosen explicitly over the alternative. Freezing removes a class of
problem rather than solving it: with no edits possible between preview and
accept, the previewed result and the applied result cannot diverge, and no
position remapping is needed to keep them aligned.

## Architecture

### State

`EditorPage` gains one piece of state. Everything else derives from it.

```ts
interface AiCompare {
  /** The model's proposal, as returned. */
  content: string
  /** What the suggestion was generated against, carried from the panel. */
  target: SuggestionTarget
  /** Where it resolved to in the live document, decided before opening. */
  range: { from: number; to: number }
  /** AiSidebar's outcome callbacks, passed through untouched. */
  onAccept: () => void
  onDecline: () => void
  onRefused: (message: string) => void
}

const [compare, setCompare] = useState<AiCompare | null>(null)
```

`compare !== null` is the single source of truth for: panes split, chrome
swapped, chat collapsed, editor frozen, selection toolbar suppressed.

### AiSidebar is unchanged

`handlePreviewSuggestion` in `EditorPage` swaps its body — `setCompare(...)`
in place of `editor.commands.showAiPreview(...)` — but keeps its signature.
`AiSidebar` still calls
`onPreview(content, target, { onAccept, onDecline, onRefused })` and knows
nothing about how the offer is presented. Its existing behaviour on each
outcome survives as-is: clearing the transcript on accept, on decline setting
`revising` and appending "What should I change about that suggestion?", and on
refusal reporting the message rather than clearing the offer.

This is the boundary that makes the change small. The panel owns the
conversation; the page owns how a proposal is shown.

### Resolving the target before opening

`applySuggestion` does not trust raw positions. It resolves a target in three
steps — the captured range if the text still sitting there is the text the
suggestion was generated against; failing that a search for that text, scoped
first to the region it came from; failing that a refusal, because guessing
edits words nobody pointed at.

Compare runs that same resolution *up front*, on the live document, before
splitting the view. A target that cannot be resolved never opens a comparison
at all — it goes straight to `onRefused`, so the student is never shown a
split they cannot accept.

Freezing the left pane makes the rest deterministic. Nothing can edit the
document between resolution and accept, so the re-resolution inside
`applySuggestion` is guaranteed to take the validated-range path and land on
exactly the range the preview was built from.

### Building the preview document

The right pane hosts a real Tiptap editor, seeded with the live document, on
which the same insertion that Accept will perform is executed at the resolved
range:

```
preview editor  ←  editor.getJSON()               live content
      ↓
resolved range from resolveSuggestionTarget       same resolution Accept uses
      ↓
insertContentAt({ from, to }, body)               same insertion as
      ↓                                           applyResolvedSuggestion
inserted range = from … to + (sizeAfter - sizeBefore)
      ↓
setEditable(false)  +  setAiRange({ variant: 'proposed' })
```

`body` is derived exactly as `applyResolvedSuggestion` derives it:
`isInlineSuggestion(content) ? content : markdownToHtml(content)`.

Note this is *not* the derivation the outgoing widget used — that one passed
inline suggestions through `escapeHtml`, which is right for display but wrong
as a preview of the result. Matching the applier is the whole point.

Same extension set, same starting document, same range, same insertion — so
the right pane *is* the result, not a rendering that resembles it.

Accept does not transplant the preview's document. It calls the existing
`handleApplySuggestion` → `applySuggestion` on the real editor, which resolves,
snapshots for history, and applies through `applyResolvedSuggestion` —
including its `closeHistory` call, so one Ctrl+Z takes the whole AI edit back
out as a single step. Re-running the real path preserves undo history and
cursor behaviour in a way that transplanting a document would not.

### Decorations

`aiPreview.ts` currently owns both the position mapping and the widget UI.
The widget goes; the mapping stays. The extension becomes a plain range
marker:

```ts
interface AiRange {
  from: number
  to: number
  variant: 'original' | 'proposed'
}

setAiRange(range: AiRange): ReturnType
clearAiRange(): ReturnType
```

Removed: `buildWidget`, `button`, the `onAccept`/`onDecline` fields, the
`html` field, and the `Decoration.widget` call. Kept: the plugin's `apply`,
including outward position bias and the "range collapsed, drop the offer"
guard.

| Pane  | Variant    | Treatment                                        |
|-------|------------|--------------------------------------------------|
| Left  | `original` | Dashed outline around the text being replaced    |
| Right | `proposed` | Soft accent background behind the inserted text  |

The red strikethrough in `.ai-preview-original` goes with the widget. Nothing
is struck out any more — the other pane shows the replacement, so marking the
original as deleted overstates what is being offered.

Both panes scroll their marked range into view when compare opens.

### Layout

During compare, `DocumentEditor` swaps its editing chrome for a decision bar
and splits the document area:

```
┌──────────────────────────────────────────────────────────┐
│  Your notes            With AI edits    [Reject][Accept] │  CompareBar
├────────────────────────┬─────────────────────────────────┤
│  ╔══════════════════╗  │  ╔═══════════════════════════╗  │
│  ║   [header]       ║  │  ║   [header]                ║  │
│  ║                  ║  │  ║                           ║  │
│  ║  Mitochondria    ║  │  ║  Mitochondria are the     ║  │
│  ║  ┌ ─ ─ ─ ─ ─ ─ ┐ ║  │  ║  ░organelles that░        ║  │
│  ║  │are the      │ ║  │  ║  ░generate most of░       ║  │
│  ║  │powerhouse   │ ║  │  ║  ░the cell's ATP.░        ║  │
│  ║  └ ─ ─ ─ ─ ─ ─ ┘ ║  │  ║                           ║  │
│  ║          1       ║  │  ║          1                ║  │
│  ╚══════════════════╝  │  ╚═══════════════════════════╝  │
│   own scroll           │   own scroll                    │
└────────────────────────┴─────────────────────────────────┘
```

Each pane scrolls independently: notes run long, and each pane auto-scrolls to
its own marked range. Both receive the same `geometry`, `zoom` and
`pageNumbers`, so page breaks fall in comparable places and the comparison is
like-for-like.

**The existing subtree keeps its React identity.** The current `doc-scroll`
container is wrapped once, unconditionally, in a flex row; the compare pane is
added as a sibling *after* it. Nothing about the live editor's position in the
tree changes when compare opens, so `EditorContent` never detaches and the
pagination engine never re-measures from scratch.

### ComparePane

A new component owning everything the second document needs:

- Its own `PaginationController`. One per editor is a hard requirement of the
  pagination engine — it carries that document's live margins, zoom and page
  count.
- Its own `useEditor` over `editorExtensions`, `editable: false`.
- Its own `PaginatedSheet`, given the same geometry, zoom and page-number
  position as the live one.
- Header and footer rendered as static HTML on every page via `generateHTML`,
  never as live `PageZone`s. The preview is not a place to edit furniture.

Inputs: `content`, `target`, `geometry`, `zoom`, `pageNumbers`, `header`,
`footer`, and the live document JSON. Output: none — it is a display. The
page reads nothing back out of it.

### Freezing

`setEditable(false)` is not by itself a freeze. A non-editable Tiptap editor
still accepts programmatic commands, so the formatting toolbar would bold text
in a "frozen" document. The freeze is therefore three things together:

1. `editor.setEditable(false)`, restored on exit.
2. `FormattingToolbar` and `Ruler` replaced by `CompareBar` — which also
   signals visually that this is a decision, not a writing session.
3. `SelectionToolbar` suppressed, so highlighting text in either pane cannot
   fire a second AI action mid-decision.

`DocumentMenubar` stays. Its navigation and print items are harmless, and its
edit items already follow the editor's own disabled state.

### Collapsing and restoring the chat

The two copies of `AiSidebar` need different treatment, and getting this
wrong silently breaks Reject.

**Docked panel (≥1024px)** — collapsed with a `hidden` class, never by
unmounting. The `aside` in `DocumentEditor` is conditionally rendered today;
extending that condition with `!compare` would destroy the panel's `turns` and
`revising` state, and Reject depends on both to append its revision prompt to
the conversation that produced the proposal.

**Drawer (<1024px)** — `sidebarOpen` is stashed when compare opens, forced
false, and restored on exit. `AiDrawer` translates its children off-screen
rather than unmounting them, so its transcript is already safe.

### Narrow screens

Two full-width pages need roughly 1700px. Below the `lg` breakpoint — the same
breakpoint the docked panel and ruler already use — `CompareBar` shows a
segmented **Yours / With AI edits** switch and one pane at a time.

Defaults to the AI side: that is what the student opened the comparison to
look at. Both panes stay mounted; the inactive one is hidden by class, so
switching costs nothing and neither editor re-initialises.

## Exits

| Trigger | Result |
|---|---|
| Accept | `applySuggestion` resolves, snapshots, inserts, flushes autosave → compare closes → chat returns, transcript cleared |
| Accept refused | compare closes → chat returns showing the refusal message → document untouched. Should be unreachable while frozen, since resolution already succeeded before opening; handled because `applySuggestion` can still refuse and a silent no-op is indistinguishable from a bug |
| Reject | compare closes → chat returns with revision prompt → document untouched, no undo needed |
| Escape | identical to Reject; takes priority over the full-screen exit binding |
| Target unresolvable | compare never opens; `onRefused` fires directly from `handlePreviewSuggestion` |

Leaving compare always restores: editor editable, chrome back, chat back to
the state it was in when compare opened.

## Error handling

- **Preview editor fails to build.** `insertContentAt` throwing on malformed
  model output must not strand the student in a broken split. Compare closes,
  the chat returns, and the sidebar reports the failure through its existing
  error path.
- **Note navigated away mid-decision.** Compare state is cleared when
  `documentId` changes; a proposal about one note must never be offered
  against another.
- **Accept while offline.** Unchanged from today. `handleApplySuggestion`
  writes to the editor and flushes; `saveDocument` reports its own failure
  through `SaveStatus`.

## Testing

- Reaching compare: a proposal with a resolvable target opens the split,
  collapses the chat, and freezes the editor.
- Unresolvable target: compare never opens and `onRefused` fires — covering
  both `not-found` and `ambiguous`.
- Preview fidelity: the preview document equals the document produced by
  accepting — asserted by comparing JSON, which is the property the whole
  design rests on. Worth asserting for an inline suggestion specifically,
  since that is the case where the old widget's `escapeHtml` derivation and
  the applier's disagree.
- Undo: one Ctrl+Z after accepting restores the pre-edit document in a single
  step, including when the student typed immediately before the action.
- Reject: document JSON is byte-identical to before, chat is back, transcript
  retains the revision prompt, editor is editable again.
- Accept: document contains the proposal, chat is back with an empty
  transcript, editor is editable again.
- Chat state survives: transcript contents are preserved across a full
  open → reject cycle on the docked panel. This is the regression the
  `hidden`-versus-unmount decision exists to prevent.
- Escape rejects.
- Narrow screens: the switch toggles panes without remounting either editor.

## Files

| File | Change |
|---|---|
| `src/editor/aiPreview.ts` | Widget and buttons removed; becomes a two-variant range marker |
| `src/editor/ComparePane.tsx` | **New** — read-only preview editor, own controller and sheet |
| `src/editor/CompareBar.tsx` | **New** — pane labels, Accept/Reject, narrow-screen switch |
| `src/editor/DocumentEditor.tsx` | `compare` prop; panes row; chrome swap; class-based sidebar collapse |
| `src/pages/EditorPage.tsx` | Compare state, accept/reject wiring, drawer restore, Escape |
| `src/index.css` | `.ai-preview*` rules replaced by `.ai-range--original` / `.ai-range--proposed` |

## Out of scope

The `SuggestionCard` in the transcript and its `Fix this` buttons keep their
current behaviour: they call `onApply` and write directly, without a
comparison. This change is scoped to the selection → prompt → answer flow.

Routing those through compare as well is a reasonable follow-up, but they
differ in kind — an issue fix is a one-clause correction the student can read
in full inside the card, where a full-document comparison is more ceremony
than the decision needs.
