-- 086_log_account_event_rpc.sql — Welle B.4 Audit-Coverage Auth-Events.
--
-- Bisher loggt system_audit_log (Migration 039) nur workspace.deleted.
-- B.4 erweitert das auf Auth-Events: password_changed, email_change_
-- requested, mfa_enrolled, mfa_unenrolled, session_revoked,
-- account_deleted.
--
-- Pattern: ein SECURITY DEFINER RPC `log_account_event(action, payload)`,
-- whitelist-streng auf die erlaubten Actions. Authenticated User darf
-- nur eigene Events loggen (actor_id = auth.uid()), workspace_id bleibt
-- NULL (Auth-Events sind workspace-unabhaengig).
--
-- WARUM nicht Auth-Webhooks: Supabase-Auth-Webhooks brauchen Pro-Plan
-- + externen HTTP-Endpoint. Client-Side-Log nach Success ist V1-pragma-
-- tisch — bricht zwar bei sehr boswilligen Clients (kein Audit-Eintrag),
-- aber Server-Side-Validation der Auth-Mutation bleibt der primaere
-- Schutz. Der Audit dient der nachvollziehbaren Inspektion durch
-- platform_admins, nicht der Sicherheits-Gate.

create or replace function public.log_account_event(
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'unauthenticated' using errcode = 'insufficient_privilege';
  end if;

  -- Whitelist erlaubter Actions. Andere Strings raisen — verhindert
  -- dass ein boswilliger Client den Log mit Garbage flutet.
  if p_action not in (
    'password_changed',
    'email_change_requested',
    'mfa_enrolled',
    'mfa_unenrolled',
    'session_revoked',
    'account_deleted',
    'display_name_changed'
  ) then
    raise exception 'invalid_action: %', p_action using errcode = 'check_violation';
  end if;

  -- Payload-Size-Limit gegen Log-Spam.
  if octet_length(p_payload::text) > 4096 then
    raise exception 'payload_too_large' using errcode = 'check_violation';
  end if;

  insert into public.system_audit_log (action, actor_id, workspace_id, workspace_name, payload)
  values (
    'account.' || p_action,
    v_actor,
    null,
    null,
    coalesce(p_payload, '{}'::jsonb)
  );
end$$;

revoke all on function public.log_account_event(text, jsonb) from public;
grant execute on function public.log_account_event(text, jsonb) to authenticated;

comment on function public.log_account_event(text, jsonb) is
  'Auth-Event-Audit-Log V1 (Welle B.4). Whitelist-streng; actor_id=auth.uid().';
