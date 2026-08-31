# Margin

A note-taking app for students. Page-based editing on desktop, an AI assistant
that works from your own notes, and classes to keep a term's work together.

Signing in is optional. Signed out, the whole app works against browser
storage; signing up moves that work into an account.

---

## Requirements

| | |
| --- | --- |
| Node | 24 (CI pins this; `package-lock.json` is committed) |
| Package manager | npm |
| Database | Supabase — optional for local work, required for accounts and AI |
| Docker | Only for `supabase start` (the local database stack) |

## Getting started

```bash
npm install
cp .env.example .env      # optional; see below
npm run dev
```

Without a `.env` the app still runs. `src/lib/supabase.ts` degrades to
local-only mode: notes live in the browser, sign-in is disabled, and the AI
panel says it needs an account. This is deliberate — a missing environment
variable used to throw at module load and produce a blank page, including for
guest mode, which needs no backend at all.

### Environment

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key>
```

Both are public by design and are safe in the client bundle; RLS is what
protects data, not key secrecy.

The Gemini key is **not** here and must never carry a `VITE_` prefix — that
prefix means "inline this into the browser bundle". It is a Supabase Edge
Function secret:

```bash
npx supabase secrets set GEMINI_API_KEY=...
npx supabase secrets set GEMINI_MODEL=gemini-3.6-flash          # optional
npx supabase secrets set ALLOWED_ORIGINS=https://your-domain    # see below
```

`ALLOWED_ORIGINS` is the AI endpoint's CORS allowlist. Unset, it falls back to
localhost only — a deployment that never configured it fails closed rather than
quietly accepting requests from anywhere.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck then production build |
| `npm test` | Vitest, once |
| `npm run test:watch` | Vitest, watching |
| `npm run lint` | oxlint |
| `npm run db:reset` | Apply every migration to the local database from scratch |
| `npm run db:push` | Apply pending migrations to the linked hosted project |
| `npm run functions:deploy` | Deploy the `ai-assist` edge function |

## Architecture

```
src/
  pages/       route components; EditorPage is the document orchestrator
  editor/      Tiptap editor, toolbar, ruler, page furniture, printing
    pagination/  the layout engine: measurement, break computation, geometry
  ai/          assistant panel and suggestion cards
  services/    all data access. Every function takes userId; null means guest
  components/  shared UI
  lib/         pure helpers — slugs, note addresses, markdown, autosave
supabase/
  migrations/  the schema, in order. The only description of it
  functions/   edge functions (Deno)
```

### Data access

Every service function takes `userId` as its first argument: a string when
signed in, `null` for a guest. `null` routes to `guestStore`, which mirrors the
Supabase contracts exactly — same row shapes, same `SaveResult`, same cascade
behaviour. Passing it explicitly rather than reading a module-level "am I
signed in" flag keeps the backend choice visible at the call site.

### Document identity

A note is addressed as `/classes/:classSlug/:slug--:documentId`. **Only the id
is looked up.** The slug is decoration: it may be stale, and the note still
resolves. This is what lets a rename leave links working, and it is why
renaming no longer reloads the document out from under whoever is typing.

Addresses written before this shipped carry a slug only. They still resolve, by
slug, and are rewritten to the canonical form once on load.

### Saving

Autosave debounces, then writes conditionally on the `version` the client last
read. Three outcomes:

- **saved** — version advances.
- **stale** — someone else saved first. Both versions are kept and the writer
  chooses. Nothing is silently discarded.
- **failed** — browser storage refused the write (guest mode; quota or
  disabled). The version deliberately does not advance, the status says "Not
  saved", and a notice offers a JSON export.

### AI

The browser calls the `ai-assist` edge function with its Supabase session. The
Gemini key never leaves the server, and note content is loaded server-side from
the database rather than accepted from the request — a tampered client cannot
pull someone else's notes into a prompt.

Quota is enforced in Postgres (`claim_ai_request`), not in the function's
memory or the client: edge functions are scaled and cold-started, so an
in-process counter limits nothing.

Model output is validated with Zod before it reaches the UI
(`supabase/functions/ai-assist/validate.ts`). Applying a suggestion goes
through `src/editor/applySuggestion.ts`, which will only ever replace the words
a suggestion was made about, and refuses when it cannot locate them
unambiguously.

## Database

See [`supabase/README.md`](supabase/README.md) for migrations, local setup, and
deployment.

## Testing

```bash
npm test
```

Vitest with jsdom, covering pure helpers, services, editor behaviour, and the
edge function's validation and CORS logic.

Not yet covered: anything needing a real browser — caret position after
navigation, print output, and the CSP rollout below. Those need Playwright,
which is not installed yet.

## Security

Headers are configured in `vercel.json`; see
[`docs/security-headers.md`](docs/security-headers.md). The Content-Security-
Policy currently ships **report-only**, on purpose, and that document explains
what has to happen before it is enforced.

## Status

This is an app under active reconstruction. The programme, what is done, and
what is not, is tracked in
[`docs/superpowers/plans/2026-08-30-production-rebuild.md`](docs/superpowers/plans/2026-08-30-production-rebuild.md).

Known gaps, stated plainly because the UI should not imply otherwise:

- **No collaborative editing.** A shared link marked "can edit" is safe for one
  person at a time. Two at once produces a conflict prompt, not a merge.
- **No version-history UI.** Snapshots are written before AI edits, but nothing
  lets you browse or restore them yet.
- **No comments.**
- **Mobile is the desktop page simulation, scaled.** It is not a reflow mode.
- **The pricing page is illustrative.** No payment is taken, no card collected,
  and the note limit it mentions is not enforced anywhere.
