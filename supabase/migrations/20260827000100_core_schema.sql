-- Core schema: profiles, classes, documents.
--
-- Every statement here is idempotent, and that is load-bearing rather than
-- tidiness. This migration history was written after the fact, from a schema
-- that had been applied by hand to a live project, so the first run of these
-- files is against a database that already contains all of it. Each migration
-- therefore has to be a no-op when its objects exist, and only do work on a
-- database starting from empty.
--
-- All tables are RLS-enabled and scoped to auth.uid(). There is no policy
-- anywhere that grants access on any basis other than ownership; sharing is
-- handled separately, by token, through SECURITY DEFINER functions.

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
-- Not dropped before being recreated: triggers depend on it, and dropping the
-- function would take them with it.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
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

-- No INSERT policy: the row is created by the SECURITY DEFINER trigger below,
-- which runs before the new user has a session to be checked against.

-- display_name comes from raw_user_meta_data.display_name, set client-side via
-- supabase.auth.signUp({ options: { data: { display_name } } }).
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

-- ---------------------------------------------------------------------------
-- classes
-- ---------------------------------------------------------------------------
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

drop trigger if exists classes_touch_updated_at on public.classes;
create trigger classes_touch_updated_at
  before update on public.classes
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- documents
--
-- `content`      Tiptap JSON document (source of truth for the editor)
-- `content_text` plain-text extract, denormalised on every save so the AI
--                context layer never has to walk Tiptap JSON
-- `version`      optimistic-concurrency counter. Saves are conditional on the
--                version the client last read; a stale save affects 0 rows and
--                is refused rather than clobbering newer content.
-- ---------------------------------------------------------------------------
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

drop trigger if exists documents_touch_updated_at on public.documents;
create trigger documents_touch_updated_at
  before update on public.documents
  for each row execute function public.touch_updated_at();
