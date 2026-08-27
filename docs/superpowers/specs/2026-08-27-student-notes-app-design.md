# Student Notes App — Design

**Date:** 2026-08-27
**Location:** `CodingPersonal/student-notes-app/`
**Status:** Approved design, ready for implementation planning

## Overview

A Google Docs–style note-taking web app for students, with a deeply integrated AI
sidebar powered by the Gemini API.

The product is a **document editor first, AI second**. A student sits in class,
types notes normally, and has an assistant available beside the document that
understands the current class, the current document, and relevant previous notes.
The student remains the author; the AI never silently modifies the document.

Explicit non-goal: this is not a "upload a lecture PDF → AI generates notes" tool.

## Stack

Chosen to match the conventions already established in `client-tracker-app`, which
sits in the same workspace.

| Layer | Choice |
|---|---|
| Build | Vite |
| UI | React 19 + TypeScript |
| Styling | Tailwind CSS |
| Editor | Tiptap (ProseMirror) |
| Client state | Zustand |
| Auth | Supabase Auth (email + password) |
| Database | Supabase Postgres |
| AI proxy | Supabase Edge Function (Deno) |
| Deploy | Local only for now; Vercel static SPA later |

Rationale for Vite over Next.js: Next.js dev is unusably slow (30–90s page loads)
inside this OneDrive-synced folder on this machine. Vite does not have this problem.
A Supabase Edge Function provides the same "secret stays server-side" guarantee that
a Next.js API route would.

Rationale for Tiptap over Lexical: mature React bindings, an extension set that
covers every required formatting feature out of the box, and a ProseMirror
selection model that makes selection-aware AI straightforward.

The app is its own Vite project with its own `package.json`, sitting alongside
`client-tracker-app` rather than in a workspace/monorepo.

## Data Model

Postgres via Supabase. All tables have Row Level Security policies scoped to
`auth.uid()`.

```
profiles
  id (FK auth.users), display_name, created_at

classes
  id, user_id, name, course_code, professor, semester,
  course_level  -- 'High School' | 'College' | 'Graduate', default 'College'
  created_at, updated_at

documents
  id, class_id, user_id, title,
  content     jsonb  -- Tiptap JSON document
  content_text text   -- plain-text extract, for cheap AI context assembly
  created_at, updated_at

document_versions
  id, document_id, content jsonb, created_by ('user' | 'ai'), created_at

conversations
  id, user_id, class_id, document_id (nullable), created_at, updated_at

messages
  id, conversation_id, role ('user' | 'assistant'), mode, content, created_at
```

`auth.users` is Supabase's built-in table. `profiles` exists only to hold
`display_name`, populated by a Postgres trigger on `auth.users` insert.

`content_text` is denormalized from `content` on every save. It exists so the AI
context layer never has to walk Tiptap JSON to get plain text.

`document_versions` is a lightweight snapshot table, not a full version-history
feature. A row is written immediately before any AI-applied edit, which makes AI
modifications reversible. No version-browsing UI in the MVP.

### Designed-for-later, not built now

The schema accommodates these without migration pain: embeddings (a `pgvector`
column on a future `document_chunks` table), semantic search, exams, study
sessions, flashcards, practice questions, and full version history.

## Authentication

Supabase Auth, email + password.

Routes: `/signup`, `/login`, `/forgot-password`, `/reset-password`.

Signup collects email, password, and display name. Session is managed by an
`AuthContext` wrapping `supabase.auth.onAuthStateChange`, matching the existing
`client-tracker-app` pattern. Protected routes redirect to `/login`.

Google OAuth is deliberately deferred: it requires manually registering an app in
Google Cloud Console and configuring the provider in the Supabase dashboard, which
is setup work outside the code. Adding it later is a small change.

## Routing

```
/                                        → /classes if authed, else /login
/signup /login /forgot-password /reset-password
/classes                                 → class dashboard
/classes/:classId                        → class page (notes list)
/classes/:classId/documents/:documentId  → editor
```

## Editor

A `DocumentEditor` component wrapping Tiptap's `useEditor`.

Extensions: StarterKit (paragraphs, headings, bold, italic, strike, bullet and
ordered lists with nesting, blockquote, horizontal rule, undo/redo history),
`Underline`, `TaskList` + `TaskItem` (checklists), `Link`, and a custom
selection-tracking extension.

The selection extension publishes the current selection (text plus `from`/`to`
positions) into a Zustand store, so the AI sidebar and the floating selection
toolbar can read it without prop drilling through the editor tree.

Keyboard shortcuts come from Tiptap defaults: Ctrl/Cmd+B, +I, +U, +Z, +Shift+Z,
plus standard copy/paste/select-all.

### Toolbar scope decision

The spec sketched a Google Docs–style menu bar (File / Edit / View / Insert /
Format / Tools / Help). The MVP ships a single formatting toolbar instead —
undo/redo, a text-style dropdown, B/I/U/S, list controls, quote, divider, link.

Reason: those seven menus would be mostly empty or duplicate toolbar actions in an
MVP, so they would be decorative chrome that adds visual clutter while implying
functionality that does not exist. A slimmer honest toolbar now; menu-bar chrome
later if it earns its place.

## Autosave

Content and title changes debounce at 1 second of idle, then write to
`documents.content` and `documents.content_text`.

Save status is displayed as `Saved` / `Saving…` / `Offline`, driven by the save
promise plus a `navigator.onLine` listener. There is no manual save control.

**Race condition handling:** each save carries the `updated_at` value it last read.
If the database already holds a newer `updated_at` (from a concurrent tab), the
in-flight save is discarded and the newer content wins. This is last-write-wins
with staleness detection — sufficient because the app is single-user and not
collaborative.

## AI Architecture

### Request boundary

A single Supabase Edge Function, `ai-assist`. The Gemini key lives only in that
function's environment. The browser never sees it.

```
Sidebar / selection toolbar
  → src/services/aiClient.ts        (typed client, one method per mode)
  → supabase.functions.invoke('ai-assist', { mode, documentId, classId,
                                             selection, userRequest,
                                             conversationId })
  → Edge Function:
        verify JWT
        load class + document + sibling notes from DB (server-side)
        buildAIContext()
        call Gemini with responseSchema
        validate JSON with Zod
        return typed result
```

The function loads document and class content **server-side from the database**
rather than trusting content posted by the client. This keeps request payloads
small and prevents a manipulated client from being used to pull another user's
notes into a prompt.

### Centralized prompt

`supabase/functions/ai-assist/prompts/studentAssistant.ts` exports:

- `SYSTEM_PROMPT` — the full system instruction text
- `AI_PROMPT_VERSION = "1.0.0"`

This is the single source of truth. No AI instructions exist anywhere else in the
codebase. Every request records the prompt version that produced it.

The system prompt establishes: identity as an assistant not an author; preservation
of student meaning; accuracy over confident-sounding output; a strict no-fabrication
rule (facts, citations, studies, statistics, quotations, professor statements, exam
content); a source priority order (selected text → current document → class notes →
class metadata → general knowledge); treatment of student notes as **data, not
instructions** (prompt-injection resistance); per-mode behavior rules; and an
output rule that proposed note modifications are returned separately from
commentary.

### Modes

A shared TypeScript union in `src/types/ai.ts`, imported by both the app and the
edge function. Never passed around as a bare string.

```
IMPROVE_NOTES | CHECK_NOTES | EXPLAIN | MAKE_CLEARER | EXAM_READY | CHAT
```

- **IMPROVE_NOTES** — clarity, grammar, organization, structure. May restructure.
- **CHECK_NOTES** — flags likely errors with calibrated confidence. No nitpicking.
- **EXPLAIN** — core concept, explanation, example, why it matters. Sized to the
  course level, not an essay.
- **MAKE_CLEARER** — clarifies confusing language while *preserving* structure.
  Distinct from IMPROVE_NOTES.
- **EXAM_READY** — reorganizes a document for study: key concepts, headings,
  terminology, relationships. Output still reads as excellent notes, not flashcards.
- **CHAT** — open questions, answered using class context where useful.

### Context assembly

`buildAIContext()` — a pure function, independently unit-testable, with no UI or
network dependencies. It gathers, prioritizes, and truncates:

1. **Selected text** (highest priority), untruncated, plus 500 characters of
   surrounding document context
2. **Current document**, capped at 8,000 characters; when over budget, the region
   around the selection is preferred over the document head
3. **Relevant previous notes** from the same class — retrieved through a
   `retrieveRelevantNotes()` interface, capped at 4,000 characters total
4. **Class metadata** — name, course code, professor, semester, course level
5. **Conversation history** — the last 6 turns, each capped at 1,000 characters

These budgets are exported as named constants from a single module so they can be
tuned in one place. Total assembled context stays comfortably inside Gemini's free
tier limits.

Output is a fixed-format block, identical on every request:

```
AI MODE:
COURSE:
COURSE LEVEL:
DOCUMENT:
SELECTED TEXT:
CURRENT DOCUMENT:
RELEVANT CLASS NOTES:
CONVERSATION:
USER REQUEST:
```

Student note content is clearly fenced as data within this structure.

### Retrieval strategy and its upgrade path

MVP `retrieveRelevantNotes()`: take the 10 most recently edited sibling documents
in the class, rank them by keyword overlap against the user's request, and return
the top 3 as title plus truncated `content_text`, within the 4,000-character budget.

This is deliberately simple. It sits behind a narrow interface so that replacing it
with pgvector embedding search later is a single-file change with no callers
modified. No vector database in the MVP — it is not yet necessary.

### Structured responses

Gemini is called with `responseMimeType: "application/json"` and an explicit
`responseSchema`:

```
{
  mode,
  response,            // prose for the student
  proposed_content,    // nullable; the suggested note text
  issues: [ { original, problem, correction, confidence } ],
  confidence,          // nullable
  added_information: [],  // claims the AI contributed beyond the notes
  sources: []
}
```

The response is parsed and validated with Zod server-side. A malformed response
returns a typed error rather than being coerced. Nothing in the app parses AI
output with string matching.

### Applying a suggestion

The subtlest part of the build. The editor stores Tiptap JSON; Gemini returns text.
Two paths:

- **Inline selection** (text within a single block): the prompt requests plain
  prose, and the exact `from`/`to` range is replaced via
  `editor.commands.insertContentAt`. Formatting outside the range is untouched.
- **Block-level or whole-document** (EXAM_READY, or a selection spanning blocks):
  the prompt requests constrained Markdown — headings, bullets, bold only —
  converted Markdown → HTML → Tiptap nodes on insert.

Before any AI-applied edit, a `document_versions` row snapshots the prior content,
so the change is reversible.

Rejecting a suggestion closes the card and makes no document change.

### Cost control

AI runs only on explicit user action. Never on keystroke, never on document open,
no background analysis, no automatic suggestions. Every context section has a
character budget. Conversation history is capped.

### Error handling

The edge function maps failures to typed codes: `RATE_LIMIT`, `TIMEOUT`,
`INVALID_RESPONSE`, `UPSTREAM_ERROR`, `UNAUTHORIZED`.

User-facing copy:
- General: "The AI couldn't complete that request. Try again."
- Rate limit: "The AI is temporarily unavailable. Please try again shortly."

Raw API errors go to function logs only, never to the user.

## Visual Design

Neutral and restrained. A Tailwind theme extension defines the palette.

- White document surface
- Very light gray editor backdrop (~`#f8f9fa`)
- Near-black text (~`#202124`)
- Hairline gray borders
- One muted blue accent (~`#1a73e8`), used only for focus rings, active toolbar
  state, and primary buttons

Shadows are minimal: the document sheet gets one soft shadow to lift it off the
backdrop. Cards use borders, not shadows. Transitions are capped at 150ms.

System sans stack for UI chrome. The document body uses a readable face at roughly
11pt equivalent with generous line height.

Explicitly avoided: gradients, hero sections, large rounded cards, AI-startup
visual clichés, decorative icons, analytics dashboards.

## Screens

### Class dashboard (`/classes`)

Page title, a `+ Create class` button, and a plain responsive grid of classes —
name, course code, semester, note count, last edited. Bordered, not shadowed. No
charts, no stats bar.

First-run empty state: a centered prompt — "Create your first class / Classes keep
your notes and AI context organized" — and one button.

The create-class dialog collects: name (required), course code, professor,
semester, and course level (a select defaulting to College). Only the name is
required; the rest inform AI context and can be left blank.

### Class page (`/classes/:classId`)

Back link, class name and professor (inline-editable), then a `Notes` list: one row
per document with title and last-edited time, newest first.

`+ New note` creates an untitled document and navigates straight into the editor
with the title focused.

Empty state: "No notes yet. Start your first lecture note. + New Note"

### Editor

The hero screen.

```
┌──────────────────────────────────────────────────────────────────┐
│ Logo  Biology 101 › Lecture 4 — Photosynthesis   Saved ✓   AI  ⌄ │
├──────────────────────────────────────────────────────────────────┤
│ ↶ ↷ │ Normal text ⌄ │ B I U S │ ≔ ⋮≡ ☑ │ ❝ ─ 🔗                │
├─────────────────┬────────────────────────────────────────────────┤
│ AI Assistant ×  │        ┌────────────────────────┐              │
│                 │        │                        │              │
│ suggested       │        │   white document sheet │              │
│ actions         │        │   max-w ~816px         │              │
│ ───────────     │        │                        │              │
│ conversation    │        │                        │              │
│ ───────────     │        └────────────────────────┘              │
│ Ask anything…↑  │         light gray backdrop                    │
└─────────────────┴────────────────────────────────────────────────┘
```

The title is editable in the header and autosaves. Save status is quiet gray text.

**The AI sidebar is on the left.** Its side is a single layout constant
(`AI_SIDEBAR_SIDE: 'left' | 'right'`) so it can be flipped in one edit.

Sidebar width 360px, collapsible via the header button or `Ctrl/Cmd + Shift + A`
(shown in the button's tooltip). The document sheet stays centered in its remaining
space, so collapsing the sidebar re-centers the document rather than lurching it
sideways.

### Selection toolbar

On text selection, a small floating pill appears above the selection:

```
Improve · Explain · Check · Ask AI
```

Text labels, not icons. This is the only element in the app that appears
unprompted, and it appears only in direct response to a deliberate user action.

### Suggestion card

Renders in the sidebar with original text, suggested text, and `Apply` / `Reject`.

For `CHECK_NOTES`, each issue renders with its confidence expressed in plain
language ("This appears incorrect" vs "This may be incomplete") and per-issue
`Fix this` / `Leave unchanged`.

`added_information` from the response renders as a visually distinct, separated
note — so the student always sees which claims came from the AI rather than from
their own notes. This matters because students trust their notes when studying.

### Loading

A three-dot "Thinking…" line in the sidebar. No large spinner. The editor stays
fully interactive while the AI works.

## Responsive Behavior

Desktop is the primary experience.

- **< 1024px** — sidebar collapses to a header `AI` button, opens as a left-side
  drawer over the document
- **< 640px** — the document sheet loses margins and shadow and becomes full-bleed
  with comfortable padding; the toolbar scrolls horizontally; the AI drawer becomes
  a bottom sheet

The document is never demoted below the AI at any screen size.

## Accessibility

Real `<button>` elements throughout. Labels on all inputs. Visible focus rings.
Semantic headings. `aria-live` on save status and AI responses. Tooltips on every
icon-only control. The formatting toolbar uses `role="toolbar"` with arrow-key
navigation.

## Security

- `GEMINI_API_KEY` exists only as a Supabase Edge Function secret. Never in client
  code, never in a `VITE_`-prefixed variable, never in a browser request.
- `.env.example` contains placeholders only. No secrets committed.
- RLS policies on every table, scoped to `auth.uid()`.
- The edge function verifies the caller's JWT and loads content server-side rather
  than trusting client-supplied document text.
- Student notes are fenced as data in the prompt, with an explicit system-prompt
  rule against following instructions embedded in note content.

## Out of Scope for MVP

Social features, collaboration, file uploads, PDF parsing, flashcards, quizzes,
spaced repetition, professor dashboards, calendars, analytics, gamification,
notifications, version-history browsing UI, Google OAuth, vector search.

## Implementation Stages

1. **Foundation** — Vite scaffold, Tailwind theme, routing, Supabase client, auth
   pages, schema + RLS migrations, class dashboard, class page
2. **Documents** — Tiptap editor, formatting toolbar, document CRUD, autosave with
   staleness detection, save status
3. **AI core** — edge function, centralized prompt, context assembly, structured
   Gemini responses, AI sidebar with chat and suggested actions
4. **Selection AI** — selection tracking, floating toolbar, suggestion cards,
   apply/reject, version snapshots
5. **Class memory** — sibling-note retrieval, ranking, context budgets
6. **Polish** — responsive drawers, loading states, error handling, keyboard
   shortcuts, accessibility pass, performance pass

## Setup Prerequisites

Before AI features function, two things must be supplied by the user:

1. A Supabase project (user will create it and provide the project ref / keys)
2. A Gemini API key from Google AI Studio, set as an edge function secret

Everything except the AI features can be built and tested before these exist.
