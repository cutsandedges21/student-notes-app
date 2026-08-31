-- Starring, and a lookup index for same-named classes.
--
-- Starring was a browser-local flag (localStorage `margin:starred:<id>`),
-- which made it invisible on a second device and meant guest stars were
-- dropped on the way into an account. Additive and defaulted, so existing rows
-- come out unstarred and nothing that predates the column has to change.
alter table public.documents
  add column if not exists starred boolean not null default false;

-- Deliberately NOT unique.
--
-- `classes(user_id, name)` has never been unique and real accounts already
-- hold duplicates -- two terms of "Biology 101" is ordinary -- so a unique
-- index here would fail to build against existing data, and would be the wrong
-- constraint even on an empty database. Code that resolves a class by name
-- must therefore pick deterministically rather than assume a single row; see
-- pickDestinationClass() in src/services/sharing.ts, which is what stopped
-- "Make a copy" failing with PGRST116 for anyone who had taken a course twice.
--
-- created_at is in the index because that ordering is what makes the choice
-- deterministic.
create index if not exists classes_user_name_created_idx
  on public.classes(user_id, name, created_at);
