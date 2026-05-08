// Welle WV.A.3 — Hotkey-Slot-Belegung Mutations + Reads.
//
// Steuert die 1-9-Slot-Belegung pro Workspace (Owner-Write) und
// User-Override (Self-Write). Konzept §6.3 + §6.4.
//
// Auflosungs-Reihenfolge fuer „welche Vorlage liegt auf Slot N?":
//   1. user_hotkey_slots Row mit (user_id=auth, workspace_id, slot=N) → wenn ja, das.
//   2. workspace_hotkey_slots Row mit (workspace_id, slot=N) → wenn ja, das.
//   3. NULL → Slot ist leer.
//
// Helper `resolveSlotTemplateId(slot, ws, user)` macht das in O(1)
// gegen pre-loaded Maps. Caller (Workspace.tsx Resource) laedt
// beide Tabellen einmal und reicht die Maps an Konsumenten.

import { isNetworkError } from './mutation-queue';
import { type CacheTable, getByWorkspace, mergeRows } from './offline-cache';
import { markCacheFallback, markLiveSuccess } from './offline-state';
import { runOptimisticDelete, runOptimisticInsert } from './safe-mutation';
import { supabase } from './supabase';
import type { UserHotkeySlotRow, WorkspaceHotkeySlotRow } from './types';

const WORKSPACE_HOTKEY_SLOTS_TABLE: CacheTable = 'workspace_hotkey_slots';
const USER_HOTKEY_SLOTS_TABLE: CacheTable = 'user_hotkey_slots';

// ─── Reads ─────────────────────────────────────────────────────

export async function fetchWorkspaceHotkeySlots(
  workspaceId: string,
): Promise<WorkspaceHotkeySlotRow[]> {
  if (!workspaceId) return [];
  try {
    const { data, error } = await supabase
      .from('workspace_hotkey_slots')
      .select('*')
      .eq('workspace_id', workspaceId);
    if (error) throw error;
    const rows = (data ?? []) as WorkspaceHotkeySlotRow[];
    void mergeRows(WORKSPACE_HOTKEY_SLOTS_TABLE, rows).catch(() => {});
    markLiveSuccess();
    return rows;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const cached = await getByWorkspace<WorkspaceHotkeySlotRow>(
      WORKSPACE_HOTKEY_SLOTS_TABLE,
      workspaceId,
    );
    markCacheFallback();
    return cached;
  }
}

export async function fetchUserHotkeySlots(workspaceId: string): Promise<UserHotkeySlotRow[]> {
  if (!workspaceId) return [];
  try {
    // RLS filtert auf user_id=auth.uid() — wir reichen also nur den
    // workspace_id-Filter durch.
    const { data, error } = await supabase
      .from('user_hotkey_slots')
      .select('*')
      .eq('workspace_id', workspaceId);
    if (error) throw error;
    const rows = (data ?? []) as UserHotkeySlotRow[];
    void mergeRows(USER_HOTKEY_SLOTS_TABLE, rows).catch(() => {});
    markLiveSuccess();
    return rows;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const cached = await getByWorkspace<UserHotkeySlotRow>(USER_HOTKEY_SLOTS_TABLE, workspaceId);
    markCacheFallback();
    return cached;
  }
}

// ─── Mutations: workspace_hotkey_slots ─────────────────────────

export type SetWorkspaceHotkeySlotInput = {
  workspaceId: string;
  slot: number;
  templateId: string;
  setBy?: string | null;
};

// Upsert via UNIQUE(workspace_id, slot) on_conflict.
export async function setWorkspaceHotkeySlot(
  input: SetWorkspaceHotkeySlotInput,
): Promise<WorkspaceHotkeySlotRow> {
  if (input.slot < 1 || input.slot > 9) {
    throw new Error(`Slot muss zwischen 1 und 9 liegen, war ${input.slot}.`);
  }
  return runOptimisticInsert<WorkspaceHotkeySlotRow>({
    table: WORKSPACE_HOTKEY_SLOTS_TABLE,
    workspaceId: input.workspaceId,
    label: 'Hotkey-Slot setzen',
    run: async () => {
      const { data, error } = await supabase
        .from('workspace_hotkey_slots')
        .upsert(
          {
            workspace_id: input.workspaceId,
            slot: input.slot,
            template_id: input.templateId,
            set_by: input.setBy ?? null,
          },
          { onConflict: 'workspace_id,slot' },
        )
        .select()
        .single();
      if (error) throw error;
      return data as WorkspaceHotkeySlotRow;
    },
    buildOffline: (id) => ({
      id,
      workspace_id: input.workspaceId,
      slot: input.slot,
      template_id: input.templateId,
      set_by: input.setBy ?? null,
      set_at: new Date().toISOString(),
    }),
  });
}

export async function clearWorkspaceHotkeySlot(id: string): Promise<void> {
  await runOptimisticDelete({
    table: WORKSPACE_HOTKEY_SLOTS_TABLE,
    id,
    label: 'Hotkey-Slot loeschen',
    run: async () => {
      const { error } = await supabase.from('workspace_hotkey_slots').delete().eq('id', id);
      if (error) throw error;
    },
  });
}

// ─── Mutations: user_hotkey_slots ──────────────────────────────

export type SetUserHotkeySlotInput = {
  userId: string;
  workspaceId: string;
  slot: number;
  templateId: string;
};

export async function setUserHotkeySlot(input: SetUserHotkeySlotInput): Promise<UserHotkeySlotRow> {
  if (input.slot < 1 || input.slot > 9) {
    throw new Error(`Slot muss zwischen 1 und 9 liegen, war ${input.slot}.`);
  }
  return runOptimisticInsert<UserHotkeySlotRow>({
    table: USER_HOTKEY_SLOTS_TABLE,
    workspaceId: input.workspaceId,
    label: 'Eigener Hotkey-Slot setzen',
    run: async () => {
      const { data, error } = await supabase
        .from('user_hotkey_slots')
        .upsert(
          {
            user_id: input.userId,
            workspace_id: input.workspaceId,
            slot: input.slot,
            template_id: input.templateId,
          },
          { onConflict: 'user_id,workspace_id,slot' },
        )
        .select()
        .single();
      if (error) throw error;
      return data as UserHotkeySlotRow;
    },
    buildOffline: (id) => ({
      id,
      user_id: input.userId,
      workspace_id: input.workspaceId,
      slot: input.slot,
      template_id: input.templateId,
      set_at: new Date().toISOString(),
    }),
  });
}

export async function clearUserHotkeySlot(id: string): Promise<void> {
  await runOptimisticDelete({
    table: USER_HOTKEY_SLOTS_TABLE,
    id,
    label: 'Eigenen Hotkey-Slot loeschen',
    run: async () => {
      const { error } = await supabase.from('user_hotkey_slots').delete().eq('id', id);
      if (error) throw error;
    },
  });
}

// ─── Resolver ──────────────────────────────────────────────────
// User-Override hat Vorrang vor Workspace-Belegung. Beide Tabellen
// vom Caller einmal pro Workspace geladen, hier reine Map-Lookup.

export function resolveSlotTemplateId(
  slot: number,
  workspaceSlots: ReadonlyArray<WorkspaceHotkeySlotRow>,
  userSlots: ReadonlyArray<UserHotkeySlotRow>,
  workspaceId: string,
  userId: string,
): string | null {
  const userOverride = userSlots.find(
    (r) => r.user_id === userId && r.workspace_id === workspaceId && r.slot === slot,
  );
  if (userOverride) return userOverride.template_id;
  const workspaceSlot = workspaceSlots.find(
    (r) => r.workspace_id === workspaceId && r.slot === slot,
  );
  return workspaceSlot?.template_id ?? null;
}
