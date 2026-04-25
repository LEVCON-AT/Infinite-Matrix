// Workspace-Members — Phase 1 (P1.A).
//
// Read-Pfad ueber SECURITY DEFINER RPC `list_workspace_members`
// (Migration 011), die memberships mit auth.users joinen kann
// (auth-Schema ist via PostgREST nicht direkt erreichbar).
//
// Schreib-Aktionen (Rolle aendern, entfernen, Eigentum uebertragen)
// kommen in P1.B. P1.A liefert nur die read-only Liste fuer die
// Settings-Members-Page.

import { supabase } from './supabase';
import type { WorkspaceRole } from './types';

export type WorkspaceMember = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  role: WorkspaceRole;
  joined_at: string;
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

// Anzeige-Helfer: wenn display_name leer ist, das @-Prefix der Email
// nehmen; wenn auch das fehlt, die ersten 8 Zeichen der user_id.
export function memberDisplayLabel(m: WorkspaceMember): string {
  if (m.display_name?.trim()) return m.display_name.trim();
  if (m.email) return m.email.split('@')[0] ?? m.email;
  return m.user_id.slice(0, 8);
}
