-- redeem_share_token has never once succeeded.
--
-- It is declared `returns table (document_id uuid, mode text)`, and in
-- PL/pgSQL those output columns are also variables in the function body. So
-- `on conflict (document_id, user_id)` is ambiguous -- Postgres cannot tell
-- the OUT variable from the column -- and every call raised 42702:
--
--   column reference "document_id" is ambiguous
--
-- Nothing recorded a grant, so document_access stayed empty, so RLS on
-- documents denied collaborators, Realtime refused them the note's channel,
-- and can_view_document said no to their comments. Every symptom of "sharing
-- for editing doesn't work" traces back to this one line.
--
-- It went unnoticed because the page that called it treated a failed
-- redemption as non-fatal and logged it to a console nobody had open. The
-- client half of that is fixed separately; this is the cause.
--
-- `#variable_conflict use_column` is the documented PL/pgSQL answer: where a
-- name could be either, prefer the column. Nothing in this body wants the
-- variable -- `doc` is a record and is always qualified, and `p_token` is not
-- a column anywhere -- so preferring columns is unambiguously right here.
--
-- The signature is unchanged on purpose. Renaming the output columns would fix
-- it too, but it would rename them in the RPC's JSON as well, and a caller
-- reading `document_id` would then get undefined rather than an error.

create or replace function public.redeem_share_token(p_token uuid)
returns table (document_id uuid, mode text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  doc record;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select d.id, d.share_mode, d.user_id
    into doc
    from public.documents d
   where d.share_token = p_token
     and d.share_mode <> 'private';

  -- Unknown token and sharing-off are the same answer, so a wrong guess
  -- cannot be told apart from a private document.
  if doc is null then
    return;
  end if;

  -- The owner needs no grant; they already have one by ownership.
  if doc.user_id = auth.uid() then
    return query select doc.id, 'edit'::text;
    return;
  end if;

  insert into public.document_access (document_id, user_id, mode, granted_via)
  values (doc.id, auth.uid(), doc.share_mode, p_token)
  on conflict (document_id, user_id) do update
    -- A link that has since been downgraded to view-only downgrades the grant.
    set mode = excluded.mode,
        granted_via = excluded.granted_via;

  return query select doc.id, doc.share_mode;
end;
$$;

grant execute on function public.redeem_share_token(uuid) to authenticated;
