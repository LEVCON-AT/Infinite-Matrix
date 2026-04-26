// Workspace-Members — Phase 1 (P1.A) + Member-Aktionen (P1.A.4).
//
// Read-Pfad ueber SECURITY DEFINER RPC `list_workspace_members`
// (Migration 011, erweitert in 013 um deactivated_at).
//
// Mutation-Pfad ueber RPCs `deactivate_member`, `reactivate_member`,
// `remove_member` (Migration 013). Synchron-online ohne safe-mutation-
// Wrapper, weil Security-Mutations explizit kein Offline-Replay haben
// duerfen (Anti-Pattern Memory feedback_saas_security_no_offline).

import { supabase } from './supabase';
import type { WorkspaceRole } from './types';

export type WorkspaceMember = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  role: WorkspaceRole;
  joined_at: string;
  deactivated_at: string | null;
};

// Live-Fetch via RPC. Kein IDB-Cache — die Liste ist klein, der Read
// laeuft selten (nur auf der Settings-Members-Page), und wir wollen
// hier den live-Zustand sehen, nicht moeglicherweise stale Daten.
export async function fetchMembers(workspaceId: string): Promise<WorkspaceMember[]> {
  const { data, error } = await supabase.rpc('list_workspace_members', {
    p_workspace_id: workspaceId,
  });
  if (error) throw error;
  return (data ?? []) as WorkspaceMember[];
}

// ─── Member-Aktionen ─────────────────────────────────────────────
export type DeactivateResult = {
  workspace_id: string;
  user_id: string;
  changed: boolean;
  previous_state: 'active' | 'deactivated';
};

export async function deactivateMember(
  workspaceId: string,
  userId: string,
): Promise<DeactivateResult> {
  const { data, error } = await supabase.rpc('deactivate_member', {
    p_workspace_id: workspaceId,
    p_user_id: userId,
  });
  if (error) throw error;
  return data as DeactivateResult;
}

export async function reactivateMember(
  workspaceId: string,
  userId: string,
): Promise<DeactivateResult> {
  const { data, error } = await supabase.rpc('reactivate_member', {
    p_workspace_id: workspaceId,
    p_user_id: userId,
  });
  if (error) throw error;
  return data as DeactivateResult;
}

export type RemoveResult = {
  workspace_id: string;
  user_id: string;
  removed_role: WorkspaceRole;
};

export async function removeMember(workspaceId: string, userId: string): Promise<RemoveResult> {
  const { data, error } = await supabase.rpc('remove_member', {
    p_workspace_id: workspaceId,
    p_user_id: userId,
  });
  if (error) throw error;
  return data as RemoveResult;
}

// ─── Rolle aendern (P1.B.1) ──────────────────────────────────────
export type ChangeRoleResult = {
  workspace_id: string;
  user_id: string;
  old_role: WorkspaceRole;
  new_role: WorkspaceRole;
  changed: boolean;
};

export async function changeMemberRole(
  workspaceId: string,
  userId: string,
  newRole: WorkspaceRole,
): Promise<ChangeRoleResult> {
  const { data, error } = await supabase.rpc('change_member_role', {
    p_workspace_id: workspaceId,
    p_user_id: userId,
    p_new_role: newRole,
  });
  if (error) throw error;
  return data as ChangeRoleResult;
}

// ─── Fehler-Uebersetzung ─────────────────────────────────────────
export function translateMemberError(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = String((err as { message?: string }).message ?? '').toLowerCase();
    if (msg.includes('cannot_deactivate_self')) {
      return 'Du kannst dich nicht selbst deaktivieren.';
    }
    if (msg.includes('cannot_remove_self')) {
      return 'Du kannst dich nicht selbst entfernen — uebertrage zuerst die Eigentuemerschaft.';
    }
    if (msg.includes('cannot_deactivate_last_owner') || msg.includes('cannot_remove_last_owner')) {
      return 'Letzter aktiver Owner kann nicht entfernt oder deaktiviert werden.';
    }
    if (msg.includes('cannot_demote_last_owner')) {
      return 'Letzter aktiver Owner kann nicht zu einer anderen Rolle geaendert werden.';
    }
    if (msg.includes('admin_cannot_set_owner_or_admin')) {
      return 'Als Admin kannst du nur zwischen Editor und Viewer wechseln.';
    }
    if (msg.includes('member_deactivated')) {
      return 'Mitglied ist deaktiviert — bitte erst reaktivieren.';
    }
    if (msg.includes('member_not_found')) {
      return 'Mitglied wurde nicht gefunden.';
    }
    if (msg.includes('forbidden')) {
      return 'Keine Berechtigung — owner oder admin erforderlich.';
    }
    if (msg.includes('unauthenticated')) {
      return 'Bitte erneut einloggen.';
    }
  }
  return fallback;
}

// Anzeige-Helfer: wenn display_name leer ist, das @-Prefix der Email
// nehmen; wenn auch das fehlt, die ersten 8 Zeichen der user_id.
export function memberDisplayLabel(m: WorkspaceMember): string {
  if (m.display_name?.trim()) return m.display_name.trim();
  if (m.email) return m.email.split('@')[0] ?? m.email;
  return m.user_id.slice(0, 8);
}
