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

### Phase 1 — Foundation `TODO`
Supabase migrations + `config.toml`, CLI-based edge-function deployment, GitHub Actions
CI (install → typecheck → lint → unit → build), real README, Playwright E2E harness,
AI endpoint auth/rate-limit/quota, CORS allowlist, security headers.

### Phase 2 — Collaboration + comments `TODO`
Collaboration first, comments second: comment anchors must survive concurrent edits.
Architecture decision pending investigation — see Decisions below.

### Phase 3 — Editor parity `TODO`
Tables, equations, super/subscript, images + Supabase Storage, find & replace panel,
page setup, ruler/tabs, lists, headers/footers, version-history UI, import/export,
real dialog system, document management, global search.

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

---

## Definition of done

Not "it compiles". Per-area criteria are in the brief; the programme tracks them as
explicit acceptance tests, and any item that cannot be safely implemented is reported
as such with an honest, disabled UI rather than faked.
