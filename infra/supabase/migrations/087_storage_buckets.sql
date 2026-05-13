-- 087_storage_buckets.sql — Storage-Bucket-Foundation fuer D.2 + F.3.
--
-- Zwei Buckets:
--   - `avatars`         per-User, Pfad `{user_id}/{filename}`.
--                       Public-Read (Avatar wird ueberall gerendert),
--                       Owner-only-Write.
--   - `workspace-logos` per-Workspace, Pfad `{workspace_id}/{filename}`.
--                       Public-Read, Owner+Admin-Write (RLS via
--                       workspace_role_of()).
--
-- Pfad-Konvention: erstes Path-Segment ist der scope-Identifier
-- (user_id bzw. workspace_id), zweites + folgende ist der Datei-Name.
-- RLS-Policies pruefen via `(storage.foldername(name))[1]`.
--
-- File-Limits (Supabase-Default 50MB pro Bucket greift; wir koennen
-- enger schneiden, machen das aber clientseitig — Bucket-Setting hier
-- waere mit der storage-API als Service-Role-Migration aufwendiger).

-- ─── avatars ─────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152, -- 2 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ─── workspace-logos ─────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'workspace-logos',
  'workspace-logos',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ─── Policies: avatars ───────────────────────────────────────────
drop policy if exists avatars_public_read on storage.objects;
create policy avatars_public_read on storage.objects
  for select to public
  using (bucket_id = 'avatars');

drop policy if exists avatars_owner_insert on storage.objects;
create policy avatars_owner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists avatars_owner_update on storage.objects;
create policy avatars_owner_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists avatars_owner_delete on storage.objects;
create policy avatars_owner_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ─── Policies: workspace-logos ───────────────────────────────────
-- workspace_role_of() existiert seit Migration 002 als helper.
drop policy if exists workspace_logos_public_read on storage.objects;
create policy workspace_logos_public_read on storage.objects
  for select to public
  using (bucket_id = 'workspace-logos');

drop policy if exists workspace_logos_admin_insert on storage.objects;
create policy workspace_logos_admin_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'workspace-logos'
    and public.workspace_role_of(((storage.foldername(name))[1])::uuid) in ('owner', 'admin')
  );

drop policy if exists workspace_logos_admin_update on storage.objects;
create policy workspace_logos_admin_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'workspace-logos'
    and public.workspace_role_of(((storage.foldername(name))[1])::uuid) in ('owner', 'admin')
  )
  with check (
    bucket_id = 'workspace-logos'
    and public.workspace_role_of(((storage.foldername(name))[1])::uuid) in ('owner', 'admin')
  );

drop policy if exists workspace_logos_admin_delete on storage.objects;
create policy workspace_logos_admin_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'workspace-logos'
    and public.workspace_role_of(((storage.foldername(name))[1])::uuid) in ('owner', 'admin')
  );

-- ─── workspaces.logo_url + user_profiles.avatar_url ──────────────
-- Wir speichern den Public-URL als Convenience, damit Render-Stellen
-- nicht jedes Mal `getPublicUrl()` aufrufen muessen. NULL = kein Logo/
-- Avatar gesetzt.

alter table public.workspaces
  add column if not exists logo_url text;
alter table public.workspaces
  drop constraint if exists workspaces_logo_url_length_check;
alter table public.workspaces
  add constraint workspaces_logo_url_length_check
  check (logo_url is null or char_length(logo_url) <= 1024);

alter table public.user_profiles
  add column if not exists avatar_url text;
alter table public.user_profiles
  drop constraint if exists user_profiles_avatar_url_length_check;
alter table public.user_profiles
  add constraint user_profiles_avatar_url_length_check
  check (avatar_url is null or char_length(avatar_url) <= 1024);

comment on column public.workspaces.logo_url is
  'Public Storage-URL des Workspace-Logos (bucket workspace-logos). Welle F.3.';
comment on column public.user_profiles.avatar_url is
  'Public Storage-URL des User-Avatars (bucket avatars). Welle D.2.';
