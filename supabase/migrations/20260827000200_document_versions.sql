-- Document snapshots.
--
-- A row is written immediately before any AI-applied edit, so an AI change is
-- always reversible even after the editor's own undo history is gone.
--
-- Insert-only by policy: there is no update or delete policy, so history
-- cannot be rewritten by the client. Rows disappear only when the document or
-- the account does, via cascade.
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
