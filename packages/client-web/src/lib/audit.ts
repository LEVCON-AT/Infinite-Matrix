// Workspace-Audit-Log — Phase 1 (P1.A).
//
// Read-only fuer den Settings/Audit-Tab. RLS gibt die Rows nur an
// admin/owner zurueck (workspace_audit_log_select_admin-Policy aus
// Migration 011). Kein IDB-Cache — Audit-Trail soll authoritativ live
// sein, nicht ein moeglicherweise-stale Snapshot. Wenn das Netz weg
// ist, bekommt der User einen leeren Tab + Toast — das ist ehrlicher
// als veraltete Daten.

import { supabase } from './supabase';

// Action-Typen, die Migration 011 in workspace_audit_log.action ablegt.
// P1.B erweitert die Liste um member.role_changed + member.removed.
export type AuditAction =
  | 'invite.created'
  | 'invite.accepted'
  | 'invite.revoked'
  | 'member.role_changed'
  | 'member.removed';

export type AuditEntry = {
  id: string;
  workspace_id: string;
  actor_id: string | null;
  action: AuditAction | string;
  target_user_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export type AuditFilter = {
  // Filter optional — leerer Filter = alle Actions.
  actions?: ReadonlyArray<AuditAction>;
  // Optionaler Zeitraum (ISO-Strings, exklusive Grenzen).
  since?: string;
  until?: string;
};

// Default-Limit hoch genug, dass eine durchschnittliche Workspace-
// Historie auf einen Bildschirm passt — laut Plan-Phase-1 unbegrenzt
// behalten, Pagination ist Phase-1.5.
const DEFAULT_LIMIT = 200;

export async function fetchAuditLog(
  workspaceId: string,
  filter: AuditFilter = {},
  limit: number = DEFAULT_LIMIT,
): Promise<AuditEntry[]> {
  let query = supabase
    .from('workspace_audit_log')
    .select('id, workspace_id, actor_id, action, target_user_id, payload, created_at')
    // RLS erlaubt admin/owner workspace-weit. Wir filtern trotzdem
    // explizit (Memory feedback_rls_select_filter — RLS gibt
    // Berechtigung, nicht Scope).
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (filter.actions && filter.actions.length > 0) {
    query = query.in('action', filter.actions as unknown as string[]);
  }
  if (filter.since) query = query.gt('created_at', filter.since);
  if (filter.until) query = query.lt('created_at', filter.until);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as AuditEntry[];
}

// Lokalisations-Helfer fuer die UI. Bewusst kein i18n-Frame — wir
// haben Phase 1 deutsch-only.
export function describeAuditAction(action: string): string {
  switch (action) {
    case 'invite.created':
      return 'Einladung erstellt';
    case 'invite.accepted':
      return 'Einladung angenommen';
    case 'invite.revoked':
      return 'Einladung widerrufen';
    case 'member.role_changed':
      return 'Rolle geaendert';
    case 'member.removed':
      return 'Mitglied entfernt';
    default:
      return action;
  }
}
