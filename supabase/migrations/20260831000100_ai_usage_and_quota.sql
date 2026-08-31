-- AI usage accounting and rate limiting.
--
-- The limit has to live here rather than in the edge function's memory or in
-- the client. Edge functions are horizontally scaled and cold-started, so an
-- in-process counter limits nothing; and a client-side check is a suggestion,
-- not a limit. Postgres is the only place both instances and tabs agree.
--
-- This table is also the record of what was actually sent to the model, which
-- is what makes a prompt change traceable: prompt_version and model are stored
-- per request, so "did behaviour change when we shipped v3" is a query rather
-- than a guess.

create table if not exists public.ai_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  mode text not null,
  -- Which prompt produced this. Stored, not logged: a line in a log that rolls
  -- over in seven days cannot answer a question about a regression.
  prompt_version text not null default 'unknown',
  model text not null default 'unknown',
  -- Rough size accounting. Characters rather than tokens because the function
  -- knows what it sent without asking the provider to count it.
  input_chars integer not null default 0,
  output_chars integer not null default 0,
  -- 'ok' | 'error' | 'refused'. Free text so a new outcome does not need a
  -- migration before it can be recorded.
  outcome text not null default 'ok',
  created_at timestamptz not null default now()
);

-- The rate-limit query is "this user, since a timestamp", so that is the index.
create index if not exists ai_requests_user_created_idx
  on public.ai_requests(user_id, created_at desc);

alter table public.ai_requests enable row level security;

-- Readable by the owner so the UI can show what is left. Never writable from
-- the client: rows are inserted only by claim_ai_request() below, which runs
-- as SECURITY DEFINER. A client that could insert could also not-insert.
drop policy if exists "ai_requests_select_own" on public.ai_requests;
create policy "ai_requests_select_own"
  on public.ai_requests for select using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Limits.
--
-- Sized for a student working, not for a script. A burst while someone runs
-- several actions over one paragraph is normal; hundreds per hour is not.
-- ---------------------------------------------------------------------------
create or replace function public.ai_rate_limit_per_minute() returns integer
  language sql immutable as $$ select 15 $$;

create or replace function public.ai_rate_limit_per_day() returns integer
  language sql immutable as $$ select 300 $$;

-- ---------------------------------------------------------------------------
-- Claim one request against the caller's quota.
--
-- Returns allowed=false with a reason instead of raising, so the caller can
-- turn it into a message rather than a 500. The insert and the count happen in
-- one statement's worth of work under the caller's row lock, which is close
-- enough to atomic for a limit whose purpose is to stop runaway spend rather
-- than to be exact at the boundary.
-- ---------------------------------------------------------------------------
drop function if exists public.claim_ai_request(text, uuid, text, text, integer);
create or replace function public.claim_ai_request(
  p_mode text,
  p_document_id uuid,
  p_prompt_version text,
  p_model text,
  p_input_chars integer
)
returns table (allowed boolean, reason text, request_id uuid, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  used_minute integer;
  used_day integer;
  new_id uuid;
begin
  if uid is null then
    return query select false, 'unauthorized'::text, null::uuid, 0;
    return;
  end if;

  select count(*) into used_minute
    from public.ai_requests
   where user_id = uid and created_at > now() - interval '1 minute';

  if used_minute >= public.ai_rate_limit_per_minute() then
    return query select false, 'rate_limited'::text, null::uuid, 60;
    return;
  end if;

  select count(*) into used_day
    from public.ai_requests
   where user_id = uid and created_at > now() - interval '1 day';

  if used_day >= public.ai_rate_limit_per_day() then
    return query select false, 'quota_exceeded'::text, null::uuid, 3600;
    return;
  end if;

  insert into public.ai_requests
    (user_id, document_id, mode, prompt_version, model, input_chars, outcome)
  values
    (uid, p_document_id, p_mode, p_prompt_version, p_model, p_input_chars, 'pending')
  returning id into new_id;

  return query select true, null::text, new_id, 0;
end;
$$;

grant execute on function public.claim_ai_request(text, uuid, text, text, integer)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Close a claimed request out with what actually happened.
--
-- Scoped to the caller's own rows, so a leaked request id from another account
-- cannot be used to rewrite its accounting.
-- ---------------------------------------------------------------------------
drop function if exists public.complete_ai_request(uuid, text, integer);
create or replace function public.complete_ai_request(
  p_request_id uuid,
  p_outcome text,
  p_output_chars integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  update public.ai_requests
     set outcome = p_outcome,
         output_chars = greatest(p_output_chars, 0)
   where id = p_request_id
     and user_id = auth.uid();
end;
$$;

grant execute on function public.complete_ai_request(uuid, text, integer) to authenticated;
