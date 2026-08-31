-- Slugs, for readable links.
--
-- Presentation only. Rows are keyed by id everywhere internally, and since the
-- move to id-addressed note URLs the slug is decoration in the address bar
-- too: it may be stale and the note still resolves. Unique per scope so a link
-- is unambiguous -- a class slug within a user, a note slug within a class.
--
-- Written as add-nullable, backfill, then set not null: adding a not-null
-- column with no default to a table that already has rows would fail outright,
-- and there is no sensible default because the value is derived per row.

alter table public.classes add column if not exists slug text;
alter table public.documents add column if not exists slug text;

-- The expression mirrors the client's slugify for the latin case: lowercase,
-- runs of non-alphanumerics to a single hyphen, trimmed. Anything that reduces
-- to nothing becomes 'untitled', and repeats within a scope get a counter,
-- matching uniqueSlug(). Only rows with a null slug are touched, so re-running
-- cannot renumber slugs that already exist and are already linked to.
with numbered as (
  select
    id,
    case
      when row_number() over (partition by user_id, base order by created_at) = 1
        then base
      else base || '-' ||
           row_number() over (partition by user_id, base order by created_at)
    end as new_slug
  from (
    select id, user_id, created_at,
           coalesce(
             nullif(trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')), ''),
             'untitled'
           ) as base
    from public.classes
    where slug is null
  ) s
)
update public.classes c set slug = n.new_slug from numbered n where n.id = c.id;

with numbered as (
  select
    id,
    case
      when row_number() over (partition by class_id, base order by created_at) = 1
        then base
      else base || '-' ||
           row_number() over (partition by class_id, base order by created_at)
    end as new_slug
  from (
    select id, class_id, created_at,
           coalesce(
             nullif(trim(both '-' from regexp_replace(lower(title), '[^a-z0-9]+', '-', 'g')), ''),
             'untitled'
           ) as base
    from public.documents
    where slug is null
  ) s
)
update public.documents d set slug = n.new_slug from numbered n where n.id = d.id;

-- Any row still without a slug -- inserted between the statements above, or
-- carrying a title the expression could not reduce -- falls back to its id,
-- which is unique by construction. Guarantees the not-null below can be taken.
update public.classes set slug = id::text where slug is null;
update public.documents set slug = id::text where slug is null;

alter table public.classes alter column slug set not null;
alter table public.documents alter column slug set not null;

create unique index if not exists classes_user_slug_idx on public.classes(user_id, slug);
create unique index if not exists documents_class_slug_idx on public.documents(class_id, slug);
