-- Image storage for notes.
--
-- Images were URL-only until now: the insert dialog took an address and the
-- editor pointed an <img> at it. That is close to useless for the thing
-- students actually do, which is paste a screenshot of a lecture slide.
--
-- ## Why the bucket is public-read
--
-- This is a real trade and worth stating rather than discovering later.
--
-- A private bucket serves files through signed URLs, which expire. The URL of
-- an image is stored *inside the document*, in the Tiptap JSON, and that
-- document is printed, exported, shared by link, and read back months later.
-- An expiring URL means every one of those breaks after a while -- a note
-- whose diagrams turn into broken images a week after it was written is worse
-- than no image support at all, and the failure arrives long after the change
-- that caused it.
--
-- So the bucket is public-read and the path is unguessable: a v4 UUID under
-- the owner's user id. The consequence, stated plainly: anyone holding the
-- full URL of an image can fetch it, whether or not they can open the note it
-- sits in. That is the same property as an unlisted link, and it is the model
-- every notes app with durable images uses. It is NOT suitable for material
-- that must be access-controlled, and nothing here should be described to a
-- user as private.
--
-- Writes are a different matter and are properly restricted: only a signed-in
-- user, only into their own prefix, and they may only replace or delete their
-- own files.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'note-images',
  'note-images',
  true,
  -- 10 MB. A phone screenshot is under 1 MB and a photo of a whiteboard is a
  -- few; well past that and the note becomes slow to open for the sake of an
  -- image nobody zoomed into.
  10485760,
  array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Reading is open, matching `public = true` above. Stated as a policy as well
-- so the intent is visible in the schema rather than only in a bucket flag.
drop policy if exists "note_images_read" on storage.objects;
create policy "note_images_read"
  on storage.objects for select
  using (bucket_id = 'note-images');

-- The first path segment is the owner's user id, which is what confines a
-- writer to their own prefix. `storage.foldername()` returns the path split on
-- '/', so element 1 is that segment.
drop policy if exists "note_images_insert_own" on storage.objects;
create policy "note_images_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'note-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "note_images_update_own" on storage.objects;
create policy "note_images_update_own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'note-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "note_images_delete_own" on storage.objects;
create policy "note_images_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'note-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
