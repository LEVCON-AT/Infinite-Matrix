// Workspace-Lifecycle — Phase 1 (P1.B.4 + P1.B.5) + Welle F.1 (Rename).
//
// Sensible Mutations am Workspace selbst: Ownership-Transfer und
// Hard-Delete. Beide werden synchron-online ausgefuehrt, KEIN
// safe-mutation-Wrapper (Memory feedback_saas_security_no_offline:
// Security-Mutations duerfen kein Offline-Replay haben).
//
// Welle F.1 — `renameWorkspace`: Workspace-Stammdaten-Edit ist
// nicht security-kritisch wie Ownership/Delete, laeuft aber konsistent
// zu den anderen Workspace-Mutations ebenfalls sync-online (keine
// Offline-Pfade fuer Workspace-Metadaten — bei Konflikten zwischen
// Mehrgeraet-Workflows ist „Last Writer Wins online" sauber).
//
// Toast-Strategie (Memory feedback_user_facing_toasts):
// - Aufrufer setzt console.error('<funktionsname>:', err) vor dem
//   showToast(translateLifecycleError(err, fallback), 'error').
// - translateLifecycleError ist endkundentauglich, kein Tech-Jargon.

import { requireFreshAal2 } from './auth-step-up';
import { supabase } from './supabase';

// ─── F.1 Rename ──────────────────────────────────────────────────
// Owner + Admin duerfen umbenennen (RLS). Editor/Viewer haben kein
// UPDATE-Recht — Server-Side-Reject ist autoritativ.
//
// Validierung clientseitig nur Mindest-Stoperei (leer/Maxlaenge) —
// die `workspaces.name`-CHECK-Constraint in der DB (Migration 001)
// ist autoritativ.
export async function renameWorkspace(workspaceId: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Workspace-Name darf nicht leer sein.');
  }
  if (trimmed.length > 80) {
    throw new Error('Workspace-Name maximal 80 Zeichen.');
  }
  const { error } = await supabase
    .from('workspaces')
    .update({ name: trimmed })
    .eq('id', workspaceId);
  if (error) throw error;
}

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
  // B.3 — Step-Up. Fresh AAL2 in den letzten 5min Pflicht.
  const ok = await requireFreshAal2({
    reason:
      'Eigentum eines Workspaces zu uebertragen ist eine destruktive Aktion. Bitte bestaetige.',
  });
  if (!ok) throw new Error('step_up_cancelled');
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
  // B.3 — Step-Up. Fresh AAL2 in den letzten 5min Pflicht.
  const ok = await requireFreshAal2({
    reason: 'Workspace dauerhaft loeschen ist nicht widerrufbar. Bitte bestaetige.',
  });
  if (!ok) throw new Error('step_up_cancelled');
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
    if (msg.includes('step_up_cancelled')) {
      return 'Aktion abgebrochen — Code nicht bestaetigt.';
    }
  }
  return fallback;
}
