-- 083_workspace_description.sql — Welle F.2 Workspace-Description.
--
-- Fuegt eine optionale `description`-Spalte (Plaintext) zu workspaces hinzu.
-- Maxlaenge per CHECK-Constraint auf 500 Zeichen, Default NULL.
--
-- RLS: bestehende UPDATE-Policy auf workspaces (Migration 002) gilt analog —
-- owner+admin koennen description aendern. Kein zusaetzlicher Policy-Block
-- noetig, weil die Policy am Workspace nicht spaltenbasiert ist.
--
-- Forward-Compat: Aelterer Client liest die Spalte nicht, schreibt sie auch
-- nicht — kein Konflikt.

alter table public.workspaces
  add column if not exists description text;

alter table public.workspaces
  drop constraint if exists workspaces_description_length_check;
alter table public.workspaces
  add constraint workspaces_description_length_check
  check (description is null or char_length(description) <= 500);

comment on column public.workspaces.description is
  'Optionale Workspace-Beschreibung (max 500 chars). Welle F.2.';
