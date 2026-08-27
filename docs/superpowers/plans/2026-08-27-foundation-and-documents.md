# Student Notes App — Foundation & Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Stages 1–2 of the Student Notes App — a working, testable app where a student can sign up, create classes, create notes, and write in a Google Docs–style rich-text editor with autosave.

**Architecture:** A standalone Vite SPA in `student-notes-app/`. React 19 + TypeScript + Tailwind for UI, Tiptap for the editor, Supabase for auth and Postgres. Data access lives in flat `async function` services under `src/services/`; pure logic (plain-text extraction, autosave scheduling) lives in `src/lib/` and is unit-tested with Vitest. No AI code in this plan — Stages 3–6 get their own plan once Supabase and Gemini credentials exist.

**Tech Stack:** Vite 5, React 19, TypeScript 5.6, Tailwind CSS 3.4, Tiptap 2, Supabase JS 2, react-router-dom 7, Zustand 5, Vitest 3 + Testing Library.

**Conventions inherited from `client-tracker-app`** (the sibling project in this workspace — follow these, do not invent new ones):
- `supabase/schema.sql` is a single idempotent file, pasted into the Supabase SQL Editor by hand. `create table if not exists`, `alter table ... add column if not exists`, `drop policy if exists` then `create policy`.
- RLS policies are named `<table>_<action>_own`.
- Row types are hand-written `*Row` interfaces in `src/types/database.ts`.
- The Supabase client is created **without** the `Database` generic — v2's write-path type inference resolves Insert payloads to `never` and breaks builds. Type safety lives in the service layer instead. This is a known, documented gotcha; do not "fix" it by adding the generic.

**Prerequisite:** The user must create a Supabase project and provide `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Tasks 1–5 and 11–13 can be built and tested without it; Tasks 6–10 and 14 need a live project to verify against.

---

### Task 1: Scaffold the Vite project

**Files:**
- Create: `student-notes-app/package.json`
- Create: `student-notes-app/vite.config.ts`
- Create: `student-notes-app/tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`
- Create: `student-notes-app/index.html`
- Create: `student-notes-app/.gitignore`
- Create: `student-notes-app/src/main.tsx`, `src/App.tsx`, `src/vite-env.d.ts`

- [ ] **Step 1: Create the project with Vite's React-TS template**

Run from `student-notes-app/`:

```bash
npm create vite@latest . -- --template react-ts
```

If prompted about the non-empty directory (it contains `docs/`), choose "Ignore files and continue".

- [ ] **Step 2: Install runtime and dev dependencies**

```bash
npm install @supabase/supabase-js react-router-dom zustand clsx tailwind-merge lucide-react
npm install -D tailwindcss@^3.4.17 postcss autoprefixer @types/node
```

- [ ] **Step 3: Verify the dev server starts**

```bash
npm run dev
```

Expected: Vite prints `Local: http://localhost:5173/` within ~2 seconds. Open it and confirm the default Vite + React page renders. Stop the server with Ctrl+C.

If startup takes 30+ seconds, that is the known OneDrive sync problem — stop and report it rather than continuing.

- [ ] **Step 4: Replace `.gitignore`**

```
node_modules
dist
dist-ssr
*.local
.env
.env.*
!.env.example
.DS_Store
*.log
```

- [ ] **Step 5: Commit**

```bash
git add student-notes-app/
git commit -m "chore(notes): scaffold vite react-ts project"
```

---

### Task 2: Tailwind and the design tokens

**Files:**
- Create: `student-notes-app/tailwind.config.js`
- Create: `student-notes-app/postcss.config.js`
- Create: `student-notes-app/src/index.css`
- Modify: `student-notes-app/src/main.tsx`

- [ ] **Step 1: Create `postcss.config.js`**

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

- [ ] **Step 2: Create `tailwind.config.js` with the design tokens from the spec**

The palette is deliberately narrow. `accent` is used only for focus rings, active toolbar state, and primary buttons — never for decoration.

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#202124',
          muted: '#5f6368',
          faint: '#80868b',
        },
        surface: {
          DEFAULT: '#ffffff',
          backdrop: '#f8f9fa',
          hover: '#f1f3f4',
        },
        line: {
          DEFAULT: '#e0e0e0',
          strong: '#dadce0',
        },
        accent: {
          DEFAULT: '#1a73e8',
          hover: '#1765cc',
          subtle: '#e8f0fe',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto',
          '"Helvetica Neue"', 'Arial', 'sans-serif',
        ],
        doc: ['Georgia', 'Cambria', '"Times New Roman"', 'serif'],
      },
      boxShadow: {
        sheet: '0 1px 3px rgba(60,64,67,0.15), 0 4px 8px rgba(60,64,67,0.08)',
        pill: '0 2px 6px rgba(60,64,67,0.28)',
      },
      transitionDuration: {
        DEFAULT: '150ms',
      },
      maxWidth: {
        sheet: '816px',
      },
    },
  },
  plugins: [],
}
```

- [ ] **Step 3: Replace `src/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  html,
  body,
  #root {
    height: 100%;
  }

  body {
    @apply bg-surface-backdrop text-ink font-sans antialiased;
  }

  /* Visible focus for keyboard users only. Every interactive element
     inherits this; do not remove outlines anywhere without a replacement. */
  :focus-visible {
    @apply outline-none ring-2 ring-accent ring-offset-2 ring-offset-surface;
  }
}
```

- [ ] **Step 4: Ensure `main.tsx` imports the stylesheet**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

Delete `src/App.css` if the template created one.

- [ ] **Step 5: Verify Tailwind compiles**

Replace `src/App.tsx` with a token smoke test:

```tsx
export default function App() {
  return (
    <div className="grid min-h-full place-items-center">
      <div className="max-w-sheet rounded border border-line bg-surface p-8 shadow-sheet">
        <h1 className="text-2xl font-medium text-ink">Student Notes</h1>
        <p className="mt-2 text-sm text-ink-muted">Design tokens are wired up.</p>
      </div>
    </div>
  )
}
```

Run `npm run dev`. Expected: a white card with a soft shadow on a light gray page, dark near-black heading, gray subtext. If the page is unstyled, Tailwind's `content` glob is wrong.

- [ ] **Step 6: Commit**

```bash
git add student-notes-app/
git commit -m "feat(notes): tailwind design tokens"
```

---

### Task 3: Vitest setup, proven with a real test

There is no test framework in the sibling project, so this sets one up from scratch. The first test target is `extractPlainText`, which is genuinely worth testing and has no dependencies.

**Files:**
- Modify: `student-notes-app/package.json`
- Modify: `student-notes-app/vite.config.ts`
- Create: `student-notes-app/src/test/setup.ts`
- Create: `student-notes-app/src/lib/tiptap.ts`
- Create: `student-notes-app/src/lib/tiptap.test.ts`

- [ ] **Step 1: Install test and editor dependencies**

The Tiptap packages are installed here because `extractPlainText` imports the
`JSONContent` type from `@tiptap/react`.

```bash
npm install -D vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
npm install @tiptap/react @tiptap/pm @tiptap/starter-kit
```

- [ ] **Step 2: Configure Vitest in `vite.config.ts`**

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
})
```

- [ ] **Step 3: Create `src/test/setup.ts`**

```ts
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 4: Add test scripts to `package.json`**

Add to the `scripts` object:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Write the failing test**

Create `src/lib/tiptap.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { extractPlainText } from './tiptap'

describe('extractPlainText', () => {
  it('returns an empty string for an empty document', () => {
    expect(extractPlainText({ type: 'doc', content: [] })).toBe('')
  })

  it('separates block-level nodes with newlines', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'First line' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second line' }] },
      ],
    }
    expect(extractPlainText(doc)).toBe('First line\nSecond line')
  })

  it('concatenates inline runs without inserting separators', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Krebs cycle ' },
            { type: 'text', text: 'makes ATP', marks: [{ type: 'bold' }] },
          ],
        },
      ],
    }
    expect(extractPlainText(doc)).toBe('Krebs cycle makes ATP')
  })

  it('includes text nested inside list items', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Glycolysis' }] },
              ],
            },
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Krebs cycle' }] },
              ],
            },
          ],
        },
      ],
    }
    expect(extractPlainText(doc)).toBe('Glycolysis\nKrebs cycle')
  })

  it('ignores nodes with no text content', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
        { type: 'horizontalRule' },
        { type: 'paragraph', content: [{ type: 'text', text: 'After' }] },
      ],
    }
    expect(extractPlainText(doc)).toBe('Before\nAfter')
  })

  // Regression: list containers are not inline. When a document's children are
  // all list containers, a block-type allowlist misses them and the whole doc
  // takes the inline path, mashing the last item of one list into the first
  // item of the next ("Krebs cycleStep one").
  it('separates consecutive list blocks', () => {
    const listItem = (text: string) => ({
      type: 'listItem',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    })

    const doc = {
      type: 'doc',
      content: [
        { type: 'bulletList', content: [listItem('Glycolysis'), listItem('Krebs cycle')] },
        { type: 'orderedList', content: [listItem('Step one'), listItem('Step two')] },
      ],
    }

    expect(extractPlainText(doc)).toBe('Glycolysis\nKrebs cycle\nStep one\nStep two')
  })

  // hardBreak (Shift+Enter) is inline for layout purposes -- it doesn't
  // start a new block -- but it still represents a line break the user
  // explicitly typed. Treating it as a no-op mashes the surrounding words
  // together ("Line oneLine two"), the exact class of bug the list-block
  // regression above was fixed for. So it contributes its own newline
  // instead of nothing.
  it('treats hardBreak as an inline line break, not a no-op', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Line one' },
            { type: 'hardBreak' },
            { type: 'text', text: 'Line two' },
          ],
        },
      ],
    }
    expect(extractPlainText(doc)).toBe('Line one\nLine two')
  })
})
```

- [ ] **Step 6: Run the test to verify it fails**

```bash
npm test
```

Expected: FAIL — `Failed to resolve import "./tiptap"`.

- [ ] **Step 7: Write the implementation**

Create `src/lib/tiptap.ts`:

```ts
import type { JSONContent } from '@tiptap/react'

/**
 * The only node types that flow inline within a block. Everything else is
 * block-level and occupies its own line.
 *
 * Inverted deliberately: enumerating inline types is stable (there are two),
 * while enumerating block types is not — every new Tiptap extension would
 * need adding here, and forgetting one silently concatenates adjacent blocks
 * with no separator. A document of two consecutive lists is the case that
 * exposes it.
 */
const INLINE_TYPES = new Set(['text', 'hardBreak'])

/**
 * Flattens a Tiptap JSON document to plain text.
 *
 * This is denormalized into `documents.content_text` on every save so the AI
 * context layer never has to walk Tiptap JSON.
 */
export function extractPlainText(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? ''

  // hardBreak (Shift+Enter) is inline for layout purposes -- it doesn't
  // start a new block -- but it still represents a line break the user
  // explicitly typed. Treating it as a no-op would mash the surrounding
  // words together (e.g. "Line oneLine two"), so it contributes its own
  // newline instead.
  if (node.type === 'hardBreak') return '\n'

  const children = node.content ?? []
  const parts = children.map(extractPlainText)

  const hasBlockChildren = children.some((child) => !INLINE_TYPES.has(child.type ?? ''))

  return hasBlockChildren ? parts.filter((part) => part !== '').join('\n') : parts.join('')
}
```

- [ ] **Step 8: Run the test to verify it passes**

```bash
npm test
```

Expected: PASS — 7 tests in `src/lib/tiptap.test.ts`.

- [ ] **Step 9: Commit**

```bash
git add student-notes-app/
git commit -m "test(notes): vitest setup and extractPlainText"
```

---

### Task 4: Database schema

**Files:**
- Create: `student-notes-app/supabase/schema.sql`

This file is pasted into the Supabase SQL Editor by hand and must be safely re-runnable.

- [ ] **Step 1: Write `supabase/schema.sql`**

```sql
-- ============================================================================
-- Student Notes App — Supabase Schema
-- ============================================================================
-- Paste into the Supabase SQL Editor for your project and run it once.
-- Safe to re-run (create-if-not-exists, add-column-if-not-exists,
-- create-or-replace functions, drop-then-create policies/triggers).
--
-- Tables: profiles, classes, documents, document_versions,
--         conversations, messages
-- All tables RLS-enabled, scoped to auth.uid().
-- profiles row is auto-created via trigger on auth.users insert.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- profiles
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- profiles INSERT happens via SECURITY DEFINER trigger, so no INSERT policy.

-- ----------------------------------------------------------------------------
-- classes
-- ----------------------------------------------------------------------------
create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  course_code text not null default '',
  professor text not null default '',
  semester text not null default '',
  course_level text not null default 'College'
    check (course_level in ('High School', 'College', 'Graduate')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists classes_user_updated_idx
  on public.classes(user_id, updated_at desc);

alter table public.classes enable row level security;

drop policy if exists "classes_select_own" on public.classes;
create policy "classes_select_own"
  on public.classes for select using (user_id = auth.uid());

drop policy if exists "classes_insert_own" on public.classes;
create policy "classes_insert_own"
  on public.classes for insert with check (user_id = auth.uid());

drop policy if exists "classes_update_own" on public.classes;
create policy "classes_update_own"
  on public.classes for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "classes_delete_own" on public.classes;
create policy "classes_delete_own"
  on public.classes for delete using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- documents
--
-- `content`      Tiptap JSON document (source of truth for the editor)
-- `content_text` plain-text extract, denormalized on every save so the AI
--                context layer never has to walk Tiptap JSON
-- `version`      optimistic-concurrency counter. Saves are conditional on the
--                version the client last read; a stale save affects 0 rows and
--                is discarded rather than clobbering newer content.
-- ----------------------------------------------------------------------------
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  content jsonb not null default '{"type":"doc","content":[]}'::jsonb,
  content_text text not null default '',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists documents_class_updated_idx
  on public.documents(class_id, updated_at desc);

alter table public.documents enable row level security;

drop policy if exists "documents_select_own" on public.documents;
create policy "documents_select_own"
  on public.documents for select using (user_id = auth.uid());

drop policy if exists "documents_insert_own" on public.documents;
create policy "documents_insert_own"
  on public.documents for insert with check (user_id = auth.uid());

drop policy if exists "documents_update_own" on public.documents;
create policy "documents_update_own"
  on public.documents for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "documents_delete_own" on public.documents;
create policy "documents_delete_own"
  on public.documents for delete using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- document_versions
--
-- Lightweight snapshots, not a full version-history feature. A row is written
-- immediately before any AI-applied edit so the change stays reversible.
-- No browsing UI in the MVP.
-- ----------------------------------------------------------------------------
create table if not exists public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content jsonb not null,
  created_by text not null default 'user' check (created_by in ('user', 'ai')),
  created_at timestamptz not null default now()
);

create index if not exists document_versions_document_created_idx
  on public.document_versions(document_id, created_at desc);

alter table public.document_versions enable row level security;

drop policy if exists "document_versions_select_own" on public.document_versions;
create policy "document_versions_select_own"
  on public.document_versions for select using (user_id = auth.uid());

drop policy if exists "document_versions_insert_own" on public.document_versions;
create policy "document_versions_insert_own"
  on public.document_versions for insert with check (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- conversations / messages  (created now; used by the AI plan)
-- ----------------------------------------------------------------------------
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  document_id uuid references public.documents(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.conversations enable row level security;

drop policy if exists "conversations_select_own" on public.conversations;
create policy "conversations_select_own"
  on public.conversations for select using (user_id = auth.uid());

drop policy if exists "conversations_insert_own" on public.conversations;
create policy "conversations_insert_own"
  on public.conversations for insert with check (user_id = auth.uid());

drop policy if exists "conversations_delete_own" on public.conversations;
create policy "conversations_delete_own"
  on public.conversations for delete using (user_id = auth.uid());

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  mode text not null default 'CHAT',
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists messages_conversation_created_idx
  on public.messages(conversation_id, created_at);

alter table public.messages enable row level security;

drop policy if exists "messages_select_own" on public.messages;
create policy "messages_select_own"
  on public.messages for select using (user_id = auth.uid());

drop policy if exists "messages_insert_own" on public.messages;
create policy "messages_insert_own"
  on public.messages for insert with check (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- updated_at triggers
-- ----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists classes_touch_updated_at on public.classes;
create trigger classes_touch_updated_at
  before update on public.classes
  for each row execute function public.touch_updated_at();

drop trigger if exists documents_touch_updated_at on public.documents;
create trigger documents_touch_updated_at
  before update on public.documents
  for each row execute function public.touch_updated_at();

drop trigger if exists conversations_touch_updated_at on public.conversations;
create trigger conversations_touch_updated_at
  before update on public.conversations
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- handle_new_user: auto-create the profile row on signup.
--
-- display_name comes from raw_user_meta_data.display_name, set client-side via
-- supabase.auth.signUp({ options: { data: { display_name } } }).
--
-- SECURITY DEFINER because the new user's session does not exist yet.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', ''));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

- [ ] **Step 2: Apply the schema**

Paste the file into the Supabase SQL Editor and run it. Expected: `Success. No rows returned`.

- [ ] **Step 3: Verify tables and RLS**

Run in the SQL Editor:

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;
```

Expected: six rows — `classes`, `conversations`, `document_versions`, `documents`, `messages`, `profiles` — each with `rowsecurity = true`.

- [ ] **Step 4: Commit**

```bash
git add student-notes-app/supabase/schema.sql
git commit -m "feat(notes): database schema with RLS"
```

---

### Task 5: Supabase client, env, and row types

**Files:**
- Create: `student-notes-app/.env.example`
- Create: `student-notes-app/.env` (local only — gitignored)
- Create: `student-notes-app/src/lib/supabase.ts`
- Create: `student-notes-app/src/types/database.ts`
- Create: `student-notes-app/src/lib/cn.ts`

- [ ] **Step 1: Create `.env.example` with placeholders only**

Never put real values here.

```
# Supabase — from Project Settings > API
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key

# Gemini — NOT used by the client. Set as a Supabase Edge Function secret:
#   npx supabase secrets set GEMINI_API_KEY=...
# Listed here only as documentation. Never expose it with a VITE_ prefix.
```

- [ ] **Step 2: Create `.env` with the real values supplied by the user**

Confirm it is gitignored: `git check-ignore student-notes-app/.env` must print the path.

- [ ] **Step 3: Create `src/lib/supabase.ts`**

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    'Missing Supabase env vars. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env',
  )
}

// The Database generic is deliberately omitted. supabase-js v2's write-path
// type inference resolves Insert payloads to `never` against a hand-written
// schema type, which breaks the build. Type safety lives in src/services/*,
// which owns the row-shape contracts. Do not add the generic back.
export const supabase: SupabaseClient = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
})
```

- [ ] **Step 4: Create `src/types/database.ts`**

```ts
export type CourseLevel = 'High School' | 'College' | 'Graduate'

export interface ProfileRow {
  id: string
  display_name: string
  created_at: string
}

export interface ClassRow {
  id: string
  user_id: string
  name: string
  course_code: string
  professor: string
  semester: string
  course_level: CourseLevel
  created_at: string
  updated_at: string
}

/** A class row plus the derived note count shown on the dashboard. */
export interface ClassWithCount extends ClassRow {
  note_count: number
}

export interface DocumentRow {
  id: string
  class_id: string
  user_id: string
  title: string
  /** Tiptap JSON. Typed loosely here; the editor owns the shape. */
  content: unknown
  content_text: string
  /** Optimistic-concurrency counter. See saveDocument(). */
  version: number
  created_at: string
  updated_at: string
}

/** Listing shape for the class page — excludes heavy content columns. */
export type DocumentListItem = Pick<
  DocumentRow,
  'id' | 'class_id' | 'title' | 'created_at' | 'updated_at'
>
```

- [ ] **Step 5: Create `src/lib/cn.ts`**

```ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
```

- [ ] **Step 6: Verify it type-checks**

```bash
npx tsc -b --noEmit
```

Expected: no output (success).

- [ ] **Step 7: Commit**

```bash
git add student-notes-app/
git commit -m "feat(notes): supabase client, env, row types"
```

---

### Task 6: UI primitives

Small, focused components used by every page. Building them first prevents ad-hoc button styling from spreading through the pages.

**Files:**
- Create: `student-notes-app/src/components/ui/Button.tsx`
- Create: `student-notes-app/src/components/ui/Input.tsx`
- Create: `student-notes-app/src/components/ui/Dialog.tsx`
- Create: `student-notes-app/src/components/ui/Button.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/ui/Button.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from './Button'

describe('Button', () => {
  it('renders as a real button element', () => {
    render(<Button>Create class</Button>)
    expect(screen.getByRole('button', { name: 'Create class' })).toBeInTheDocument()
  })

  it('calls onClick when clicked', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Save</Button>)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('does not call onClick while loading', async () => {
    const onClick = vi.fn()
    render(<Button loading onClick={onClick}>Save</Button>)
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('exposes busy state to assistive technology while loading', () => {
    render(<Button loading>Save</Button>)
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- Button
```

Expected: FAIL — `Failed to resolve import "./Button"`.

- [ ] **Step 3: Implement `Button.tsx`**

```tsx
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost'
type Size = 'sm' | 'md'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  children: ReactNode
}

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover disabled:bg-accent/50',
  secondary: 'border border-line-strong bg-surface text-ink hover:bg-surface-hover',
  ghost: 'text-ink-muted hover:bg-surface-hover hover:text-ink',
}

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-9 px-4 text-sm',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded font-medium',
        'transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- Button
```

Expected: PASS — 4 tests.

- [ ] **Step 5: Implement `Input.tsx`**

Every input is label-associated. There are no placeholder-only fields anywhere in this app.

```tsx
import { useId, type InputHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  /** Error text rendered below the field and linked via aria-describedby. */
  error?: string
}

export function Input({ label, error, className, ...props }: InputProps) {
  const id = useId()
  const errorId = `${id}-error`

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cn(
          'h-9 rounded border bg-surface px-3 text-sm text-ink',
          'placeholder:text-ink-faint transition-colors',
          error ? 'border-red-500' : 'border-line-strong hover:border-ink-faint',
          className,
        )}
        {...props}
      />
      {error && (
        <p id={errorId} className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 6: Implement `Dialog.tsx`**

A minimal modal built on the native `<dialog>` element, which gives focus trapping and Escape-to-close for free.

```tsx
import { useEffect, useRef, type ReactNode } from 'react'

interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

export function Dialog({ open, onClose, title, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (open && !node.open) node.showModal()
    if (!open && node.open) node.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      // Clicking the backdrop (the dialog element itself, outside its child)
      // closes the dialog; clicks inside the panel stop propagation.
      onClick={(event) => {
        if (event.target === ref.current) onClose()
      }}
      aria-label={title}
      className="w-full max-w-md rounded-lg border border-line bg-surface p-0 shadow-sheet backdrop:bg-ink/30"
    >
      <div className="p-6">
        <h2 className="text-lg font-medium text-ink">{title}</h2>
        <div className="mt-4">{children}</div>
      </div>
    </dialog>
  )
}
```

- [ ] **Step 7: Run the full suite**

```bash
npm test
```

Expected: PASS — 11 tests total (7 tiptap + 4 Button).

- [ ] **Step 8: Commit**

```bash
git add student-notes-app/
git commit -m "feat(notes): Button, Input, Dialog primitives"
```

---

### Task 7: AuthContext

**Files:**
- Create: `student-notes-app/src/contexts/AuthContext.tsx`

- [ ] **Step 1: Implement `AuthContext.tsx`**

```tsx
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { ProfileRow } from '../types/database'

type AuthState = {
  session: Session | null
  user: User | null
  profile: ProfileRow | null
  loading: boolean
  signUp: (email: string, password: string, displayName: string) => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  requestPasswordReset: (email: string) => Promise<void>
  updatePassword: (password: string) => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

async function fetchProfile(userId: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    console.error('[AuthContext] failed to fetch profile:', error)
    return null
  }
  return data as ProfileRow | null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setSession(data.session)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setLoading(false)
    })

    return () => {
      cancelled = true
      listener.subscription.unsubscribe()
    }
  }, [])

  const userId = session?.user.id ?? null

  useEffect(() => {
    if (!userId) {
      setProfile(null)
      return
    }
    let cancelled = false
    void fetchProfile(userId).then((row) => {
      if (!cancelled) setProfile(row)
    })
    return () => {
      cancelled = true
    }
  }, [userId])

  const value = useMemo<AuthState>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,

      signUp: async (email, password, displayName) => {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          // Read by the handle_new_user trigger to populate profiles.display_name.
          options: { data: { display_name: displayName } },
        })
        if (error) throw error
      },

      signIn: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      },

      signOut: async () => {
        const { error } = await supabase.auth.signOut()
        if (error) throw error
      },

      requestPasswordReset: async (email) => {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        })
        if (error) throw error
      },

      updatePassword: async (password) => {
        const { error } = await supabase.auth.updateUser({ password })
        if (error) throw error
      },
    }),
    [session, profile, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within an AuthProvider')
  return context
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc -b --noEmit
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add student-notes-app/
git commit -m "feat(notes): auth context"
```

---

### Task 8: Auth pages and routing

**Files:**
- Create: `student-notes-app/src/components/AuthLayout.tsx`
- Create: `student-notes-app/src/components/ProtectedRoute.tsx`
- Create: `student-notes-app/src/pages/LoginPage.tsx`
- Create: `student-notes-app/src/pages/SignUpPage.tsx`
- Create: `student-notes-app/src/pages/ForgotPasswordPage.tsx`
- Create: `student-notes-app/src/pages/ResetPasswordPage.tsx`
- Modify: `student-notes-app/src/App.tsx`

- [ ] **Step 1: Create `AuthLayout.tsx`**

```tsx
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

interface AuthLayoutProps {
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
}

export function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  return (
    <main className="grid min-h-full place-items-center px-4 py-12">
      <div className="w-full max-w-sm">
        <Link to="/" className="text-sm font-medium tracking-tight text-ink">
          Student Notes
        </Link>
        <h1 className="mt-8 text-2xl font-medium text-ink">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-ink-muted">{subtitle}</p>}
        <div className="mt-6">{children}</div>
        {footer && <div className="mt-6 text-sm text-ink-muted">{footer}</div>}
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Create `ProtectedRoute.tsx`**

```tsx
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export function ProtectedRoute() {
  const { session, loading } = useAuth()
  const location = useLocation()

  // Render nothing while the session is being restored, otherwise a refresh on
  // a protected page would flash the login screen before redirecting back.
  if (loading) return null

  if (!session) return <Navigate to="/login" replace state={{ from: location }} />

  return <Outlet />
}
```

- [ ] **Step 3: Create `LoginPage.tsx`**

```tsx
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthLayout } from '../components/AuthLayout'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { useAuth } from '../contexts/AuthContext'

export default function LoginPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await signIn(email, password)
      navigate('/classes', { replace: true })
    } catch (caught) {
      console.error('[LoginPage] sign-in failed:', caught)
      setError('That email and password combination did not work.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title="Sign in"
      footer={
        <>
          Need an account?{' '}
          <Link to="/signup" className="text-accent hover:underline">
            Sign up
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" loading={submitting}>
          Sign in
        </Button>
        <Link to="/forgot-password" className="text-sm text-ink-muted hover:text-ink">
          Forgot your password?
        </Link>
      </form>
    </AuthLayout>
  )
}
```

- [ ] **Step 4: Create `SignUpPage.tsx`**

```tsx
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthLayout } from '../components/AuthLayout'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { useAuth } from '../contexts/AuthContext'

export default function SignUpPage() {
  const { signUp } = useAuth()
  const navigate = useNavigate()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('Use at least 8 characters for your password.')
      return
    }

    setSubmitting(true)
    try {
      await signUp(email, password, displayName.trim())
      navigate('/classes', { replace: true })
    } catch (caught) {
      console.error('[SignUpPage] sign-up failed:', caught)
      setError('We could not create that account. Try a different email.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Keep your class notes in one place."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="text-accent hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="Name"
          autoComplete="name"
          required
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" loading={submitting}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  )
}
```

- [ ] **Step 5: Create `ForgotPasswordPage.tsx`**

```tsx
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AuthLayout } from '../components/AuthLayout'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { useAuth } from '../contexts/AuthContext'

export default function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    try {
      await requestPasswordReset(email)
    } catch (caught) {
      // Deliberately not surfaced: reporting whether an email exists would
      // leak account existence. The confirmation below is always shown.
      console.error('[ForgotPasswordPage] reset request failed:', caught)
    } finally {
      setSubmitting(false)
      setSent(true)
    }
  }

  if (sent) {
    return (
      <AuthLayout
        title="Check your email"
        subtitle={`If an account exists for ${email}, a reset link is on its way.`}
        footer={
          <Link to="/login" className="text-accent hover:underline">
            Back to sign in
          </Link>
        }
      >
        <span />
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="We'll email you a link to choose a new one."
      footer={
        <Link to="/login" className="text-accent hover:underline">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Button type="submit" variant="primary" loading={submitting}>
          Send reset link
        </Button>
      </form>
    </AuthLayout>
  )
}
```

- [ ] **Step 6: Create `ResetPasswordPage.tsx`**

```tsx
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthLayout } from '../components/AuthLayout'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { useAuth } from '../contexts/AuthContext'

export default function ResetPasswordPage() {
  const { updatePassword } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('Use at least 8 characters for your password.')
      return
    }

    setSubmitting(true)
    try {
      await updatePassword(password)
      navigate('/classes', { replace: true })
    } catch (caught) {
      console.error('[ResetPasswordPage] password update failed:', caught)
      setError('That reset link has expired. Request a new one.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout title="Choose a new password">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" loading={submitting}>
          Update password
        </Button>
      </form>
    </AuthLayout>
  )
}
```

- [ ] **Step 7: Wire routing in `App.tsx`**

```tsx
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import LoginPage from './pages/LoginPage'
import SignUpPage from './pages/SignUpPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import ClassesPage from './pages/ClassesPage'
import ClassPage from './pages/ClassPage'
import EditorPage from './pages/EditorPage'

function RootRedirect() {
  const { session, loading } = useAuth()
  if (loading) return null
  return <Navigate to={session ? '/classes' : '/login'} replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignUpPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/classes" element={<ClassesPage />} />
            <Route path="/classes/:classId" element={<ClassPage />} />
            <Route
              path="/classes/:classId/documents/:documentId"
              element={<EditorPage />}
            />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
```

`ClassesPage`, `ClassPage`, and `EditorPage` do not exist yet — this will not compile without them. Create all three temporary stubs so the app runs:

```tsx
// src/pages/ClassesPage.tsx — replaced in Task 9
export default function ClassesPage() {
  return <div>Classes</div>
}
```

```tsx
// src/pages/ClassPage.tsx — replaced in Task 11
export default function ClassPage() {
  return <div>Class</div>
}
```

```tsx
// src/pages/EditorPage.tsx — replaced in Task 14
export default function EditorPage() {
  return <div>Editor</div>
}
```

- [ ] **Step 8: Verify signup end-to-end against the live project**

```bash
npm run dev
```

Go to `/signup`, create an account. Expected: redirect to `/classes` showing the stub. Then in the Supabase SQL Editor:

```sql
select id, display_name from public.profiles;
```

Expected: one row with the name you entered — confirming the `handle_new_user` trigger fired.

Then test sign-out persistence: refresh the page. Expected: you stay on `/classes`, no login flash.

- [ ] **Step 9: Commit**

```bash
git add student-notes-app/
git commit -m "feat(notes): auth pages and routing"
```

---

### Task 9: Classes service and dashboard

**Files:**
- Create: `student-notes-app/src/services/classes.ts`
- Create: `student-notes-app/src/components/AppHeader.tsx`
- Create: `student-notes-app/src/components/CreateClassDialog.tsx`
- Modify: `student-notes-app/src/pages/ClassesPage.tsx`

- [ ] **Step 1: Create `src/services/classes.ts`**

```ts
import { supabase } from '../lib/supabase'
import type { ClassRow, ClassWithCount, CourseLevel } from '../types/database'

export interface ClassInput {
  name: string
  course_code: string
  professor: string
  semester: string
  course_level: CourseLevel
}

/**
 * Classes for the dashboard, newest-edited first, each with its note count.
 *
 * The count comes from a PostgREST embedded aggregate rather than N follow-up
 * queries. `documents(count)` returns `[{ count: n }]` per row.
 */
export async function fetchClasses(userId: string): Promise<ClassWithCount[]> {
  const { data, error } = await supabase
    .from('classes')
    .select('*, documents(count)')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })

  if (error) throw error

  return (data ?? []).map((row) => {
    const { documents, ...rest } = row as ClassRow & {
      documents: { count: number }[]
    }
    return { ...rest, note_count: documents?.[0]?.count ?? 0 }
  })
}

export async function fetchClass(classId: string): Promise<ClassRow | null> {
  const { data, error } = await supabase
    .from('classes')
    .select('*')
    .eq('id', classId)
    .maybeSingle()

  if (error) throw error
  return data as ClassRow | null
}

export async function createClass(
  userId: string,
  input: ClassInput,
): Promise<ClassRow> {
  const { data, error } = await supabase
    .from('classes')
    .insert({ ...input, user_id: userId })
    .select()
    .single()

  if (error) throw error
  return data as ClassRow
}

export async function updateClass(
  classId: string,
  patch: Partial<ClassInput>,
): Promise<ClassRow> {
  const { data, error } = await supabase
    .from('classes')
    .update(patch)
    .eq('id', classId)
    .select()
    .single()

  if (error) throw error
  return data as ClassRow
}

export async function deleteClass(classId: string): Promise<void> {
  const { error } = await supabase.from('classes').delete().eq('id', classId)
  if (error) throw error
}
```

- [ ] **Step 2: Create `src/components/AppHeader.tsx`**

```tsx
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Button } from './ui/Button'

export function AppHeader() {
  const { profile, signOut } = useAuth()

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
        <Link to="/classes" className="text-sm font-medium tracking-tight text-ink">
          Student Notes
        </Link>
        <div className="flex items-center gap-4">
          {profile?.display_name && (
            <span className="text-sm text-ink-muted">{profile.display_name}</span>
          )}
          <Button variant="ghost" size="sm" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </div>
    </header>
  )
}
```

- [ ] **Step 3: Create `src/components/CreateClassDialog.tsx`**

Only `name` is required. The rest feed AI context later and may be left blank.

```tsx
import { useState, type FormEvent } from 'react'
import { Dialog } from './ui/Dialog'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import type { ClassInput } from '../services/classes'
import type { CourseLevel } from '../types/database'

const COURSE_LEVELS: CourseLevel[] = ['High School', 'College', 'Graduate']

interface CreateClassDialogProps {
  open: boolean
  onClose: () => void
  onCreate: (input: ClassInput) => Promise<void>
}

export function CreateClassDialog({ open, onClose, onCreate }: CreateClassDialogProps) {
  const [name, setName] = useState('')
  const [courseCode, setCourseCode] = useState('')
  const [professor, setProfessor] = useState('')
  const [semester, setSemester] = useState('')
  const [courseLevel, setCourseLevel] = useState<CourseLevel>('College')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return

    setSubmitting(true)
    try {
      await onCreate({
        name: name.trim(),
        course_code: courseCode.trim(),
        professor: professor.trim(),
        semester: semester.trim(),
        course_level: courseLevel,
      })
      setName('')
      setCourseCode('')
      setProfessor('')
      setSemester('')
      setCourseLevel('College')
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Create class">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="Class name"
          required
          autoFocus
          placeholder="Biology 101"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Course code"
            placeholder="BIO 101"
            value={courseCode}
            onChange={(event) => setCourseCode(event.target.value)}
          />
          <Input
            label="Semester"
            placeholder="Fall 2026"
            value={semester}
            onChange={(event) => setSemester(event.target.value)}
          />
        </div>
        <Input
          label="Professor"
          value={professor}
          onChange={(event) => setProfessor(event.target.value)}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="course-level" className="text-sm font-medium text-ink">
            Course level
          </label>
          <select
            id="course-level"
            value={courseLevel}
            onChange={(event) => setCourseLevel(event.target.value as CourseLevel)}
            className="h-9 rounded border border-line-strong bg-surface px-3 text-sm text-ink"
          >
            {COURSE_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-2 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={submitting}>
            Create class
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
```

- [ ] **Step 4: Create `src/lib/formatDate.ts`**

```ts
/** Relative "last edited" label, e.g. "2 hours ago". */
export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const seconds = Math.round((Date.now() - then) / 1000)

  if (seconds < 60) return 'just now'

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['minute', 60],
    ['hour', 3600],
    ['day', 86400],
    ['month', 2592000],
    ['year', 31536000],
  ]

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

  let chosen: [Intl.RelativeTimeFormatUnit, number] = units[0]
  for (const unit of units) {
    if (seconds >= unit[1]) chosen = unit
  }

  return formatter.format(-Math.floor(seconds / chosen[1]), chosen[0])
}
```

- [ ] **Step 5: Implement `ClassesPage.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppHeader } from '../components/AppHeader'
import { Button } from '../components/ui/Button'
import { CreateClassDialog } from '../components/CreateClassDialog'
import { useAuth } from '../contexts/AuthContext'
import { createClass, fetchClasses, type ClassInput } from '../services/classes'
import { formatRelativeTime } from '../lib/formatDate'
import type { ClassWithCount } from '../types/database'

export default function ClassesPage() {
  const { user } = useAuth()
  const [classes, setClasses] = useState<ClassWithCount[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)

  const load = useCallback(async () => {
    if (!user) return
    try {
      setClasses(await fetchClasses(user.id))
    } catch (caught) {
      console.error('[ClassesPage] failed to load classes:', caught)
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void load()
  }, [load])

  async function handleCreate(input: ClassInput) {
    if (!user) return
    await createClass(user.id, input)
    await load()
  }

  return (
    <div className="min-h-full">
      <AppHeader />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-medium text-ink">My classes</h1>
          {classes.length > 0 && (
            <Button variant="primary" onClick={() => setDialogOpen(true)}>
              Create class
            </Button>
          )}
        </div>

        {loading ? null : classes.length === 0 ? (
          <div className="mt-24 text-center">
            <h2 className="text-lg font-medium text-ink">Create your first class</h2>
            <p className="mx-auto mt-2 max-w-sm text-sm text-ink-muted">
              Classes keep your notes and AI context organized.
            </p>
            <Button
              variant="primary"
              className="mt-6"
              onClick={() => setDialogOpen(true)}
            >
              Create class
            </Button>
          </div>
        ) : (
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {classes.map((item) => (
              <li key={item.id}>
                <Link
                  to={`/classes/${item.id}`}
                  className="block rounded border border-line bg-surface p-5 transition-colors hover:border-line-strong hover:bg-surface-hover"
                >
                  <h2 className="font-medium text-ink">{item.name}</h2>
                  {item.course_code && (
                    <p className="mt-0.5 text-sm text-ink-muted">{item.course_code}</p>
                  )}
                  <p className="mt-4 text-sm text-ink-faint">
                    {item.semester && `${item.semester} · `}
                    {item.note_count} {item.note_count === 1 ? 'note' : 'notes'}
                  </p>
                  <p className="mt-1 text-sm text-ink-faint">
                    Edited {formatRelativeTime(item.updated_at)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>

      <CreateClassDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreate={handleCreate}
      />
    </div>
  )
}
```

- [ ] **Step 6: Verify in the browser**

```bash
npm run dev
```

Expected sequence:
1. `/classes` shows the "Create your first class" empty state.
2. Create "Biology 101", code "BIO 101", semester "Fall 2026" → dialog closes, a card appears reading "0 notes".
3. Refresh → the card persists.

- [ ] **Step 7: Commit**

```bash
git add student-notes-app/
git commit -m "feat(notes): classes service and dashboard"
```

---

### Task 10: Documents service with optimistic concurrency

The save path is the one piece of data logic with a real correctness requirement, so its decision logic is extracted into a pure function and tested first.

**Files:**
- Create: `student-notes-app/src/services/documents.ts`
- Create: `student-notes-app/src/services/documents.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/services/documents.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'

// documents.ts imports the shared `supabase` client at module scope, and that
// client throws synchronously at import time when the VITE_SUPABASE_* env vars
// are absent. This mock keeps that side effect out of the way so
// interpretSaveResult — a pure function with no Supabase dependency of its
// own — can be imported and tested in isolation. src/lib/supabase.ts is
// untouched, so the env check still protects the real app.
vi.mock('../lib/supabase', () => ({ supabase: {} }))

import { interpretSaveResult } from './documents'

describe('interpretSaveResult', () => {
  it('reports success when the conditional update matched a row', () => {
    const result = interpretSaveResult({ id: 'doc-1', version: 4 })
    expect(result).toEqual({ status: 'saved', version: 4 })
  })

  it('reports a stale write when no row matched', () => {
    expect(interpretSaveResult(null)).toEqual({ status: 'stale' })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- documents
```

Expected: FAIL — `Failed to resolve import "./documents"`.

- [ ] **Step 3: Implement `src/services/documents.ts`**

```ts
import { supabase } from '../lib/supabase'
import { extractPlainText } from '../lib/tiptap'
import type { JSONContent } from '@tiptap/react'
import type { DocumentListItem, DocumentRow } from '../types/database'

const EMPTY_DOC: JSONContent = { type: 'doc', content: [] }

export type SaveResult =
  | { status: 'saved'; version: number }
  | { status: 'stale' }

/**
 * Translates the row returned by a conditional update into a save outcome.
 *
 * The update is gated on the version the client last read. If another tab
 * saved first, the version no longer matches, zero rows are affected, and
 * PostgREST returns null — meaning this save is stale and must be discarded
 * rather than retried blindly, which would clobber the newer content.
 */
export function interpretSaveResult(
  row: { id: string; version: number } | null,
): SaveResult {
  if (!row) return { status: 'stale' }
  return { status: 'saved', version: row.version }
}

export async function fetchDocuments(classId: string): Promise<DocumentListItem[]> {
  const { data, error } = await supabase
    .from('documents')
    .select('id, class_id, title, created_at, updated_at')
    .eq('class_id', classId)
    .order('updated_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as DocumentListItem[]
}

export async function fetchDocument(documentId: string): Promise<DocumentRow | null> {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('id', documentId)
    .maybeSingle()

  if (error) throw error
  return data as DocumentRow | null
}

export async function createDocument(
  userId: string,
  classId: string,
  title = '',
): Promise<DocumentRow> {
  const { data, error } = await supabase
    .from('documents')
    .insert({
      user_id: userId,
      class_id: classId,
      title,
      content: EMPTY_DOC,
      content_text: '',
    })
    .select()
    .single()

  if (error) throw error
  return data as DocumentRow
}

/**
 * Conditionally saves a document.
 *
 * `expectedVersion` is the version the caller last read. The update only
 * applies if the stored version still matches, which makes concurrent saves
 * from two tabs safe: the loser gets `{ status: 'stale' }` and re-reads.
 */
export async function saveDocument(params: {
  documentId: string
  title: string
  content: JSONContent
  expectedVersion: number
}): Promise<SaveResult> {
  const { documentId, title, content, expectedVersion } = params

  const { data, error } = await supabase
    .from('documents')
    .update({
      title,
      content,
      content_text: extractPlainText(content),
      version: expectedVersion + 1,
    })
    .eq('id', documentId)
    .eq('version', expectedVersion)
    .select('id, version')
    .maybeSingle()

  if (error) throw error
  return interpretSaveResult(data as { id: string; version: number } | null)
}

export async function deleteDocument(documentId: string): Promise<void> {
  const { error } = await supabase.from('documents').delete().eq('id', documentId)
  if (error) throw error
}

/** Snapshot the current content before an AI edit, so the change is reversible. */
export async function snapshotDocument(
  userId: string,
  documentId: string,
  content: JSONContent,
  createdBy: 'user' | 'ai' = 'ai',
): Promise<void> {
  const { error } = await supabase.from('document_versions').insert({
    user_id: userId,
    document_id: documentId,
    content,
    created_by: createdBy,
  })
  if (error) throw error
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- documents
```

Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add student-notes-app/
git commit -m "feat(notes): documents service with optimistic concurrency"
```

---

### Task 11: Class page

**Files:**
- Modify: `student-notes-app/src/pages/ClassPage.tsx`

- [ ] **Step 1: Implement `ClassPage.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AppHeader } from '../components/AppHeader'
import { Button } from '../components/ui/Button'
import { useAuth } from '../contexts/AuthContext'
import { fetchClass, updateClass } from '../services/classes'
import { createDocument, fetchDocuments } from '../services/documents'
import { formatRelativeTime } from '../lib/formatDate'
import type { ClassRow, DocumentListItem } from '../types/database'

export default function ClassPage() {
  const { classId } = useParams<{ classId: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [klass, setKlass] = useState<ClassRow | null>(null)
  const [documents, setDocuments] = useState<DocumentListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [professor, setProfessor] = useState('')

  const load = useCallback(async () => {
    if (!classId) return
    try {
      const [classRow, docs] = await Promise.all([
        fetchClass(classId),
        fetchDocuments(classId),
      ])
      setKlass(classRow)
      setProfessor(classRow?.professor ?? '')
      setDocuments(docs)
    } catch (caught) {
      console.error('[ClassPage] failed to load class:', caught)
    } finally {
      setLoading(false)
    }
  }, [classId])

  useEffect(() => {
    void load()
  }, [load])

  async function handleNewNote() {
    if (!user || !classId) return
    const doc = await createDocument(user.id, classId)
    navigate(`/classes/${classId}/documents/${doc.id}`)
  }

  async function handleProfessorBlur() {
    if (!classId || !klass || professor === klass.professor) return
    try {
      await updateClass(classId, { professor: professor.trim() })
      setKlass({ ...klass, professor: professor.trim() })
    } catch (caught) {
      console.error('[ClassPage] failed to update professor:', caught)
      setProfessor(klass.professor)
    }
  }

  if (loading) return null
  if (!klass) return <div className="p-6 text-ink-muted">Class not found.</div>

  return (
    <div className="min-h-full">
      <AppHeader />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Link to="/classes" className="text-sm text-ink-muted hover:text-ink">
          ← My classes
        </Link>

        <h1 className="mt-6 text-2xl font-medium text-ink">{klass.name}</h1>

        <div className="mt-2 flex items-center gap-2">
          <label htmlFor="professor" className="text-sm text-ink-muted">
            Professor
          </label>
          <input
            id="professor"
            value={professor}
            placeholder="Add a name"
            onChange={(event) => setProfessor(event.target.value)}
            onBlur={() => void handleProfessorBlur()}
            className="rounded border border-transparent bg-transparent px-1.5 py-0.5 text-sm text-ink placeholder:text-ink-faint hover:border-line-strong focus:border-line-strong"
          />
        </div>

        <div className="mt-10 flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-ink-muted">
            Notes
          </h2>
          {documents.length > 0 && (
            <Button variant="primary" size="sm" onClick={() => void handleNewNote()}>
              New note
            </Button>
          )}
        </div>

        {documents.length === 0 ? (
          <div className="mt-16 text-center">
            <p className="text-ink">No notes yet.</p>
            <p className="mt-1 text-sm text-ink-muted">Start your first lecture note.</p>
            <Button
              variant="primary"
              className="mt-6"
              onClick={() => void handleNewNote()}
            >
              New note
            </Button>
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {documents.map((doc) => (
              <li key={doc.id}>
                <Link
                  to={`/classes/${klass.id}/documents/${doc.id}`}
                  className="flex items-center justify-between px-1 py-3 transition-colors hover:bg-surface-hover"
                >
                  <span className="text-ink">{doc.title || 'Untitled note'}</span>
                  <span className="text-sm text-ink-faint">
                    {formatRelativeTime(doc.updated_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Verify in the browser**

Open a class. Expected: empty state "No notes yet." Click "New note" → navigates to the editor stub at `/classes/<id>/documents/<id>`. Go back → the note is listed as "Untitled note". Type a professor name and click away → refresh and confirm it persisted.

- [ ] **Step 3: Commit**

```bash
git add student-notes-app/
git commit -m "feat(notes): class page with notes list"
```

---

### Task 12: Autosave scheduler

Debounced, coalescing, and safe against overlapping saves. Pure logic, fully unit-tested with fake timers before it touches React.

**Files:**
- Create: `student-notes-app/src/lib/autosave.ts`
- Create: `student-notes-app/src/lib/autosave.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/autosave.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createAutosaveScheduler } from './autosave'

describe('createAutosaveScheduler', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('does not save until the debounce window elapses', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const scheduler = createAutosaveScheduler({ delayMs: 1000, save })

    scheduler.schedule('draft')
    await vi.advanceTimersByTimeAsync(999)
    expect(save).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(save).toHaveBeenCalledExactlyOnceWith('draft')
  })

  it('coalesces rapid edits into a single save with the latest payload', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const scheduler = createAutosaveScheduler({ delayMs: 1000, save })

    scheduler.schedule('a')
    await vi.advanceTimersByTimeAsync(500)
    scheduler.schedule('ab')
    await vi.advanceTimersByTimeAsync(500)
    scheduler.schedule('abc')
    await vi.advanceTimersByTimeAsync(1000)

    expect(save).toHaveBeenCalledExactlyOnceWith('abc')
  })

  it('waits for an in-flight save before starting the next one', async () => {
    const order: string[] = []
    let release: () => void = () => {}
    const save = vi
      .fn()
      .mockImplementationOnce(async (payload: string) => {
        order.push(`start:${payload}`)
        await new Promise<void>((resolve) => {
          release = resolve
        })
        order.push(`end:${payload}`)
      })
      .mockImplementationOnce(async (payload: string) => {
        order.push(`start:${payload}`)
      })

    const scheduler = createAutosaveScheduler({ delayMs: 1000, save })

    scheduler.schedule('first')
    await vi.advanceTimersByTimeAsync(1000)
    expect(order).toEqual(['start:first'])

    // Second edit arrives while the first save is still in flight.
    scheduler.schedule('second')
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenCalledTimes(1)

    release()
    await vi.advanceTimersByTimeAsync(0)

    expect(order).toEqual(['start:first', 'end:first', 'start:second'])
  })

  it('flush saves immediately without waiting for the debounce', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const scheduler = createAutosaveScheduler({ delayMs: 1000, save })

    scheduler.schedule('urgent')
    await scheduler.flush()

    expect(save).toHaveBeenCalledExactlyOnceWith('urgent')
  })

  it('cancel discards a pending save', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const scheduler = createAutosaveScheduler({ delayMs: 1000, save })

    scheduler.schedule('discarded')
    scheduler.cancel()
    await vi.advanceTimersByTimeAsync(1000)

    expect(save).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- autosave
```

Expected: FAIL — `Failed to resolve import "./autosave"`.

- [ ] **Step 3: Implement `src/lib/autosave.ts`**

```ts
export interface AutosaveScheduler<T> {
  /** Queue a save. Resets the debounce window and replaces any pending payload. */
  schedule: (payload: T) => void
  /** Save any pending payload immediately. */
  flush: () => Promise<void>
  /** Drop any pending payload without saving. */
  cancel: () => void
}

interface Options<T> {
  delayMs: number
  save: (payload: T) => Promise<void>
}

/**
 * Debounced, coalescing autosave.
 *
 * Two properties matter and are covered by tests:
 *
 * 1. Coalescing — rapid edits collapse into one save carrying the newest
 *    payload. Intermediate keystrokes are never written.
 * 2. No overlap — while a save is in flight, a newly scheduled payload waits
 *    for it to settle instead of racing it. Without this, two concurrent
 *    requests could land out of order and the older content would win.
 */
export function createAutosaveScheduler<T>({
  delayMs,
  save,
}: Options<T>): AutosaveScheduler<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: { payload: T } | null = null
  let inFlight: Promise<void> | null = null

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  async function run(): Promise<void> {
    // Wait out any save already in progress, then take the newest payload.
    if (inFlight) await inFlight
    if (!pending) return

    const { payload } = pending
    pending = null

    inFlight = save(payload).finally(() => {
      inFlight = null
    })

    await inFlight

    // An edit that arrived mid-save is now waiting; save it too.
    if (pending) await run()
  }

  return {
    schedule(payload) {
      pending = { payload }
      clearTimer()
      timer = setTimeout(() => {
        timer = null
        void run()
      }, delayMs)
    },

    async flush() {
      clearTimer()
      await run()
    },

    cancel() {
      clearTimer()
      pending = null
    },
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- autosave
```

Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add student-notes-app/
git commit -m "feat(notes): debounced coalescing autosave scheduler"
```

---

### Task 13: Tiptap editor and formatting toolbar

**Files:**
- Create: `student-notes-app/src/editor/DocumentEditor.tsx`
- Create: `student-notes-app/src/editor/FormattingToolbar.tsx`
- Create: `student-notes-app/src/editor/extensions.ts`
- Modify: `student-notes-app/src/index.css`

- [ ] **Step 1: Install the remaining Tiptap extensions**

```bash
npm install @tiptap/extension-underline @tiptap/extension-link \
  @tiptap/extension-task-list @tiptap/extension-task-item \
  @tiptap/extension-placeholder
```

- [ ] **Step 2: Create `src/editor/extensions.ts`**

```ts
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Placeholder from '@tiptap/extension-placeholder'

/**
 * The editor's extension set.
 *
 * StarterKit supplies paragraphs, headings, bold/italic/strike, bullet and
 * ordered lists (with nesting), blockquote, horizontal rule, code, and the
 * undo/redo history — including the Ctrl/Cmd+B/I/Z/Shift+Z shortcuts.
 */
export const editorExtensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
  }),
  Underline,
  Link.configure({
    openOnClick: false,
    autolink: true,
    HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
  }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Placeholder.configure({ placeholder: 'Start typing your notes…' }),
]
```

- [ ] **Step 3: Create `src/editor/FormattingToolbar.tsx`**

Icon-only controls each carry a `title` and `aria-label`; the container is a `role="toolbar"`.

```tsx
import type { Editor } from '@tiptap/react'
import {
  Bold, Italic, Underline, Strikethrough, List, ListOrdered,
  ListChecks, Quote, Minus, Undo2, Redo2,
} from 'lucide-react'
import { cn } from '../lib/cn'

interface FormattingToolbarProps {
  editor: Editor | null
}

interface ToolButtonProps {
  label: string
  icon: typeof Bold
  active?: boolean
  disabled?: boolean
  onClick: () => void
}

function ToolButton({ label, icon: Icon, active, disabled, onClick }: ToolButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'grid h-8 w-8 place-items-center rounded transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-40',
        active ? 'bg-accent-subtle text-accent' : 'text-ink-muted hover:bg-surface-hover',
      )}
    >
      <Icon size={16} strokeWidth={2} />
    </button>
  )
}

const TEXT_STYLES = [
  { label: 'Normal text', level: 0 },
  { label: 'Heading 1', level: 1 },
  { label: 'Heading 2', level: 2 },
  { label: 'Heading 3', level: 3 },
] as const

export function FormattingToolbar({ editor }: FormattingToolbarProps) {
  if (!editor) return null

  const activeLevel =
    ([1, 2, 3] as const).find((level) => editor.isActive('heading', { level })) ?? 0

  return (
    <div
      role="toolbar"
      aria-label="Text formatting"
      className="flex items-center gap-1 overflow-x-auto border-b border-line bg-surface px-4 py-1.5"
    >
      <ToolButton
        label="Undo"
        icon={Undo2}
        disabled={!editor.can().undo()}
        onClick={() => editor.chain().focus().undo().run()}
      />
      <ToolButton
        label="Redo"
        icon={Redo2}
        disabled={!editor.can().redo()}
        onClick={() => editor.chain().focus().redo().run()}
      />

      <div className="mx-1 h-5 w-px bg-line" />

      <label htmlFor="text-style" className="sr-only">
        Text style
      </label>
      <select
        id="text-style"
        value={activeLevel}
        onChange={(event) => {
          const level = Number(event.target.value)
          if (level === 0) editor.chain().focus().setParagraph().run()
          else
            editor
              .chain()
              .focus()
              .toggleHeading({ level: level as 1 | 2 | 3 })
              .run()
        }}
        className="h-8 rounded border border-line-strong bg-surface px-2 text-sm text-ink"
      >
        {TEXT_STYLES.map((style) => (
          <option key={style.level} value={style.level}>
            {style.label}
          </option>
        ))}
      </select>

      <div className="mx-1 h-5 w-px bg-line" />

      <ToolButton
        label="Bold"
        icon={Bold}
        active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
      />
      <ToolButton
        label="Italic"
        icon={Italic}
        active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      />
      <ToolButton
        label="Underline"
        icon={Underline}
        active={editor.isActive('underline')}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      />
      <ToolButton
        label="Strikethrough"
        icon={Strikethrough}
        active={editor.isActive('strike')}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      />

      <div className="mx-1 h-5 w-px bg-line" />

      <ToolButton
        label="Bulleted list"
        icon={List}
        active={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      />
      <ToolButton
        label="Numbered list"
        icon={ListOrdered}
        active={editor.isActive('orderedList')}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      />
      <ToolButton
        label="Checklist"
        icon={ListChecks}
        active={editor.isActive('taskList')}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
      />

      <div className="mx-1 h-5 w-px bg-line" />

      <ToolButton
        label="Quote"
        icon={Quote}
        active={editor.isActive('blockquote')}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      />
      <ToolButton
        label="Divider"
        icon={Minus}
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      />
    </div>
  )
}
```

- [ ] **Step 4: Create `src/editor/DocumentEditor.tsx`**

```tsx
import { EditorContent, useEditor, type JSONContent } from '@tiptap/react'
import { useEffect } from 'react'
import { editorExtensions } from './extensions'
import { FormattingToolbar } from './FormattingToolbar'

interface DocumentEditorProps {
  /** Initial content. Changes to this prop reload the editor document. */
  initialContent: JSONContent
  /** Identity of the loaded document; changing it swaps the editor content. */
  documentId: string
  onChange: (content: JSONContent) => void
}

export function DocumentEditor({
  initialContent,
  documentId,
  onChange,
}: DocumentEditorProps) {
  const editor = useEditor({
    extensions: editorExtensions,
    content: initialContent,
    editorProps: {
      attributes: {
        class: 'outline-none',
        'aria-label': 'Note content',
      },
    },
    onUpdate: ({ editor: instance }) => {
      onChange(instance.getJSON())
    },
  })

  // Swap content when navigating between documents without remounting the
  // editor. `false` suppresses an onUpdate, so loading never marks the
  // document dirty and never triggers a spurious save.
  useEffect(() => {
    if (!editor) return
    editor.commands.setContent(initialContent, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, editor])

  return (
    <>
      <FormattingToolbar editor={editor} />
      <div className="flex-1 overflow-y-auto bg-surface-backdrop px-4 py-8">
        <div className="mx-auto min-h-[1056px] max-w-sheet bg-surface px-12 py-14 shadow-sheet sm:px-16">
          <EditorContent editor={editor} />
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 5: Add editor typography to `src/index.css`**

Append below the existing `@layer base` block:

```css
@layer components {
  .ProseMirror {
    @apply font-doc text-[11pt] leading-[1.75] text-ink;
  }

  .ProseMirror > * + * {
    @apply mt-3;
  }

  .ProseMirror h1 {
    @apply mt-6 font-sans text-[20pt] font-medium leading-tight;
  }
  .ProseMirror h2 {
    @apply mt-5 font-sans text-[16pt] font-medium leading-tight;
  }
  .ProseMirror h3 {
    @apply mt-4 font-sans text-[13pt] font-medium leading-tight;
  }

  .ProseMirror ul {
    @apply list-disc pl-6;
  }
  .ProseMirror ol {
    @apply list-decimal pl-6;
  }
  .ProseMirror li > ul,
  .ProseMirror li > ol {
    @apply mt-1;
  }

  .ProseMirror blockquote {
    @apply border-l-4 border-line-strong pl-4 text-ink-muted;
  }

  .ProseMirror hr {
    @apply my-6 border-line;
  }

  .ProseMirror a {
    @apply text-accent underline;
  }

  .ProseMirror code {
    @apply rounded bg-surface-hover px-1 py-0.5 font-mono text-[0.9em];
  }

  /* Checklists render as real checkboxes rather than bullets. */
  .ProseMirror ul[data-type='taskList'] {
    @apply list-none pl-0;
  }
  .ProseMirror ul[data-type='taskList'] li {
    @apply flex items-start gap-2;
  }
  .ProseMirror ul[data-type='taskList'] li > label {
    @apply mt-1 shrink-0;
  }

  /* Placeholder text on an empty first line. */
  .ProseMirror p.is-editor-empty:first-child::before {
    @apply pointer-events-none float-left h-0 text-ink-faint;
    content: attr(data-placeholder);
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add student-notes-app/
git commit -m "feat(notes): tiptap editor and formatting toolbar"
```

---

### Task 14: Editor page — title, autosave, save status, layout

Assembles the editor, autosave scheduler, and the AI sidebar slot (empty until the AI plan).

**Files:**
- Create: `student-notes-app/src/constants/layout.ts`
- Create: `student-notes-app/src/components/SaveStatus.tsx`
- Create: `student-notes-app/src/hooks/useOnlineStatus.ts`
- Modify: `student-notes-app/src/pages/EditorPage.tsx`

- [ ] **Step 1: Create `src/constants/layout.ts`**

```ts
/**
 * Which side the AI sidebar occupies. Single source of truth so the sidebar
 * can be moved without hunting through CSS.
 */
export const AI_SIDEBAR_SIDE: 'left' | 'right' = 'left'

export const AI_SIDEBAR_WIDTH_PX = 360
```

- [ ] **Step 2: Create `src/hooks/useOnlineStatus.ts`**

```ts
import { useEffect, useState } from 'react'

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return online
}
```

- [ ] **Step 3: Create `src/components/SaveStatus.tsx`**

```tsx
export type SaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'error'

const LABELS: Record<SaveState, string> = {
  idle: '',
  saving: 'Saving…',
  saved: 'Saved',
  offline: 'Offline',
  error: "Couldn't save",
}

export function SaveStatus({ state }: { state: SaveState }) {
  return (
    <span
      // Announced to screen readers when it changes, without stealing focus.
      role="status"
      aria-live="polite"
      className="text-sm text-ink-faint"
    >
      {LABELS[state]}
    </span>
  )
}
```

- [ ] **Step 4: Implement `EditorPage.tsx`**

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { JSONContent } from '@tiptap/react'
import { DocumentEditor } from '../editor/DocumentEditor'
import { SaveStatus, type SaveState } from '../components/SaveStatus'
import { Button } from '../components/ui/Button'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { createAutosaveScheduler } from '../lib/autosave'
import { fetchClass } from '../services/classes'
import { fetchDocument, saveDocument } from '../services/documents'
import { AI_SIDEBAR_SIDE, AI_SIDEBAR_WIDTH_PX } from '../constants/layout'
import { cn } from '../lib/cn'
import type { ClassRow, DocumentRow } from '../types/database'

const AUTOSAVE_DELAY_MS = 1000

interface DraftPayload {
  title: string
  content: JSONContent
}

export default function EditorPage() {
  const { classId, documentId } = useParams<{ classId: string; documentId: string }>()
  const online = useOnlineStatus()

  const [klass, setKlass] = useState<ClassRow | null>(null)
  const [doc, setDoc] = useState<DocumentRow | null>(null)
  const [title, setTitle] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [sidebarOpen, setSidebarOpen] = useState(true)

  // The version the client last read. Every save is conditional on it, and it
  // advances on each successful write. Held in a ref so the scheduler always
  // reads the current value rather than a captured stale one.
  const versionRef = useRef<number>(1)

  const persist = useCallback(
    async ({ title: nextTitle, content }: DraftPayload) => {
      if (!documentId) return
      setSaveState('saving')
      try {
        const result = await saveDocument({
          documentId,
          title: nextTitle,
          content,
          expectedVersion: versionRef.current,
        })

        if (result.status === 'stale') {
          // Another tab saved first. Re-read rather than clobbering it.
          const fresh = await fetchDocument(documentId)
          if (fresh) {
            versionRef.current = fresh.version
            setDoc(fresh)
            setTitle(fresh.title)
          }
          setSaveState('saved')
          return
        }

        versionRef.current = result.version
        setSaveState('saved')
      } catch (caught) {
        console.error('[EditorPage] save failed:', caught)
        setSaveState('error')
      }
    },
    [documentId],
  )

  const scheduler = useMemo(
    () => createAutosaveScheduler<DraftPayload>({ delayMs: AUTOSAVE_DELAY_MS, save: persist }),
    [persist],
  )

  useEffect(() => {
    if (!documentId || !classId) return
    let cancelled = false

    void (async () => {
      try {
        const [classRow, docRow] = await Promise.all([
          fetchClass(classId),
          fetchDocument(documentId),
        ])
        if (cancelled) return
        setKlass(classRow)
        setDoc(docRow)
        setTitle(docRow?.title ?? '')
        versionRef.current = docRow?.version ?? 1
      } catch (caught) {
        console.error('[EditorPage] failed to load document:', caught)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [classId, documentId])

  // Save anything pending when leaving the page.
  useEffect(() => () => void scheduler.flush(), [scheduler])

  // Ctrl/Cmd + Shift + A toggles the AI sidebar.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        setSidebarOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const contentRef = useRef<JSONContent | null>(null)

  function handleContentChange(content: JSONContent) {
    contentRef.current = content
    scheduler.schedule({ title, content })
  }

  function handleTitleChange(nextTitle: string) {
    setTitle(nextTitle)
    scheduler.schedule({
      title: nextTitle,
      content: contentRef.current ?? (doc?.content as JSONContent),
    })
  }

  if (!doc) return null

  const displayState: SaveState = online ? saveState : 'offline'

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-surface px-4">
        <Link
          to={`/classes/${classId}`}
          className="shrink-0 text-sm text-ink-muted hover:text-ink"
        >
          ←
        </Link>
        <div className="flex min-w-0 items-baseline gap-2">
          {klass && (
            <span className="hidden shrink-0 text-sm text-ink-muted sm:inline">
              {klass.name} ›
            </span>
          )}
          <label htmlFor="doc-title" className="sr-only">
            Note title
          </label>
          <input
            id="doc-title"
            value={title}
            placeholder="Untitled note"
            onChange={(event) => handleTitleChange(event.target.value)}
            className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-base text-ink placeholder:text-ink-faint hover:border-line-strong focus:border-line-strong"
          />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          <SaveStatus state={displayState} />
          <Button
            size="sm"
            title="Toggle AI assistant (Ctrl+Shift+A)"
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen((open) => !open)}
          >
            AI
          </Button>
        </div>
      </header>

      <div
        className={cn(
          'flex min-h-0 flex-1',
          AI_SIDEBAR_SIDE === 'right' && 'flex-row-reverse',
        )}
      >
        {sidebarOpen && (
          <aside
            style={{ width: AI_SIDEBAR_WIDTH_PX }}
            aria-label="AI assistant"
            className={cn(
              'hidden shrink-0 flex-col bg-surface lg:flex',
              AI_SIDEBAR_SIDE === 'left' ? 'border-r border-line' : 'border-l border-line',
            )}
          >
            <div className="p-4 text-sm text-ink-muted">
              AI assistant arrives in the next stage.
            </div>
          </aside>
        )}

        <main className="flex min-w-0 flex-1 flex-col">
          <DocumentEditor
            documentId={doc.id}
            initialContent={doc.content as JSONContent}
            onChange={handleContentChange}
          />
        </main>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Verify the full document flow in the browser**

```bash
npm run dev
```

Check each of these:
1. Open a note. Type a title → status shows `Saving…` then `Saved`.
2. Type body text → same.
3. Apply bold, a heading, a bulleted list, and a checklist. Verify Ctrl+B and Ctrl+Z work.
4. Refresh the page → title and all formatting survive.
5. Go back to the class page → the note title appears in the list.
6. Open DevTools → Network → set Offline. Type. Expected: status reads `Offline`.
7. Open the same note in two tabs. Edit in tab A, wait for `Saved`. Then edit in tab B. Expected: tab B detects the stale version, re-reads, and shows tab A's content rather than silently overwriting it.
8. Press Ctrl+Shift+A → the sidebar collapses and the document re-centers.

- [ ] **Step 6: Run the full test suite and type-check**

```bash
npm test && npx tsc -b --noEmit
```

Expected: PASS — 18 tests (7 tiptap, 4 Button, 2 documents, 5 autosave), no type errors.

- [ ] **Step 7: Commit**

```bash
git add student-notes-app/
git commit -m "feat(notes): editor page with autosave and save status"
```

---

### Task 15: Responsive and accessibility pass

**Files:**
- Modify: `student-notes-app/src/pages/EditorPage.tsx`
- Create: `student-notes-app/src/components/AiDrawer.tsx`

- [ ] **Step 1: Create `src/components/AiDrawer.tsx`**

Below `lg`, the sidebar becomes an overlay drawer sliding in from the same side as the desktop sidebar.

```tsx
import type { ReactNode } from 'react'
import { AI_SIDEBAR_SIDE } from '../constants/layout'
import { cn } from '../lib/cn'

interface AiDrawerProps {
  open: boolean
  onClose: () => void
  children: ReactNode
}

export function AiDrawer({ open, onClose, children }: AiDrawerProps) {
  return (
    <div
      className={cn(
        'fixed inset-0 z-40 lg:hidden',
        open ? 'pointer-events-auto' : 'pointer-events-none',
      )}
      aria-hidden={!open}
    >
      <button
        type="button"
        tabIndex={open ? 0 : -1}
        aria-label="Close AI assistant"
        onClick={onClose}
        className={cn(
          'absolute inset-0 bg-ink/20 transition-opacity',
          open ? 'opacity-100' : 'opacity-0',
        )}
      />
      <aside
        aria-label="AI assistant"
        className={cn(
          'absolute inset-y-0 flex w-[min(360px,85vw)] flex-col bg-surface shadow-sheet transition-transform',
          AI_SIDEBAR_SIDE === 'left'
            ? ['left-0 border-r border-line', open ? 'translate-x-0' : '-translate-x-full']
            : ['right-0 border-l border-line', open ? 'translate-x-0' : 'translate-x-full'],
        )}
      >
        {children}
      </aside>
    </div>
  )
}
```

- [ ] **Step 2: Render the drawer from `EditorPage`**

Add the import:

```tsx
import { AiDrawer } from '../components/AiDrawer'
```

Then insert immediately before the closing `</div>` of the outermost element:

```tsx
      <AiDrawer open={sidebarOpen} onClose={() => setSidebarOpen(false)}>
        <div className="p-4 text-sm text-ink-muted">
          AI assistant arrives in the next stage.
        </div>
      </AiDrawer>
```

- [ ] **Step 3: Make the document sheet full-bleed on small screens**

In `DocumentEditor.tsx`, replace the wrapper and sheet classes:

```tsx
      <div className="flex-1 overflow-y-auto bg-surface-backdrop px-0 py-0 sm:px-4 sm:py-8">
        <div className="mx-auto min-h-full max-w-sheet bg-surface px-6 py-8 sm:min-h-[1056px] sm:px-12 sm:py-14 sm:shadow-sheet lg:px-16">
```

- [ ] **Step 4: Verify responsive behavior**

In DevTools, test three widths:
- **1280px** — sidebar docked on the left, document centered in remaining space.
- **900px** — sidebar hidden; the AI button opens a left drawer over the document; Escape-free backdrop click closes it.
- **380px** — the document fills the width with no shadow or margins; the toolbar scrolls horizontally; the drawer covers most of the screen.

- [ ] **Step 5: Keyboard-only pass**

With the mouse untouched, Tab through the editor page. Confirm every control has a visible focus ring, the toolbar buttons are reachable, `title` tooltips exist on the icon buttons, and the AI toggle is operable with Enter.

- [ ] **Step 6: Run the full suite**

```bash
npm test && npx tsc -b --noEmit && npm run build
```

Expected: all tests pass, no type errors, production build succeeds.

- [ ] **Step 7: Commit**

```bash
git add student-notes-app/
git commit -m "feat(notes): responsive drawer and accessibility pass"
```

---

### Task 16: Rename and delete for classes and notes

The spec's testing requirements call for renaming and deleting classes and deleting
notes. The services already exist (`updateClass`, `deleteClass`, `deleteDocument`);
this task adds the UI.

**Files:**
- Create: `student-notes-app/src/components/ui/MenuButton.tsx`
- Create: `student-notes-app/src/components/ui/MenuButton.test.tsx`
- Create: `student-notes-app/src/components/RenameClassDialog.tsx`
- Modify: `student-notes-app/src/pages/ClassPage.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/ui/MenuButton.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MenuButton } from './MenuButton'

describe('MenuButton', () => {
  it('keeps the menu closed until the trigger is activated', () => {
    render(
      <MenuButton label="Class options" items={[{ label: 'Rename', onSelect: vi.fn() }]} />,
    )
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('opens the menu and reports expanded state', async () => {
    render(
      <MenuButton label="Class options" items={[{ label: 'Rename', onSelect: vi.fn() }]} />,
    )
    const trigger = screen.getByRole('button', { name: 'Class options' })
    await userEvent.click(trigger)

    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })

  it('runs the selected item and closes the menu', async () => {
    const onSelect = vi.fn()
    render(<MenuButton label="Class options" items={[{ label: 'Rename', onSelect }]} />)

    await userEvent.click(screen.getByRole('button', { name: 'Class options' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))

    expect(onSelect).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    render(
      <MenuButton label="Class options" items={[{ label: 'Rename', onSelect: vi.fn() }]} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Class options' }))
    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- MenuButton
```

Expected: FAIL — `Failed to resolve import "./MenuButton"`.

- [ ] **Step 3: Implement `MenuButton.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import { MoreVertical } from 'lucide-react'
import { cn } from '../../lib/cn'

export interface MenuItem {
  label: string
  onSelect: () => void
  destructive?: boolean
}

interface MenuButtonProps {
  label: string
  items: MenuItem[]
}

export function MenuButton({ label, items }: MenuButtonProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="grid h-8 w-8 place-items-center rounded text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
      >
        <MoreVertical size={16} strokeWidth={2} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-10 mt-1 min-w-[160px] rounded border border-line bg-surface py-1 shadow-sheet"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
              className={cn(
                'block w-full px-3 py-1.5 text-left text-sm transition-colors hover:bg-surface-hover',
                item.destructive ? 'text-red-600' : 'text-ink',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- MenuButton
```

Expected: PASS — 4 tests.

- [ ] **Step 5: Create `RenameClassDialog.tsx`**

```tsx
import { useEffect, useState, type FormEvent } from 'react'
import { Dialog } from './ui/Dialog'
import { Button } from './ui/Button'
import { Input } from './ui/Input'

interface RenameClassDialogProps {
  open: boolean
  currentName: string
  onClose: () => void
  onRename: (name: string) => Promise<void>
}

export function RenameClassDialog({
  open,
  currentName,
  onClose,
  onRename,
}: RenameClassDialogProps) {
  const [name, setName] = useState(currentName)
  const [submitting, setSubmitting] = useState(false)

  // Reset the field whenever the dialog reopens, so a cancelled edit does not
  // linger the next time it is opened.
  useEffect(() => {
    if (open) setName(currentName)
  }, [open, currentName])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return

    setSubmitting(true)
    try {
      await onRename(trimmed)
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Rename class">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="Class name"
          required
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <div className="mt-2 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={submitting}>
            Rename
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
```

- [ ] **Step 6: Wire the menus into `ClassPage.tsx`**

Add these imports:

```tsx
import { MenuButton } from '../components/ui/MenuButton'
import { RenameClassDialog } from '../components/RenameClassDialog'
import { deleteClass } from '../services/classes'
import { deleteDocument } from '../services/documents'
```

Add this state alongside the existing state declarations:

```tsx
  const [renameOpen, setRenameOpen] = useState(false)
```

Add these handlers above the `if (loading)` early return:

```tsx
  async function handleRename(name: string) {
    if (!classId || !klass) return
    await updateClass(classId, { name })
    setKlass({ ...klass, name })
  }

  async function handleDeleteClass() {
    if (!classId || !klass) return
    const confirmed = window.confirm(
      `Delete "${klass.name}" and all of its notes? This cannot be undone.`,
    )
    if (!confirmed) return

    try {
      await deleteClass(classId)
      navigate('/classes', { replace: true })
    } catch (caught) {
      console.error('[ClassPage] failed to delete class:', caught)
    }
  }

  async function handleDeleteDocument(documentId: string, docTitle: string) {
    const confirmed = window.confirm(
      `Delete "${docTitle || 'Untitled note'}"? This cannot be undone.`,
    )
    if (!confirmed) return

    try {
      await deleteDocument(documentId)
      await load()
    } catch (caught) {
      console.error('[ClassPage] failed to delete note:', caught)
    }
  }
```

Replace the `<h1>` line with a heading row carrying the class menu:

```tsx
        <div className="mt-6 flex items-center justify-between gap-4">
          <h1 className="text-2xl font-medium text-ink">{klass.name}</h1>
          <MenuButton
            label="Class options"
            items={[
              { label: 'Rename class', onSelect: () => setRenameOpen(true) },
              {
                label: 'Delete class',
                destructive: true,
                onSelect: () => void handleDeleteClass(),
              },
            ]}
          />
        </div>
```

Replace each note `<li>` so the row carries its own menu. The link and the menu
are siblings — a menu nested inside the link would make the whole row a confusing
click target:

```tsx
              <li key={doc.id} className="flex items-center gap-2">
                <Link
                  to={`/classes/${klass.id}/documents/${doc.id}`}
                  className="flex flex-1 items-center justify-between px-1 py-3 transition-colors hover:bg-surface-hover"
                >
                  <span className="text-ink">{doc.title || 'Untitled note'}</span>
                  <span className="text-sm text-ink-faint">
                    {formatRelativeTime(doc.updated_at)}
                  </span>
                </Link>
                <MenuButton
                  label={`Options for ${doc.title || 'Untitled note'}`}
                  items={[
                    {
                      label: 'Delete note',
                      destructive: true,
                      onSelect: () => void handleDeleteDocument(doc.id, doc.title),
                    },
                  ]}
                />
              </li>
```

Add the dialog immediately before the closing `</div>` of the page:

```tsx
      <RenameClassDialog
        open={renameOpen}
        currentName={klass.name}
        onClose={() => setRenameOpen(false)}
        onRename={handleRename}
      />
```

- [ ] **Step 7: Verify in the browser**

1. Open a class → the ⋮ menu offers Rename and Delete.
2. Rename → the heading updates; `/classes` reflects the new name.
3. Delete a note → confirm prompt, note disappears, count drops on `/classes`.
4. Delete a class → confirm prompt, redirect to `/classes`, class gone.
5. Confirm the class's notes were also removed:

```sql
select count(*) from public.documents where class_id = '<deleted-class-id>';
```

Expected: `0` — the `on delete cascade` removed them.

- [ ] **Step 8: Run the full suite**

```bash
npm test && npx tsc -b --noEmit && npm run build
```

Expected: PASS — 22 tests (7 tiptap, 4 Button, 2 documents, 5 autosave, 4 MenuButton), no type errors, build succeeds.

- [ ] **Step 9: Commit**

```bash
git add student-notes-app/
git commit -m "feat(notes): rename and delete for classes and notes"
```

---

## Verification Checklist

Run through this as a student would, per the spec's final requirement. Every item must pass before this plan is considered done.

- [ ] Sign up with a new email → lands on `/classes`
- [ ] Sign out, sign back in → session restores without a login flash on refresh
- [ ] Password reset email arrives and sets a new password
- [ ] `/classes` empty state offers exactly one obvious action
- [ ] Create a class → appears immediately with "0 notes"
- [ ] Rename a class → the new name shows on both the class page and `/classes`
- [ ] Open the class → "No notes yet" empty state
- [ ] Create a note → editor opens with the title focused
- [ ] Type → `Saving…` then `Saved`, with no typing lag
- [ ] Bold, italic, underline, strikethrough all work by button and shortcut
- [ ] Headings 1–3, bullets, numbered lists, nested lists, checklists all work
- [ ] Quote, divider, and links render correctly
- [ ] Undo/redo work by button and Ctrl+Z / Ctrl+Shift+Z
- [ ] Refresh → all formatting survives intact
- [ ] Note title updates in the class list
- [ ] Delete a note → it disappears and the class note count drops
- [ ] Delete a class → its notes are cascade-deleted
- [ ] Two tabs editing the same note → no silent data loss
- [ ] Offline → status reads `Offline`
- [ ] Ctrl+Shift+A toggles the sidebar; the document re-centers
- [ ] At 380px the document is still the primary interface
- [ ] Full keyboard navigation with visible focus throughout
- [ ] `npm test` passes; `npx tsc -b --noEmit` is clean; `npm run build` succeeds

## What This Plan Does Not Build

Stages 3–6 from the spec, all deferred to a follow-up plan that requires a Gemini API key:

AI edge function, centralized prompt, context assembly, structured Gemini responses, the AI sidebar's actual contents, selection tracking, the floating selection toolbar, suggestion cards with Apply/Reject, class-memory retrieval, and AI error handling.

The `document_versions`, `conversations`, and `messages` tables and the `snapshotDocument()` service exist now so that plan requires no migrations.
