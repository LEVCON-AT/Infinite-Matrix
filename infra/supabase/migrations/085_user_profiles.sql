-- 085_user_profiles.sql — Welle D.3 User-Profile Foundation.
--
-- Per-User-Profil-Metadaten (Bio, Timezone, Language). user_id ist
-- gleichzeitig PK + FK auf auth.users.id — pro User max. eine Row.
-- Optional: alle Felder duerfen NULL sein (lazy-create beim ersten
-- Update).
--
-- RLS: jeder User darf nur die eigene Row lesen + updaten.
--
-- D.3-Folge-Spints werden `timezone` in Recur-Expansion-Pipelines und
-- `language` in i18n-Lookup verwenden; D.3-V1 ist nur Storage + UI.

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  bio text,
  timezone text,
  language text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Length-Constraints (Stoperei; UI validiert zusaetzlich).
alter table public.user_profiles
  drop constraint if exists user_profiles_bio_length_check;
alter table public.user_profiles
  add constraint user_profiles_bio_length_check
  check (bio is null or char_length(bio) <= 500);

alter table public.user_profiles
  drop constraint if exists user_profiles_timezone_length_check;
alter table public.user_profiles
  add constraint user_profiles_timezone_length_check
  check (timezone is null or char_length(timezone) <= 64);

-- Language: ISO-639-1 / BCP 47 — 2-12 chars (de, en, de-DE, zh-Hant-TW).
alter table public.user_profiles
  drop constraint if exists user_profiles_language_format_check;
alter table public.user_profiles
  add constraint user_profiles_language_format_check
  check (language is null or language ~ '^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$');

-- updated_at-Trigger (Pattern wie andere Tabellen).
create or replace function public._user_profiles_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end$$;

drop trigger if exists user_profiles_set_updated_at on public.user_profiles;
create trigger user_profiles_set_updated_at
  before update on public.user_profiles
  for each row execute function public._user_profiles_set_updated_at();

-- RLS aktivieren + Policies.
alter table public.user_profiles enable row level security;
alter table public.user_profiles force row level security;

drop policy if exists user_profiles_select_self on public.user_profiles;
create policy user_profiles_select_self on public.user_profiles
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists user_profiles_insert_self on public.user_profiles;
create policy user_profiles_insert_self on public.user_profiles
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists user_profiles_update_self on public.user_profiles;
create policy user_profiles_update_self on public.user_profiles
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

comment on table public.user_profiles is
  'Per-User Profile-Daten (Bio/Timezone/Language). Welle D.3.';
