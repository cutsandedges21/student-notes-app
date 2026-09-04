-- ---------------------------------------------------------------------------
-- The read policy on documents has to satisfy two constraints at once.
--
-- 1. It must not query `documents`. A STABLE function reads the snapshot from
--    the start of the statement, so during `insert ... returning *` it cannot
--    see the row being created, returns false, and the RETURNING is refused
--    with 42501 -- which is what stopped notes being created at all.
--
-- 2. It must not query `document_access` under RLS. That table's own read
--    policy checks ownership by selecting from `documents`, so a policy on
--    `documents` that reads `document_access` directly closes a loop and
--    Postgres refuses it: "infinite recursion detected in policy for relation
--    documents".
--
-- The previous attempt fixed (1) and walked into (2).
--
-- Ownership is a column on the row being judged, so it is tested inline: no
-- query, visible the instant the row exists. Sharing genuinely lives in another
-- table, so it goes through a SECURITY DEFINER function, which runs as its
-- owner with RLS bypassed and therefore cannot re-enter any policy. Unlike
-- `can_view_document`, this one never looks at `documents`, which is what keeps
-- it usable in a policy on `documents`.
-- ---------------------------------------------------------------------------

create or replace function public.document_shared_with_me(p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.document_access a
     where a.document_id = p_document_id
       and a.user_id = auth.uid()
  );
$$;

grant execute on function public.document_shared_with_me(uuid) to authenticated;

drop policy if exists "documents_select_own" on public.documents;
drop policy if exists "documents_select_shared" on public.documents;

create policy "documents_select_shared"
  on public.documents for select
  using (
    user_id = auth.uid()
    or public.document_shared_with_me(id)
  );
