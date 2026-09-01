-- Comments.
--
-- Two tables rather than one, because a comment and a conversation are not the
-- same thing. A thread is anchored to a passage and can be resolved; the
-- comments inside it are just messages. Flattening them would mean either
-- storing the anchor on every reply or losing the ability to reply at all.
--
-- The anchor is stored as JSON rather than as a pair of integers. A position is
-- an offset into a document that stops existing the moment anyone types above
-- it, and with collaboration two people are typing above it at once. See
-- src/comments/anchor.ts: the anchor carries a Yjs relative position, the
-- quoted text, and the text either side of it, and resolution tries them in
-- that order before admitting the thread is orphaned.

-- ---------------------------------------------------------------------------
-- The single definition of "may this user see this document".
--
-- Mirrors can_edit_document, which already exists. Viewers can read and post
-- comments: commenting does not modify the note, and a study group reading a
-- shared set of notes is exactly who comments are for. Editing is a separate
-- question and keeps its own rule.
-- ---------------------------------------------------------------------------
create or replace function public.can_view_document(p_document_id uuid)
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
  );
$$;

grant execute on function public.can_view_document(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Threads
-- ---------------------------------------------------------------------------
create table if not exists public.comment_threads (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  -- A CommentAnchor. Opaque to Postgres on purpose: what makes an anchor
  -- resolvable is editor knowledge, and encoding that as columns here would
  -- put half the algorithm in SQL and half in TypeScript.
  anchor jsonb not null,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- The sidebar asks for one document's threads, unresolved first, oldest first.
create index if not exists comment_threads_document_idx
  on public.comment_threads(document_id, resolved_at, created_at);

alter table public.comment_threads enable row level security;

drop policy if exists "comment_threads_select" on public.comment_threads;
create policy "comment_threads_select"
  on public.comment_threads for select
  using (public.can_view_document(document_id));

drop policy if exists "comment_threads_insert" on public.comment_threads;
create policy "comment_threads_insert"
  on public.comment_threads for insert
  with check (author_id = auth.uid() and public.can_view_document(document_id));

-- Resolving and reopening is collaborative triage, so anyone who can see the
-- document may do it. The UPDATE policy deliberately does not restrict which
-- columns change; there is nothing else on this row worth protecting, and the
-- anchor is written once at creation.
drop policy if exists "comment_threads_update" on public.comment_threads;
create policy "comment_threads_update"
  on public.comment_threads for update
  using (public.can_view_document(document_id))
  with check (public.can_view_document(document_id));

-- Deleting a thread destroys other people's replies with it, so it is limited
-- to the person who started it and the person who owns the note.
drop policy if exists "comment_threads_delete" on public.comment_threads;
create policy "comment_threads_delete"
  on public.comment_threads for delete
  using (
    author_id = auth.uid()
    or exists (
      select 1 from public.documents d
       where d.id = comment_threads.document_id and d.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.comment_threads(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (length(trim(body)) > 0 and length(body) <= 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists comments_thread_created_idx
  on public.comments(thread_id, created_at);

alter table public.comments enable row level security;

/*
 * Visibility follows the thread, which follows the document. Written as a
 * join rather than duplicating document_id onto this table: a denormalised
 * copy would be a second source of truth for who can read a reply, and the
 * two could disagree.
 */
drop policy if exists "comments_select" on public.comments;
create policy "comments_select"
  on public.comments for select
  using (
    exists (
      select 1 from public.comment_threads t
       where t.id = comments.thread_id and public.can_view_document(t.document_id)
    )
  );

drop policy if exists "comments_insert" on public.comments;
create policy "comments_insert"
  on public.comments for insert
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.comment_threads t
       where t.id = comments.thread_id and public.can_view_document(t.document_id)
    )
  );

-- Only the author may change or remove what they wrote. The document's owner
-- can delete the whole thread, but cannot edit somebody else's words into
-- something they did not say.
drop policy if exists "comments_update_own" on public.comments;
create policy "comments_update_own"
  on public.comments for update
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

drop policy if exists "comments_delete_own" on public.comments;
create policy "comments_delete_own"
  on public.comments for delete
  using (author_id = auth.uid());

drop trigger if exists comments_touch_updated_at on public.comments;
create trigger comments_touch_updated_at
  before update on public.comments
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Threads with their author's display name and reply count.
--
-- The sidebar needs a name against every comment, and profiles is readable
-- only by its owner -- so a plain join returns nulls for everyone else. This
-- runs as SECURITY DEFINER to read names, and is gated on can_view_document so
-- it cannot be used to enumerate anybody.
-- ---------------------------------------------------------------------------
drop function if exists public.list_comment_threads(uuid);
create or replace function public.list_comment_threads(p_document_id uuid)
returns table (
  id uuid,
  author_id uuid,
  author_name text,
  anchor jsonb,
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz,
  reply_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  select t.id,
         t.author_id,
         coalesce(nullif(p.display_name, ''), 'Someone'),
         t.anchor,
         t.resolved_at,
         t.resolved_by,
         t.created_at,
         (select count(*)::integer from public.comments c where c.thread_id = t.id)
    from public.comment_threads t
    left join public.profiles p on p.id = t.author_id
   where t.document_id = p_document_id
     and public.can_view_document(p_document_id)
   order by t.resolved_at nulls first, t.created_at;
$$;

grant execute on function public.list_comment_threads(uuid) to authenticated;

-- Same reasoning: the replies, with names attached.
drop function if exists public.list_comments(uuid);
create or replace function public.list_comments(p_document_id uuid)
returns table (
  id uuid,
  thread_id uuid,
  author_id uuid,
  author_name text,
  body text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id,
         c.thread_id,
         c.author_id,
         coalesce(nullif(p.display_name, ''), 'Someone'),
         c.body,
         c.created_at,
         c.updated_at
    from public.comments c
    join public.comment_threads t on t.id = c.thread_id
    left join public.profiles p on p.id = c.author_id
   where t.document_id = p_document_id
     and public.can_view_document(p_document_id)
   order by c.created_at;
$$;

grant execute on function public.list_comments(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Live updates.
--
-- The document already syncs in real time, so a comment that only appeared on
-- reload would be conspicuous -- two people editing together, one of them
-- talking into a panel the other cannot see until they refresh.
--
-- Row-level security still applies to replicated rows, so this publishes the
-- change events, not the ability to read them: a subscriber is told about a
-- thread only if `comment_threads_select` would have let them read it anyway.
--
-- Wrapped in a guard because `alter publication ... add table` has no
-- if-not-exists form and errors on a table that is already published, which
-- would break re-running this migration.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'comment_threads'
  ) then
    alter publication supabase_realtime add table public.comment_threads;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'comments'
  ) then
    alter publication supabase_realtime add table public.comments;
  end if;
exception
  -- A project without the supabase_realtime publication is a valid local
  -- setup; comments simply do not stream there. Not worth failing the whole
  -- migration -- and therefore the schema -- over.
  when undefined_object then
    raise notice 'supabase_realtime publication not present; comments will not stream';
end
$$;
