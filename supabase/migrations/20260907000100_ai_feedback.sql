-- What the student thought of an answer.
--
-- Separate from the conversation, deliberately: a rating is about a model's
-- output, not about the note, and mixing them would mean deleting a
-- conversation destroyed the record of what was wrong with it.
--
-- ## Who reads this
--
-- Worth writing down, because a feedback table nobody reads is telemetry
-- theatre and this programme has spent its time removing that kind of thing.
--
-- The reader is the eval suite. `supabase/functions/ai-assist/evals/cases.ts`
-- is a hand-written list of behaviours the assistant must hold, and the honest
-- limitation of hand-written cases is that they cover the failures somebody
-- thought of. A thumbs-down is a failure a student actually hit, with the mode
-- and the prompt version attached -- which is exactly the shape of a new case.
--
-- The path is: read the rows, find a pattern, write a case, run the evals.
-- Manual on purpose. Nothing here feeds back into the model automatically, and
-- the UI does not suggest it does.
create table if not exists public.ai_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- The turn being rated. Nullable and ON DELETE SET NULL: clearing a
  -- conversation should not erase the record that an answer was wrong.
  message_id uuid references public.messages(id) on delete set null,
  document_id uuid references public.documents(id) on delete set null,
  rating text not null check (rating in ('up', 'down')),
  -- Optional, and free text: "why" is the part a rating cannot carry.
  note text,
  -- Recorded against the answer rather than looked up later, because both can
  -- change and the question is always "what was it doing at the time".
  mode text not null default 'CHAT',
  prompt_version text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists ai_feedback_rating_created_idx
  on public.ai_feedback(rating, created_at desc);

alter table public.ai_feedback enable row level security;

-- Insert and read your own. No update and no delete policy: a rating is a
-- record of what happened, and one that can be edited afterwards is not.
drop policy if exists "ai_feedback_insert_own" on public.ai_feedback;
create policy "ai_feedback_insert_own"
  on public.ai_feedback for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "ai_feedback_select_own" on public.ai_feedback;
create policy "ai_feedback_select_own"
  on public.ai_feedback for select using (user_id = auth.uid());
