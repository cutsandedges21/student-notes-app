# Supabase

## Where the schema lives

`migrations/`, and nowhere else.

There used to be a hand-maintained `schema.sql` that you pasted into the SQL
editor. It has been split into the migration history in `migrations/`, verified
statement-for-statement against the file it replaced (91 statements, no
additions, no omissions). It was then deleted rather than kept alongside,
because two files describing one schema drift, and the one you are not looking
at is always the one that is right.

Every migration is idempotent. The history was written after the fact from a
schema that had already been applied by hand to a live project, so the first
run of these files is against a database that already contains all of them.
Each has to be a no-op when its objects exist and only do work from empty.

## Local development

Requires Docker.

```bash
npx supabase start          # boots Postgres, Auth, Storage, Studio
npx supabase db reset       # applies every migration from scratch, in order
```

`db reset` is the real test of the migration history: it runs the files against
an empty database in filename order. Run it after adding a migration.

## Adding a migration

```bash
npx supabase migration new <name>
```

Then edit the generated file. Rules that matter here:

- **Idempotent.** `create table if not exists`, `add column if not exists`,
  `drop policy if exists` before `create policy`, `drop function` before
  recreating anything whose return type may change (`create or replace
  function` cannot change a return type).
- **Additive first.** Add a nullable column, backfill it, then add the
  constraint. Adding a not-null column with no default to a populated table
  fails outright.
- **Never drop a column in the same change that stops using it.** Ship the code
  that no longer reads it, confirm nothing does, then drop it in a later
  migration.
- Do not edit a migration that has already been applied anywhere. Write a new
  one.

## Applying to a hosted project

```bash
npx supabase link --project-ref <ref>
npx supabase db push
```

`db push` applies only migrations the remote has not recorded. Against a
project that already has this schema applied by hand, the first push records
the history and changes nothing, because every statement is idempotent.

## Edge functions

```bash
npx supabase functions deploy ai-assist            # deploys the split source
npx supabase secrets set GEMINI_API_KEY=...        # never a VITE_ variable
npx supabase secrets set GEMINI_MODEL=gemini-3.6-flash   # optional override
```

The function is deployed from its real multi-file source. There is no bundling
step and no copy-paste into the dashboard editor.
