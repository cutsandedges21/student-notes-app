-- Account deletion.
--
-- Deleting a user requires privileges the browser's publishable key does not
-- have, so this runs as SECURITY DEFINER and deletes only the caller's own
-- row. Every table referencing auth.users(id) does so ON DELETE CASCADE, which
-- is what removes their profile, classes, notes, versions and conversations.
--
-- Irreversible, with no soft delete and no grace period behind it. The
-- safeguards that exist are in the client: an explicit confirmation, and an
-- export offered first. A grace-period model (mark deleted, purge on a
-- schedule) is the better design and is tracked as follow-up work -- it is not
-- pretended at here.
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
