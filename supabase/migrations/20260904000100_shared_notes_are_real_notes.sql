-- Collaborators get the note, not a view of it.
--
-- `documents` was readable and writable only by its owner. Everyone else went
-- through token-based SECURITY DEFINER functions, which meant a shared note
-- could only be opened by a second, lesser editor page with its own save path,
-- its own version handling and none of the chrome. Live editing, comments and
-- carets all assume one document that both people can actually address, so
-- none of them worked for the person the note was shared with.
--
-- The grant already exists: redeem_share_token writes a document_access row
-- when somebody opens a share link. It simply did not grant access to the
-- document itself. This makes it mean what it says.
--
-- Recursion is not a risk here even though these policies sit on `documents`
-- and the helpers query `documents`: both helpers are SECURITY DEFINER, so
-- they run as their owner with RLS bypassed rather than re-entering the policy.

-- ---------------------------------------------------------------------------
-- documents
-- ---------------------------------------------------------------------------
drop policy if exists "documents_select_own" on public.documents;
drop policy if exists "documents_select_shared" on public.documents;
create policy "documents_select_shared"
  on public.documents for select
  using (public.can_view_document(id));

drop policy if exists "documents_update_own" on public.documents;
drop policy if exists "documents_update_shared" on public.documents;
create policy "documents_update_shared"
  on public.documents for update
  using (public.can_edit_document(id))
  with check (public.can_edit_document(id));

-- Insert and delete stay owner-only, deliberately. A share link lets somebody
-- work on a note; it does not let them destroy it, and it does not let them
-- create notes in somebody else's account.

-- ---------------------------------------------------------------------------
-- classes
-- ---------------------------------------------------------------------------
-- A collaborator needs to know which course a note belongs to in order to
-- label it. They get exactly that -- the row for a class containing a note
-- they already have access to -- and nothing else: no listing, no other
-- classes, no write of any kind.
drop policy if exists "classes_select_own" on public.classes;
drop policy if exists "classes_select_visible" on public.classes;
create policy "classes_select_visible"
  on public.classes for select
  using (
    user_id = auth.uid()
    or exists (
      select 1
        from public.documents d
        join public.document_access a on a.document_id = d.id
       where d.class_id = classes.id
         and a.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Notes shared with me
-- ---------------------------------------------------------------------------
-- The list behind "Shared with me". Runs as SECURITY DEFINER only to read the
-- owner's display name, which profiles otherwise keeps private; every row it
-- returns is one the caller could already select for themselves.
drop function if exists public.list_shared_documents();
create or replace function public.list_shared_documents()
returns table (
  id uuid,
  title text,
  slug text,
  owner_name text,
  mode text,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select d.id,
         d.title,
         d.slug,
         coalesce(nullif(p.display_name, ''), 'Someone'),
         a.mode,
         d.updated_at
    from public.document_access a
    join public.documents d on d.id = a.document_id
    left join public.profiles p on p.id = d.user_id
   where a.user_id = auth.uid()
     and d.user_id <> auth.uid()
   order by d.updated_at desc;
$$;

grant execute on function public.list_shared_documents() to authenticated;
