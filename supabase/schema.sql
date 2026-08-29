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
--
-- Functions whose return shape may change are dropped before being recreated:
-- `create or replace` cannot alter a return type, so re-running would fail
-- otherwise. touch_updated_at and handle_new_user are deliberately NOT dropped
-- -- triggers depend on them, and dropping would take those triggers with it.
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

-- ============================================================================
-- Readable URLs
-- ============================================================================
-- Slugs are for links only; rows stay keyed by id everywhere internally.
-- Unique per scope: a class slug within a user, a note slug within a class.
-- ----------------------------------------------------------------------------

alter table public.classes add column if not exists slug text;
alter table public.documents add column if not exists slug text;

-- Backfill existing rows. The expression mirrors the client's slugify for the
-- latin case; anything that reduces to nothing becomes 'untitled', and repeats
-- within a scope get a counter, matching uniqueSlug().
with numbered as (
  select
    id,
    case
      when row_number() over (partition by user_id, base order by created_at) = 1
        then base
      else base || '-' ||
           row_number() over (partition by user_id, base order by created_at)
    end as new_slug
  from (
    select id, user_id, created_at,
           coalesce(
             nullif(trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')), ''),
             'untitled'
           ) as base
    from public.classes
    where slug is null
  ) s
)
update public.classes c set slug = n.new_slug from numbered n where n.id = c.id;

with numbered as (
  select
    id,
    case
      when row_number() over (partition by class_id, base order by created_at) = 1
        then base
      else base || '-' ||
           row_number() over (partition by class_id, base order by created_at)
    end as new_slug
  from (
    select id, class_id, created_at,
           coalesce(
             nullif(trim(both '-' from regexp_replace(lower(title), '[^a-z0-9]+', '-', 'g')), ''),
             'untitled'
           ) as base
    from public.documents
    where slug is null
  ) s
)
update public.documents d set slug = n.new_slug from numbered n where n.id = d.id;

-- Any row still without a slug (e.g. inserted between the two statements)
-- falls back to its id, which is unique by construction.
update public.classes set slug = id::text where slug is null;
update public.documents set slug = id::text where slug is null;

alter table public.classes alter column slug set not null;
alter table public.documents alter column slug set not null;

create unique index if not exists classes_user_slug_idx on public.classes(user_id, slug);
create unique index if not exists documents_class_slug_idx on public.documents(class_id, slug);


-- ============================================================================
-- Link sharing
-- ============================================================================
-- Sharing is token-based, NOT policy-based.
--
-- The obvious approach -- an RLS policy like `using (share_mode <> 'private')`
-- -- would let anyone run `GET /documents?share_mode=eq.view` and enumerate
-- every shared document in the project. Access therefore goes through
-- SECURITY DEFINER functions that require the caller to already know an
-- unguessable token, and the base tables keep their owner-only policies.
-- ----------------------------------------------------------------------------

alter table public.documents
  add column if not exists share_mode text not null default 'private';

-- Added separately so re-running against an existing table is safe.
alter table public.documents drop constraint if exists documents_share_mode_check;
alter table public.documents
  add constraint documents_share_mode_check
  check (share_mode in ('private', 'view', 'edit'));

alter table public.documents
  add column if not exists share_token uuid not null default gen_random_uuid();

create unique index if not exists documents_share_token_idx
  on public.documents(share_token);

-- ----------------------------------------------------------------------------
-- Read a shared document by token.
--
-- Returns nothing when the token is unknown or sharing is off, so a wrong
-- guess is indistinguishable from a private document.
-- ----------------------------------------------------------------------------
drop function if exists public.get_shared_document(uuid);
create or replace function public.get_shared_document(p_token uuid)
returns table (
  id uuid,
  class_id uuid,
  class_name text,
  class_slug text,
  slug text,
  title text,
  content jsonb,
  version integer,
  share_mode text,
  owner_id uuid
)
language sql
security definer
set search_path = public
as $$
  select d.id, d.class_id, c.name, c.slug, d.slug, d.title, d.content, d.version,
         d.share_mode, d.user_id
  from public.documents d
  join public.classes c on c.id = d.class_id
  where d.share_token = p_token
    and d.share_mode <> 'private';
$$;

grant execute on function public.get_shared_document(uuid) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Write to a shared document by token.
--
-- Requires share_mode = 'edit' AND a signed-in caller: anonymous visitors stay
-- read-only even on an editable link. Keeps the same optimistic-concurrency
-- contract as the owner's own save path -- a stale version returns null rather
-- than overwriting newer content.
-- ----------------------------------------------------------------------------
drop function if exists public.update_shared_document(uuid, text, jsonb, text, integer);
create or replace function public.update_shared_document(
  p_token uuid,
  p_title text,
  p_content jsonb,
  p_content_text text,
  p_expected_version integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  next_version integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  update public.documents
     set title = p_title,
         content = p_content,
         content_text = p_content_text,
         version = p_expected_version + 1
   where share_token = p_token
     and share_mode = 'edit'
     and version = p_expected_version
  returning version into next_version;

  return next_version;
end;
$$;

grant execute on function public.update_shared_document(uuid, text, jsonb, text, integer)
  to authenticated;

-- ----------------------------------------------------------------------------
-- Account deletion.
--
-- Deleting a user requires privileges the browser's anon key does not have, so
-- this runs as SECURITY DEFINER and deletes only the caller's own row. Every
-- table referencing auth.users(id) does so ON DELETE CASCADE, which is what
-- removes their profile, classes, notes, versions and conversations.
--
-- Irreversible: there is no soft-delete or grace period behind this.
-- ----------------------------------------------------------------------------
drop function if exists public.delete_own_account();
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  delete from auth.users where id = auth.uid();
end;
$$;

grant execute on function public.delete_own_account() to authenticated;
