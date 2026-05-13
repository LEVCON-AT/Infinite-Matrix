// Account-Event-Audit-Log Client (Welle B.4).
//
// Duenne Schicht ueber dem `log_account_event`-RPC aus Migration 086.
// Wird von den Auth-Mutations aufgerufen NACH erfolgreichem Server-Call.
// Failure wird geschluckt + console.error — der Audit-Eintrag ist
// Bonus-Forensik, nicht security-blocking; die eigentliche Auth-Mutation
// war ja erfolgreich.
//
// Whitelist muss zwischen RPC und Client synchron bleiben (Schema-Quad).

import { supabase } from './supabase';

export type AccountAuditAction =
  | 'password_changed'
  | 'email_change_requested'
  | 'mfa_enrolled'
  | 'mfa_unenrolled'
  | 'session_revoked'
  | 'account_deleted'
  | 'display_name_changed';

export async function logAccountEvent(
  action: AccountAuditAction,
  payload: Record<string, unknown> = {},
): Promise<void> {
  try {
    const { error } = await supabase.rpc('log_account_event', {
      p_action: action,
      p_payload: payload,
    });
    if (error) {
      console.error(`logAccountEvent(${action}):`, error);
    }
  } catch (err) {
    // Fire-and-forget — Audit-Eintrag darf den eigentlichen Auth-Pfad
    // nicht blocken. Loggen, aber nicht werfen.
    console.error(`logAccountEvent(${action}):`, err);
  }
}
