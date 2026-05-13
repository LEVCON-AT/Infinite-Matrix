// Workspace-Members — Phase 1 (P1.A) + Member-Aktionen (P1.A.4).
//
// Read-Pfad ueber SECURITY DEFINER RPC `list_workspace_members`
// (Migration 011, erweitert in 013 um deactivated_at).
//
// Mutation-Pfad ueber RPCs `deactivate_member`, `reactivate_member`,
// `remove_member` (Migration 013). Synchron-online ohne safe-mutation-
// Wrapper, weil Security-Mutations explizit kein Offline-Replay haben
// duerfen (Anti-Pattern Memory feedback_saas_security_no_offline).
//
// NT.3: Read-Cache via localStorage pro Workspace. Members werden jetzt
// auch im NodeTree fuer Creator-Avatare gebraucht — ohne Cache zeigt der
// Tree offline ein leeres Avatar-Feld. localStorage statt IDB, weil die
// Liste klein ist (< 50) und der existierende offline-cache.ts ein
// id+workspace_id-Schema erwartet (Members haben user_id als PK).

import { isNetworkError } from './mutation-queue';
import { markCacheFallback } from './offline-state';
import { supabase } from './supabase';
import type { WorkspaceRole } from './types';

export type WorkspaceMember = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  // D.2-V2: Avatar-URL aus user_profiles (LEFT JOIN, Migration 088).
  // NULL = User hat keinen Avatar gesetzt → Caller faellt auf
  // email/name-Initialen oder Default-Icon zurueck.
  avatar_url: string | null;
  role: WorkspaceRole;
  joined_at: string;
  deactivated_at: string | null;
};

// Read-Cache: localStorage pro Workspace. Online-Reads schreiben durch,
// Offline-Reads lesen aus dem Cache und markieren via markCacheFallback().
const CACHE_KEY = (wsId: string) => `members-cache:${wsId}`;

function readCache(wsId: string): WorkspaceMember[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY(wsId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as WorkspaceMember[]) : null;
  } catch {
    return null;
  }
}

function writeCache(wsId: string, members: WorkspaceMember[]): void {
  try {
    localStorage.setItem(CACHE_KEY(wsId), JSON.stringify(members));
  } catch {
    // QuotaExceededError o.ae. — leise schlucken, Cache ist Bonus.
  }
}

// Live-Fetch via RPC mit Read-Cache-Fallback. Online schreibt durch,
// offline liest die zuletzt bekannte Member-Liste aus localStorage und
// markiert den Cache-Fallback-State (zeigt das Offline-Badge).
export async function fetchMembers(workspaceId: string): Promise<WorkspaceMember[]> {
  try {
    const { data, error } = await supabase.rpc('list_workspace_members', {
      p_workspace_id: workspaceId,
    });
    if (error) throw error;
    const members = (data ?? []) as WorkspaceMember[];
    writeCache(workspaceId, members);
    return members;
  } catch (err) {
    if (isNetworkError(err)) {
      const cached = readCache(workspaceId);
      if (cached) {
        markCacheFallback();
        return cached;
      }
    }
    throw err;
  }
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
