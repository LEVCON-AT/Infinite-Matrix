// Workspace-Lifecycle — Phase 1 (P1.B.4 + P1.B.5).
//
// Sensible Mutations am Workspace selbst: Ownership-Transfer und
// Hard-Delete. Beide werden synchron-online ausgefuehrt, KEIN
// safe-mutation-Wrapper (Memory feedback_saas_security_no_offline:
// Security-Mutations duerfen kein Offline-Replay haben).
//
// Toast-Strategie (Memory feedback_user_facing_toasts):
// - Aufrufer setzt console.error('<funktionsname>:', err) vor dem
//   showToast(translateLifecycleError(err, fallback), 'error').
// - translateLifecycleError ist endkundentauglich, kein Tech-Jargon.

import { supabase } from './supabase';

// ─── Ownership-Transfer ──────────────────────────────────────────
export type TransferOwnershipResult = {
  workspace_id: string;
  old_owner_id: string;
  new_owner_id: string;
};

export async function transferWorkspaceOwnership(
  workspaceId: string,
  newOwnerId: string,
): Promise<TransferOwnershipResult> {
  const { data, error } = await supabase.rpc('transfer_workspace_ownership', {
    p_workspace_id: workspaceId,
    p_new_owner_id: newOwnerId,
  });
  if (error) throw error;
  return data as TransferOwnershipResult;
}

// ─── Hard-Delete ─────────────────────────────────────────────────
export type DeleteWorkspaceResult = {
  workspace_id: string;
  deleted: boolean;
};

export async function deleteWorkspace(
  workspaceId: string,
  confirmName: string,
): Promise<DeleteWorkspaceResult> {
  const { data, error } = await supabase.rpc('delete_workspace', {
    p_workspace_id: workspaceId,
    p_confirm_name: confirmName,
  });
  if (error) throw error;
  return data as DeleteWorkspaceResult;
}

// ─── Fehler-Uebersetzung ─────────────────────────────────────────
export function translateLifecycleError(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = String((err as { message?: string }).message ?? '').toLowerCase();
    if (msg.includes('cannot_transfer_to_self')) {
      return 'Eigentum kann nicht an dich selbst uebertragen werden.';
    }
    if (msg.includes('member_not_found')) {
      return 'Mitglied nicht gefunden — bitte zuerst einladen.';
    }
    if (msg.includes('member_deactivated')) {
      return 'Mitglied ist deaktiviert — bitte zuerst reaktivieren.';
    }
    if (msg.includes('name_mismatch')) {
      return 'Workspace-Name stimmt nicht ueberein.';
    }
    if (msg.includes('workspace_not_found')) {
      return 'Workspace nicht gefunden — wurde er evtl. schon geloescht?';
    }
    if (msg.includes('forbidden')) {
      return 'Keine Berechtigung — nur der Eigentuemer darf das.';
    }
    if (msg.includes('unauthenticated')) {
      return 'Bitte erneut einloggen.';
    }
  }
  return fallback;
}
