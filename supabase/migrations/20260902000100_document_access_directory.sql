-- Naming the people a share link let in.
--
-- document_access answers "who has access" with a user id, and the owner can
-- already read those rows: document_access_select_visible covers them. What
-- the owner cannot read is who those ids belong to. profiles_select_own is
-- `using (id = auth.uid())` -- deliberately, since a project-wide readable
-- profile table is a user directory anyone can scrape -- so a join from the
-- client comes back empty and the access list can only render raw uuids.
--
-- A list of uuids is not a list of people. Revoking someone by hand means
-- recognising them first, so the owner needs a name next to the row or the
-- revoke button is a guess.
--
-- Hence this: a SECURITY DEFINER function that reads profiles on the owner's
-- behalf, returns display_name and nothing else -- no email, no id beyond the
-- one the owner can already see -- and returns nothing at all unless the
-- caller owns the document. Narrowest thing that makes the list usable, rather
-- than loosening the profiles policy for everyone.

drop function if exists public.list_document_access(uuid);
create or replace function public.list_document_access(p_document_id uuid)
returns table (
  user_id uuid,
  display_name text,
  mode text,
  granted_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select a.user_id,
         -- Signing up without a display name is allowed (the column defaults
         -- to ''), so the list needs something to render either way.
         coalesce(nullif(p.display_name, ''), 'Someone with the link'),
         a.mode,
         a.granted_at
    from public.document_access a
    left join public.profiles p on p.id = a.user_id
   where a.document_id = p_document_id
     -- The whole authorisation check. A non-owner gets an empty result rather
     -- than an error, so this cannot be used to probe which ids are documents.
     and exists (
       select 1 from public.documents d
        where d.id = p_document_id
          and d.user_id = auth.uid()
     )
   order by a.granted_at asc, a.user_id asc;
$$;

grant execute on function public.list_document_access(uuid) to authenticated;
