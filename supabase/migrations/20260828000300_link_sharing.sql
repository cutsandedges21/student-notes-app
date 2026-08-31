-- Link sharing.
--
-- Token-based, NOT policy-based, and the distinction is the whole security
-- argument for this file.
--
-- The obvious approach -- an RLS policy like `using (share_mode <> 'private')`
-- -- would let anyone run `GET /documents?share_mode=eq.view` and enumerate
-- every shared document in the project. Access therefore goes through
-- SECURITY DEFINER functions that require the caller to already know an
-- unguessable token, and the base tables keep their owner-only policies
-- untouched. Knowing the link is the credential.

alter table public.documents
  add column if not exists share_mode text not null default 'private';

alter table public.documents drop constraint if exists documents_share_mode_check;
alter table public.documents
  add constraint documents_share_mode_check
  check (share_mode in ('private', 'view', 'edit'));

alter table public.documents
  add column if not exists share_token uuid not null default gen_random_uuid();

create unique index if not exists documents_share_token_idx
  on public.documents(share_token);

-- ---------------------------------------------------------------------------
-- Read a shared document by token.
--
-- Returns nothing when the token is unknown or sharing is off, so a wrong
-- guess is indistinguishable from a private document: no oracle.
--
-- Dropped before being recreated because `create or replace function` cannot
-- change a return type, and this one's shape has moved before.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Write to a shared document by token.
--
-- Requires share_mode = 'edit' AND a signed-in caller: anonymous visitors stay
-- read-only even on an editable link, and that is enforced here rather than
-- only in the UI. Keeps the same optimistic-concurrency contract as the
-- owner's own save path -- a stale version returns null rather than
-- overwriting newer content, and the client turns that into a choice between
-- the two versions rather than discarding one.
-- ---------------------------------------------------------------------------
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
