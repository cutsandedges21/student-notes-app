# Margin — Production Rebuild Programme

Lead-engineer plan for turning the current app into a trustworthy, production-quality
student notes product with a genuinely useful AI assistant.

Status legend: `TODO` · `IN PROGRESS` · `DONE` · `BLOCKED` · `DEFERRED (reason)`

---

## Baseline (2026-08-30)

Measured, not assumed:

| Signal | Value |
| --- | --- |
| Source size | ~13,400 lines across `src/` + `supabase/functions/` |
| Tests | 159 passing, 22 files — almost entirely pure functions |
| `tsc -b` | clean |
| `oxlint` | 9 warnings (`set-state-in-effect` ×4, `only-export-components` ×2, `refs` ×1, `no-eval` ×1, +1) |
| Stack | React 19, Vite 8, Tiptap 3.30, Supabase JS 2, react-router 7, Tailwind 3, Zustand 5, Vitest 4, oxlint |
| Not installed | Playwright, Zod, Yjs, Tiptap table/math/super-subscript, KaTeX |
| Baseline commit | `1d27b74` on `rebuild/phase-0-data-integrity` |

The pagination engine (`src/editor/pagination/`), the share-token SECURITY DEFINER
design, the coordinate-space geometry model, and the existing pure-function tests are
**good work and are to be preserved and improved, not replaced.**

---

## Priority order (non-negotiable)

> Data integrity → architecture → testing → collaboration/comments → editor parity →
> mobile → AI intelligence → polish

A large amount of prior effort went into Docs-like chrome and page rendering while the
defining systems — trustworthy editing, comments, collaboration, AI — are incomplete.
That imbalance is what this programme corrects.

---

## Confirmed defects (verified in current code, not taken on faith from the audit)

| ID | Defect | Evidence |
| --- | --- | --- |
| A1 | AI apply replaces the **entire document** when the range is null | `EditorPage.tsx` `handleApplySuggestion` — `else { editor.chain().focus().setContent(...) }`. Reached via `AiSidebar.applyIssueFix` → `onApply(correction, null)`, and via `SuggestionCard onApply={(c) => onApply(c, selection)}` using the *live* selection |
| A2 | Title edit → autosave → re-slug → route change → document reload | `EditorPage.persist` re-fetches and `navigate()`s on every slug change; `DocumentEditor` re-runs `setContent` keyed on `documentId`/`version` |
| A3 | Header/footer leak between documents | `PageZone` uses `useEditor({ content })` (initial-only) and is not keyed on document identity; `DocumentEditor` is never remounted on navigation |
| A4 | Slug churn — every save re-slugs | `documents.saveDocument` does `fetchDocument` + `takenDocumentSlugs` + reslug on **every** call that passes `classId` (which is every autosave) |
| A5 | Duplicate class names break "make a copy" | `sharing.copySharedDocument` uses `.eq('name', …).maybeSingle()`; no unique constraint on `classes(user_id, name)` |
| A6 | Guest migration drops data | `migrateGuestData` carries only `title`/`content`; drops `header`, `footer`, `page_numbers`; starred state lives only in `localStorage` under `margin:starred:*` with no column |
| A7 | Storage failure reports "Saved" | `guestStore.write()` catches and logs quota errors; `guestSaveDocument` still returns `{status:'saved'}` |
| — | Two independent AI state machines | Docked `AiSidebar` and `AiDrawer` `AiSidebar` are separately mounted with separate `turns` state |
| — | AI output under-validated | `parseAiResponse` never checks `confidence`; `confidence: "banana"` passes |
| — | CORS wildcard | `ai-assist/index.ts` `Access-Control-Allow-Origin: '*'` |
| — | No rate limiting / quota / spend control on the AI endpoint | `ai-assist/index.ts` |
| — | False product claims | `UpgradePage` advertises version-history restore, PDF/Word export, offline mobile editing, priority AI, and a 50-note limit — none implemented or enforced |
| — | Browser-native product UI | 13 uses of `window.prompt`/`alert`/`confirm` across menubar, toolbar, class pages, editor |
| — | Vite starter README | `README.md` |
| — | No migrations, no config.toml, no CI | `supabase/` holds a single hand-run `schema.sql` |

Resolved without work: the configured Gemini model `gemini-3.6-flash` **is** a current
stable model. Keep it configurable via the `GEMINI_MODEL` secret; `gemini-3.7-flash` is
the newer option.

---

## Execution phases

### Phase 0 — Stop data loss `DONE`

All seven P0 defects fixed and covered by tests. **253 tests** (from 159), `tsc`
clean, 9 lint warnings unchanged, production build green.

| ID | Fix | Commit |
| --- | --- | --- |
| A1 | Anchored AI replacement; no whole-document fallback exists any more | `10ad704` |
| A3 | Page furniture keyed on document identity | `10ad704` |
| A5 | Deterministic destination class; id preferred over name | `b379383` |
| A6 | Exhaustive field plan + per-account migration ledger | `b379383` |
| A7 | Storage refusal is a distinct save result, surfaced with a recovery export | `b379383` |
| A2 | Immutable-id addressing; a rename cannot reload the document | `998ee71` |
| A4 | Re-slugging is opt-in; autosave is one round trip, not three | `998ee71` |
| — | Stale saves no longer discard the writer's work | `998ee71` |

Two notes for later phases:

- **Caret position after navigation is untested.** jsdom cannot observe DOM focus
  moved by Tiptap's `focus()` command, so the furniture test asserts on
  `contenteditable` — the state it is actually about — and caret placement is
  deferred to the Playwright suite in Phase 1.
- **The conflict dialog is the honest stopgap, not the answer.** It exists because
  there is no shared document state. Phase 2 replaces it for genuinely concurrent
  editing; it should remain for the cross-tab case.

### Phase 0 archive — original plan `DONE`

No feature work begins until every item here is fixed **and covered by tests**.

**Wave 1 (parallel, disjoint file ownership):**

| Agent | Scope | Owns |
| --- | --- | --- |
| α Editor Correctness | A1 — safe anchored AI replacement | `pages/EditorPage.tsx`, `ai/*`, new `editor/applySuggestion.ts` |
| β Guest Data & Sharing | A5, A6, A7 | `services/*`, `components/SaveStatus.tsx`, `components/StorageNotice.tsx`, `types/database.ts`, `supabase/schema.sql` |
| γ Page Furniture | A3 | `editor/DocumentEditor.tsx`, `editor/PageZone.tsx` |

**Wave 2 (sequential, after Wave 1 lands):**

| Agent | Scope |
| --- | --- |
| δ Document Lifecycle Architect | A2 + A4 — immutable-ID routing, title/slug separation, lifecycle state machine, stale-request protection. Rewrites the `EditorPage` orchestrator, so it runs alone |

Wave 2 deliberately follows Wave 1: δ refactors the orchestrator, and Wave 1's tests are
the safety net that makes that refactor reviewable.

### Phase 1 — Foundation `DONE` (two items blocked, below)

**290 unit tests** (from 253), **10 E2E**, `tsc` clean, 9 lint warnings unchanged,
build green.

| Item | Outcome |
| --- | --- |
| C1 migrations | 513-line `schema.sql` → 8 migrations, verified 91-for-91 statements. `schema.sql` deleted so there is one source of truth |
| C2 config | `supabase/config.toml`, Postgres 17 to match the hosted project |
| C3 deployment | Regex bundler and committed `_bundled.ts` deleted; the CLI deploys the real multi-file source |
| C4 CI | Lint → typecheck → unit → build, plus a separate E2E job |
| C5 README | Replaced the Vite template; states the known gaps plainly |
| Security | CORS allowlist (was `*`), Postgres-enforced quota, request/output caps, Zod validation, security headers |
| E2E | Playwright against a production build, signed out |

**Found and fixed by the E2E suite on its first run:** autosave debounces 1s and
React's unmount cleanup does not run on a browser reload, so anything typed in
that window was lost. `useFlushOnUnload` closes it — a real guarantee for guest
notes (synchronous localStorage), best effort for signed-in ones.

**Also closed:** the caret-after-navigation assertion Phase 0 recorded as
untestable in jsdom now runs in a real browser.

#### Blocked — not done, not faked

1. **Migrations are written but not applied.** `.env` points at Supabase project
   `kttsiipsrrcfanrlkevj`, which is **not in the authenticated CLI account** —
   `supabase projects list` returns four other projects, and the MCP sees a
   fifth. The project is live (its REST endpoint answers 401, not 404), so this
   is an access problem rather than a dead ref. Nothing has been applied, and
   nothing should be until someone with access runs `npm run db:push`.
2. **Migrations are unvalidated against a real Postgres.** `supabase start`
   needs Docker; it is installed but the daemon is not running here. The
   91-statement equivalence check is a structural proof, not an execution one.
   `npm run db:reset` is the real test and has not been run.

**Re-verified 2026-09-01, both still true.** `supabase projects list` returns
`gkbloibtkszaowxcnhzr`, `byxnkwxmpindjqvdyalf`, `apkysupvpahnkibjfrin` and
`xomxqoqcyxrilrhvpole` — `kttsiipsrrcfanrlkevj` is not among them. Docker is
installed and the daemon is still down.

**Decision (owner, 2026-09-01): leave it.** Schema reaches the database by pasting
`supabase/.generated/apply-all.sql` into the Supabase dashboard, not by
`db push`. That works, and it is the workflow that has in fact been shipping
schema all along. The cost is accepted and recorded here rather than hidden:
nothing verifies that the live schema matches the migration history, so drift
will go undetected until something fails at runtime — which is exactly how
`redeem_share_token` stayed broken through a green test suite.

The standing obligation that follows: **any agent adding a migration must run
`npm run db:bundle` and leave the regenerated bundle in the tree.** A migration
that is not in the bundle never reaches the database.

**CSP ships report-only, deliberately.** Enforcing it without driving the print
path through a browser would ship an unverified change to printing — the kind
that fails at a printer where nobody can diagnose it.
`docs/security-headers.md` records what must happen to flip it, and the
Playwright suite landing in this phase is what makes that possible.

### Phase 2 — Collaboration + comments `DONE`

Collaboration first, comments second, as planned: comment anchors had to survive
concurrent edits before they were worth building.

**503 unit tests** (from 290), 47 files. `tsc` clean, 9 lint warnings unchanged,
build green.

| Item | Outcome | Commit |
| --- | --- | --- |
| Transport | Yjs over Supabase Realtime — one private channel per document, authorised by RLS on `realtime.messages` so a channel cannot be joined by guessing a document id. Hocuspocus stayed ruled out; there is no persistent WebSocket server on Vercel | `183ab15` |
| Convergence | `YjsProvider` with `y-protocols` awareness; durable Yjs storage behind it | `67654d8`, `183ab15` |
| Both editors | Collaboration wired through the main and shared editors, closing the seam where one was CRDT-backed and the other was not | `7f7b8c6` |
| Presence | Awareness-backed `PresenceBar`; stable per-user cursor colour, one peer per tab. Departure is announced before the handler detaches, so a leaver does not linger | `c8b5362` |
| Comments | Threads anchored to passages, not raw positions — positions do not survive concurrent edits | `ba366f7` |
| Sharing | A shared note is the same note in the same editor, not a second document; `rotate_share_token` for link rotation; grant revocation separated from credential reset | `727ba13`, `45dd316`, `fc3c6ec` |

`redeem_share_token` was ambiguous and had **never once succeeded** — found and fixed
in `fc3c6ec`. Worth recording: sharing was covered by passing tests the whole time it
was broken, because the tests exercised the client and the defect was in SQL.

### Phase 3 — Editor parity `IN PROGRESS`

Tables ship already (`TableKit`, resizable, and the pagination engine breaks them
between rows). Remaining: equations, super/subscript, images + Supabase Storage,
page setup, ruler/tabs, lists, headers/footers, version-history UI, import/export,
document management, global search.

**Wave 1 `DONE` — α (product UI integrity) and β (editor schema).**

**536 unit tests** (from 503), 51 files. `tsc` clean, 9 lint warnings unchanged,
build green, and zero live `window.prompt`/`alert`/`confirm` calls left in `src/`.

The three sub-agents dispatched for this wave all died on the same account rate
limit before doing any work, so the wave was executed directly. β had got as far
as installing its dependencies, and those installs were kept — they were correct
and version-matched. γ (version history) did not start and is deferred to Wave 2.

| ID | Fix |
| --- | --- |
| α1 | `LinkDialog` and `FindReplacePanel` were complete, documented, tested — and rendered by **nothing**. Both are now wired into the menubar and the toolbar |
| α2 | `ImageDialog` written, with an alt-text field. Every image the app had ever inserted was unlabelled, because a `window.prompt` has nowhere to ask |
| α3 | `WordCountDialog` replaces a blocking `window.alert`, and adds the selection count an alert had no room for |
| α4 | Link, image, find and word count are opened from one place (`useDocumentDialogs`) instead of being implemented separately in each surface |
| α5 | UpgradePage: four of the paid tier's five features were false. Claims rewritten as Today/Planned; `FREE_DOCUMENT_LIMIT` deleted |
| β1 | Superscript and subscript registered as shared schema |
| β2 | Equations via `@tiptap/extension-mathematics` + KaTeX; LaTeX stored in the node's `latex` attribute, never rendered HTML |
| β3 | `throwOnError: false` — a formula is invalid for most of the time it is being typed, and KaTeX's default throw happens inside a node view |

**Two defects found by the work, neither in the audit:**

1. **`Ctrl+K` was advertised in the menubar and in the shortcut reference, and bound
   to nothing.** Neither the app nor Tiptap's Link extension registers it, so pressing
   it only ever opened the browser's own search bar. Implemented rather than deleted,
   since it is the binding people expect. `Ctrl+H` added for find and replace.
2. **Equations were invisible to the AI.** Math nodes are atoms with no text content,
   so `extractPlainText` — which produces the `content_text` the assistant reads —
   walked straight past them. A note whose point was a derivation would have reached
   the model as prose wrapped around a hole. Caught by a test written for it.

**Also fixed:** `collab/encoding.test.ts` timed out under full parallel runs. Not a
regression — `toEqual` on a 400,000-element `Uint8Array` builds a diff it never
prints, taking 23s against a 15s limit while the encoding under test takes
milliseconds. The array size is the point of that test, so the assertion changed
instead of the input.

**Wave 2:** γ version history (list, preview, collaboration-safe restore), images +
Supabase Storage upload, page setup, ruler/tabs, import/export, document management,
global search, and the toolbar UI for β's commands.

Toolbar buttons for superscript, subscript and equations are **not yet wired** — β
deliberately landed schema and commands only, so that α could own the toolbar without
a conflict. The commands to wire are `toggleSuperscript`, `toggleSubscript`,
`insertInlineMath({ latex })` and `insertBlockMath({ latex })`.

### Phase 4 — Mobile `TODO`
Reflow mode below a deliberate breakpoint. No half-scale Letter page on a phone.

### Phase 5 — Real AI assistant `TODO`
Persistent conversations, structured document context, streaming + cancel, validated
tool calling, RAG with citations, eval suite, prompt versioning, quotas.

### Final — Verification `TODO`
Independent agents for data integrity, AI safety, accessibility, performance, product
honesty.

---

## Decisions log

| # | Decision | Rationale |
| --- | --- | --- |
| 1 | Commit the pre-existing staged work as a checkpoint before starting | A clean, green, diffable baseline is a prerequisite for multi-agent work. Fully reversible |
| 2 | Work on `rebuild/phase-0-data-integrity`, not `main` | Programme is large; `main` stays shippable |
| 3 | Keep `gemini-3.6-flash`, keep it env-overridable | Verified current. Model choice must stay configuration, not code |
| 4 | Wave 1 agents get strictly disjoint file ownership; the orchestrator refactor runs alone | Avoids merge-conflict chaos in `EditorPage.tsx` (§55 of the brief) |
| 5 | Pricing claims: fix the claims, don't build billing | The page already states no payment is taken. Honest copy is the correct fix; server-enforced limits would be building a paywall the product doesn't have |
| 6 | Collaboration transport: pending investigation, but Hocuspocus is likely ruled out | Deployment is Vercel (serverless) + Supabase. No persistent WebSocket server exists. Yjs + Supabase Realtime is the probable answer — to be confirmed by the collaboration agent, not assumed here |
| 6a | **Resolved:** Yjs over Supabase Realtime, private channel per document, authorised by RLS on `realtime.messages` | Confirmed by the collaboration agent against the real deployment constraints. Hocuspocus ruled out as predicted — nowhere to run it |
| 7 | Schema keeps reaching the database through the pasted SQL bundle; CLI access is not pursued | Owner's call, 2026-09-01. The access problem is outside the codebase, and the bundle workflow already works. Recorded as accepted drift risk above, not as a solved problem |
| 8 | Phase 3 before Phases 4 and 5 | Owner's call, 2026-09-01. Editor parity is the highest student value left, and it is what makes the UpgradePage claims honest rather than merely reworded |
| 9 | The audit that opened this programme is treated as a stale diagnostic, not a spec | Measured against the tree on 2026-09-01: it reports 159 tests against an actual 503, and its lead defect (AI apply replacing the whole document) was fixed in `10ad704`. Every claim is re-verified in code before an agent acts on it |

---

## Definition of done

Not "it compiles". Per-area criteria are in the brief; the programme tracks them as
explicit acceptance tests, and any item that cannot be safely implemented is reported
as such with an honest, disabled UI rather than faked.
