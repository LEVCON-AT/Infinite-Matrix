-- 084_workspace_default_invite_role.sql — Welle F.4 Default-Rolle pro Workspace.
--
-- Fuegt eine Default-Rolle fuer neue Einladungen an. Bisher war 'editor'
-- in InviteForm.tsx hardcoded; jetzt liest InviteForm den Wert aus dem
-- Workspace, owner+admin koennen ihn in den Settings aendern.
--
-- Erlaubte Werte: 'editor' | 'viewer'. owner und admin als Default-
-- Einladungsrolle waeren ungewoehnlich (eingeladene fremde User
-- bekommen normalerweise nicht direkt admin-Rechte) — deshalb CHECK
-- auf die beiden uebrigen Rollen. Default 'editor', Konsistenz mit
-- bisherigem hardcode.

alter table public.workspaces
  add column if not exists default_invite_role text not null default 'editor';

alter table public.workspaces
  drop constraint if exists workspaces_default_invite_role_check;
alter table public.workspaces
  add constraint workspaces_default_invite_role_check
  check (default_invite_role in ('editor', 'viewer'));

comment on column public.workspaces.default_invite_role is
  'Default-Rolle fuer neue Einladungen (editor|viewer). Welle F.4.';
