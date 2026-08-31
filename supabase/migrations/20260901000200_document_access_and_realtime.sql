-- Who may collaborate on a document, and the Realtime channel that carries it.
--
-- Sharing has always been by token: knowing the link is the credential, and
-- reads go through SECURITY DEFINER functions so the base tables can stay
-- owner-only. That works for a stateless read. It does not work for a Realtime
-- channel, because Realtime authorises a subscription with RLS on
-- realtime.messages, and RLS sees a user -- it has no idea what link they
-- followed.
--
-- So a token grant becomes a recorded fact. A signed-in visitor who opens an
-- edit link gets a row here, once, and everything afterwards -- joining the
-- document's channel, broadcasting updates, appending to the update log --
-- is authorised against that row rather than against a token in a URL.
--
-- This also makes revocation mean something. Turning sharing off previously
-- left the same secret URL working the moment it was turned back on, because
-- the token never changed. Rotating the token and clearing the grants is now
-- a real revocation, and the grants are a record of who was let in.

create table if not exists public.document_access (
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null check (mode in ('view', 'edit')),
  -- Which token let them in. Kept so rotating a token can revoke exactly the
  -- grants that came from it, rather than everyone who ever had access.
  granted_via uuid,
  granted_at timestamptz not null default now(),
  primary key (document_id, user_id)
);

create index if not exists document_access_user_idx
  on public.document_access(user_id);

alter table public.document_access enable row level security;

-- Visible to the people it concerns: the document's owner, and the grantee.
drop policy if exists "document_access_select_visible" on public.document_access;
create policy "document_access_select_visible"
  on public.document_access for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.documents d
       where d.id = document_access.document_id and d.user_id = auth.uid()
    )
  );

-- Only the owner may revoke by hand. Grants are created by the SECURITY
-- DEFINER function below, never by the client directly -- a client that could
-- insert here could grant itself access to any document.
drop policy if exists "document_access_delete_by_owner" on public.document_access;
create policy "document_access_delete_by_owner"
  on public.document_access for delete
  using (
    exists (
      select 1 from public.documents d
       where d.id = document_access.document_id and d.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- The single definition of "may this user edit this document".
--
-- Every policy below calls it, so the rule lives in one place and cannot drift
-- between the update log and the Realtime channel -- which would be the worst
-- kind of drift, since the two together are the document.
-- ---------------------------------------------------------------------------
create or replace function public.can_edit_document(p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.documents d
     where d.id = p_document_id and d.user_id = auth.uid()
  ) or exists (
    select 1 from public.document_access a
     where a.document_id = p_document_id
       and a.user_id = auth.uid()
       and a.mode = 'edit'
  );
$$;

grant execute on function public.can_edit_document(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Redeem a share token into a durable grant.
--
-- SECURITY DEFINER because the caller cannot read the documents table to check
-- the token themselves -- that is the whole point of token sharing. Requires a
-- session: an anonymous visitor stays read-only on an edit link, exactly as
-- update_shared_document already enforces.
-- ---------------------------------------------------------------------------
drop function if exists public.redeem_share_token(uuid);
create or replace function public.redeem_share_token(p_token uuid)
returns table (document_id uuid, mode text)
language plpgsql
security definer
set search_path = public
as $$
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

-- ---------------------------------------------------------------------------
-- Rotate a share link, revoking everyone it let in.
--
-- Turning sharing off and on again used to restore the identical secret URL,
-- because the token was generated once at insert and never changed. Anyone who
-- had ever seen the link still had it.
-- ---------------------------------------------------------------------------
drop function if exists public.rotate_share_token(uuid);
create or replace function public.rotate_share_token(p_document_id uuid)
returns uuid
language plpgsql
security invoker
as $$
declare
  fresh uuid := gen_random_uuid();
begin
  -- security invoker: the documents UPDATE policy is what checks ownership,
  -- so only the owner can rotate their own note's link.
  update public.documents
     set share_token = fresh
   where id = p_document_id;

  if not found then
    raise exception 'document not found or not permitted';
  end if;

  -- Grants handed out by the old link die with it. Grants made another way
  -- are left alone.
  delete from public.document_access
   where document_id = p_document_id
     and granted_via is distinct from null;

  return fresh;
end;
$$;

grant execute on function public.rotate_share_token(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The Yjs update log follows the same rule.
-- ---------------------------------------------------------------------------
drop policy if exists "document_yupdates_select" on public.document_yupdates;
create policy "document_yupdates_select"
  on public.document_yupdates for select
  using (public.can_edit_document(document_id));

drop policy if exists "document_yupdates_insert" on public.document_yupdates;
create policy "document_yupdates_insert"
  on public.document_yupdates for insert
  with check (user_id = auth.uid() and public.can_edit_document(document_id));

-- Deletes happen only through compact_document_ydoc, which runs as the caller.
drop policy if exists "document_yupdates_delete" on public.document_yupdates;
create policy "document_yupdates_delete"
  on public.document_yupdates for delete
  using (public.can_edit_document(document_id));

-- ---------------------------------------------------------------------------
-- Realtime channel authorisation.
--
-- Topic is `doc:<uuid>`. Realtime evaluates these policies against
-- realtime.messages when a client subscribes to a private channel and when it
-- broadcasts, so this is what stops someone joining a note's channel -- and
-- reading every keystroke in it -- purely by guessing its id.
--
-- The uuid is parsed out of the topic rather than trusted: a malformed topic
-- must fail the policy, not error the subscription.
-- ---------------------------------------------------------------------------
create or replace function public.realtime_document_id(p_topic text)
returns uuid
language sql
immutable
as $$
  select case
    when p_topic ~ '^doc:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then substring(p_topic from 5)::uuid
    else null
  end;
$$;

drop policy if exists "realtime_documents_read" on realtime.messages;
create policy "realtime_documents_read"
  on realtime.messages for select
  to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.can_edit_document(public.realtime_document_id(realtime.topic()))
  );

drop policy if exists "realtime_documents_write" on realtime.messages;
create policy "realtime_documents_write"
  on realtime.messages for insert
  to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.can_edit_document(public.realtime_document_id(realtime.topic()))
  );
