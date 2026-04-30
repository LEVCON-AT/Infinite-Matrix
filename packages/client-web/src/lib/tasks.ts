// Task-Layer (Phase 4 T.1.C) — Mutations + Helpers.
//
// ECS-Architektur: tasks (Layer 0 = Aggregate Root) + task_manifestations
// (Layer 1 = "wo erscheint die Task"). Pattern aus lib/objects.ts +
// lib/mutations.ts uebernommen — runOptimistic*-Wrapper, IDB-Cache-
// Fallback bei Network-Errors, Snapshot-basiertes Restore fuer Undo.
//
// Lese-Pfade:
//   fetchTasks(workspaceId) — alle Tasks im Workspace + IDB-Fallback
//   fetchTask(taskId)       — einzelne Task + IDB-Fallback
//   fetchManifestationsByTask(taskId)
//   fetchManifestationsByContainer(containerId, kind)
//
// Schreibe-Pfade:
//   createTask(workspaceId, init)
//   updateTask(taskId, patch)        + Setter-Helper (setTaskLabel, ...)
//   toggleTaskDone(taskId, done)
//   deleteTask(taskId)               (mit Snapshot fuer Undo)
//   restoreTask(snap)                (Undo-Aufrufer)
//   addManifestation(input)
//   moveManifestation(manifId, container, position)
//   removeManifestation(manifId)
//
// Layer 2-4 (Dependencies / Rules / Comments+Files+Docs) folgen in
// T.3 / T.4 / T.2 — diese Datei legt nur Layer 0 + 1.

import { isNetworkError } from './mutation-queue';
import { type CacheTable, getById, getByWorkspace, mergeRows, putOne } from './offline-cache';
import { markCacheFallback, markLiveSuccess } from './offline-state';
import { runOptimisticDelete, runOptimisticInsert, runOptimisticUpdate } from './safe-mutation';
import { supabase } from './supabase';
import type {
  TaskInput,
  TaskManifestationInput,
  TaskManifestationKind,
  TaskManifestationRow,
  TaskRecur,
  TaskRow,
  TaskStatus,
} from './types';

// Re-Export der Types fuer Konsumenten — gleiches Pattern wie objects.ts.
export type {
  TaskInput,
  TaskManifestationInput,
  TaskManifestationKind,
  TaskManifestationRow,
  TaskRecur,
  TaskRow,
  TaskStatus,
} from './types';

// ─── Snapshot fuer Undo (deleteTask → restoreTask) ────────────
// Analog Object-Layer: Snapshot enthaelt Task + alle Manifestations,
// damit ein Undo den exakten Vor-Zustand wieder herstellt.
export type TaskSnapshot = {
  task: TaskRow;
  manifestations: TaskManifestationRow[];
};

// ═══════════════════════════════════════════════════════════════
// LESE-PFADE
// ═══════════════════════════════════════════════════════════════

// Alle Tasks eines Workspaces. Fallback auf IDB-Cache bei Network-Loss.
export async function fetchTasks(workspaceId: string): Promise<TaskRow[]> {
  if (!workspaceId) return [];
  try {
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    const rows = (data ?? []) as TaskRow[];
    void mergeRows('tasks', rows).catch(() => {});
    markLiveSuccess();
    return rows;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const cached = await getByWorkspace<TaskRow>('tasks', workspaceId);
    markCacheFallback();
    return cached.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
  }
}

export async function fetchTask(taskId: string): Promise<TaskRow | null> {
  if (!taskId) return null;
  try {
    const { data, error } = await supabase.from('tasks').select('*').eq('id', taskId).maybeSingle();
    if (error) throw error;
    const row = (data ?? null) as TaskRow | null;
    if (row) void mergeRows('tasks', [row]).catch(() => {});
    markLiveSuccess();
    return row;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const cached = await getById<TaskRow>('tasks', taskId);
    markCacheFallback();
    return cached;
  }
}

export async function fetchManifestationsByTask(taskId: string): Promise<TaskManifestationRow[]> {
  if (!taskId) return [];
  try {
    const { data, error } = await supabase
      .from('task_manifestations')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    const rows = (data ?? []) as TaskManifestationRow[];
    void mergeRows('task_manifestations', rows).catch(() => {});
    markLiveSuccess();
    return rows;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    // IDB hat keinen by_task-Index — wir holen alle Manifestations und
    // filtern client-seitig. Bei Workspace-Scope reicht das, der Cache
    // ist ohnehin pro Workspace klein gehalten.
    const all = await getByWorkspace<TaskManifestationRow>('task_manifestations', '');
    markCacheFallback();
    return all.filter((m) => m.task_id === taskId);
  }
}

export async function fetchManifestationsByContainer(
  containerId: string,
  kind: TaskManifestationKind,
): Promise<TaskManifestationRow[]> {
  if (!containerId) return [];
  try {
    const { data, error } = await supabase
      .from('task_manifestations')
      .select('*')
      .eq('container_id', containerId)
      .eq('kind', kind)
      .order('position', { ascending: true });
    if (error) throw error;
    const rows = (data ?? []) as TaskManifestationRow[];
    void mergeRows('task_manifestations', rows).catch(() => {});
    markLiveSuccess();
    return rows;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const all = await getByWorkspace<TaskManifestationRow>('task_manifestations', '');
    markCacheFallback();
    return all
      .filter((m) => m.container_id === containerId && m.kind === kind)
      .sort((a, b) => a.position - b.position);
  }
}

export async function fetchManifestationsByWorkspace(
  workspaceId: string,
): Promise<TaskManifestationRow[]> {
  if (!workspaceId) return [];
  try {
    const { data, error } = await supabase
      .from('task_manifestations')
      .select('*')
      .eq('workspace_id', workspaceId);
    if (error) throw error;
    const rows = (data ?? []) as TaskManifestationRow[];
    void mergeRows('task_manifestations', rows).catch(() => {});
    markLiveSuccess();
    return rows;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const cached = await getByWorkspace<TaskManifestationRow>('task_manifestations', workspaceId);
    markCacheFallback();
    return cached;
  }
}

// ═══════════════════════════════════════════════════════════════
// SCHREIBE-PFADE — TASKS
// ═══════════════════════════════════════════════════════════════

export async function createTask(workspaceId: string, init: TaskInput): Promise<TaskRow> {
  return runOptimisticInsert<TaskRow>({
    table: 'tasks',
    workspaceId,
    label: 'Aufgabe anlegen',
    run: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .insert({
          workspace_id: workspaceId,
          label: init.label,
          note: init.note ?? null,
          status: init.status ?? 'open',
          deadline: init.deadline ?? null,
          who: init.who ?? [],
          recur: init.recur ?? null,
          attrs: init.attrs ?? {},
        })
        .select()
        .single();
      if (error) throw error;
      return data as TaskRow;
    },
    buildOffline: (id) => {
      const now = new Date().toISOString();
      return {
        id,
        workspace_id: workspaceId,
        label: init.label,
        note: init.note ?? null,
        status: init.status ?? 'open',
        deadline: init.deadline ?? null,
        who: init.who ?? [],
        recur: init.recur ?? null,
        done_occurrences: [],
        attrs: init.attrs ?? {},
        created_at: now,
        created_by: null,
        updated_at: now,
      };
    },
  });
}

export type TaskPatch = Partial<{
  label: string;
  note: string | null;
  status: TaskStatus;
  deadline: string | null;
  who: string[];
  recur: TaskRecur | null;
  done_occurrences: string[];
  attrs: Record<string, unknown>;
}>;

export async function updateTask(taskId: string, patch: TaskPatch): Promise<TaskRow> {
  return runOptimisticUpdate<TaskRow>({
    table: 'tasks',
    id: taskId,
    patch: patch as Record<string, unknown>,
    label: taskLabelFromPatch(patch),
    run: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .update(patch)
        .eq('id', taskId)
        .select()
        .single();
      if (error) throw error;
      return data as TaskRow;
    },
  });
}

function taskLabelFromPatch(patch: TaskPatch): string {
  if ('status' in patch) {
    if (patch.status === 'done') return 'Aufgabe erledigen';
    if (patch.status === 'archived') return 'Aufgabe archivieren';
    if (patch.status === 'in_progress') return 'Aufgabe starten';
    if (patch.status === 'blocked') return 'Aufgabe blockieren';
    if (patch.status === 'open') return 'Aufgabe oeffnen';
  }
  if ('label' in patch) return 'Aufgabe umbenennen';
  if ('note' in patch) return 'Notiz speichern';
  if ('deadline' in patch) return 'Deadline setzen';
  if ('who' in patch) return 'Verantwortliche setzen';
  if ('recur' in patch) return 'Wiederholung setzen';
  return 'Aufgabe aktualisieren';
}

// Convenience-Setter analog updateCard-Setter in mutations.ts.
export function setTaskLabel(taskId: string, label: string): Promise<TaskRow> {
  return updateTask(taskId, { label });
}
export function setTaskNote(taskId: string, note: string | null): Promise<TaskRow> {
  return updateTask(taskId, { note });
}
export function setTaskStatus(taskId: string, status: TaskStatus): Promise<TaskRow> {
  return updateTask(taskId, { status });
}
export function setTaskDeadline(taskId: string, deadline: string | null): Promise<TaskRow> {
  return updateTask(taskId, { deadline });
}
export function setTaskWho(taskId: string, who: string[]): Promise<TaskRow> {
  return updateTask(taskId, { who });
}
export function setTaskRecur(taskId: string, recur: TaskRecur | null): Promise<TaskRow> {
  return updateTask(taskId, { recur });
}
export function setTaskDoneOccurrences(
  taskId: string,
  done_occurrences: string[],
): Promise<TaskRow> {
  return updateTask(taskId, { done_occurrences });
}

// Toggle-Helper: schaltet zwischen 'done' und 'open'. Bei 'archived'
// bleibt der Status — Archiv-Toggle laeuft ueber setTaskStatus direkt.
export function toggleTaskDone(taskId: string, done: boolean): Promise<TaskRow> {
  return updateTask(taskId, { status: done ? 'done' : 'open' });
}

// Snapshot bauen, dann Cascade auf manifestations (DB ON DELETE CASCADE)
// und am Ende task. Bei Network-Loss landet der Delete-Spec in der Queue.
export async function deleteTask(taskId: string): Promise<TaskSnapshot | null> {
  const task = await fetchTask(taskId);
  if (!task) return null;
  const manifestations = await fetchManifestationsByTask(taskId);

  await runOptimisticDelete({
    table: 'tasks',
    id: taskId,
    label: 'Aufgabe loeschen',
    run: async () => {
      const { error } = await supabase.from('tasks').delete().eq('id', taskId);
      if (error) throw error;
    },
  });

  // Manifestations sind durch FK CASCADE eh weg — lokalen Cache aber
  // explizit putzen, sonst zeigen Reads stale Daten bis zum naechsten
  // Live-Refresh.
  for (const m of manifestations) {
    await runOptimisticDelete({
      table: 'task_manifestations',
      id: m.id,
      workspaceId: m.workspace_id,
      run: async () => {
        // FK-Cascade hat das schon erledigt — wir versuchen den DELETE
        // trotzdem (idempotent: loescht nichts wenn schon weg). Bei
        // Network-Loss landet er in der Queue — auch ok.
        await supabase.from('task_manifestations').delete().eq('id', m.id);
      },
    });
  }

  return { task, manifestations };
}

// Restore: legt task wieder mit identischer ID an, dann Manifestations.
// Aufrufer bekommt das via showUndoToast(label, () => restoreTask(snap)).
export async function restoreTask(snap: TaskSnapshot): Promise<TaskRow> {
  const t = snap.task;
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      id: t.id,
      workspace_id: t.workspace_id,
      label: t.label,
      note: t.note,
      status: t.status,
      deadline: t.deadline,
      who: t.who,
      recur: t.recur,
      done_occurrences: t.done_occurrences,
      attrs: t.attrs,
    })
    .select()
    .single();
  if (error) throw error;
  const restored = data as TaskRow;
  void putOne('tasks' satisfies CacheTable, restored).catch(() => {});

  for (const m of snap.manifestations) {
    const { data: mData, error: mErr } = await supabase
      .from('task_manifestations')
      .insert({
        id: m.id,
        task_id: m.task_id,
        workspace_id: m.workspace_id,
        kind: m.kind,
        container_id: m.container_id,
        position: m.position,
        level: m.level,
        display_meta: m.display_meta,
      })
      .select()
      .single();
    if (mErr) {
      console.error('[tasks] restoreTask manifestation insert failed', mErr);
      continue;
    }
    void putOne('task_manifestations' satisfies CacheTable, mData as TaskManifestationRow).catch(
      () => {},
    );
  }
  return restored;
}

// ═══════════════════════════════════════════════════════════════
// SCHREIBE-PFADE — MANIFESTATIONS
// ═══════════════════════════════════════════════════════════════

// Polymorphes Container-Constraint enforced auch hier (Defense-in-Depth
// vor dem DB-CHECK): kanban/checklist brauchen container_id, calendar/
// standalone duerfen keinen haben.
function validateManifestationInput(input: TaskManifestationInput): void {
  if (input.kind === 'kanban' || input.kind === 'checklist') {
    if (!input.container_id) {
      throw new Error(`task_manifestation kind='${input.kind}' braucht container_id`);
    }
  } else if (input.kind === 'calendar' || input.kind === 'standalone') {
    if (input.container_id) {
      throw new Error(`task_manifestation kind='${input.kind}' darf keinen container_id haben`);
    }
  }
  if (input.kind === 'checklist') {
    if (input.level == null || input.level < 0 || input.level > 2) {
      throw new Error("task_manifestation kind='checklist' braucht level 0..2");
    }
  } else if (input.level != null) {
    throw new Error(`task_manifestation kind='${input.kind}' darf kein level haben`);
  }
}

export async function addManifestation(
  workspaceId: string,
  input: TaskManifestationInput,
): Promise<TaskManifestationRow> {
  validateManifestationInput(input);
  return runOptimisticInsert<TaskManifestationRow>({
    table: 'task_manifestations',
    workspaceId,
    label: 'Sicht hinzufuegen',
    run: async () => {
      const { data, error } = await supabase
        .from('task_manifestations')
        .insert({
          task_id: input.task_id,
          workspace_id: workspaceId,
          kind: input.kind,
          container_id: input.container_id ?? null,
          position: input.position ?? 0,
          level: input.level ?? null,
          display_meta: input.display_meta ?? {},
        })
        .select()
        .single();
      if (error) throw error;
      return data as TaskManifestationRow;
    },
    buildOffline: (id) => ({
      id,
      task_id: input.task_id,
      workspace_id: workspaceId,
      kind: input.kind,
      container_id: input.container_id ?? null,
      position: input.position ?? 0,
      level: input.level ?? null,
      display_meta: input.display_meta ?? {},
      created_at: new Date().toISOString(),
    }),
  });
}

export type ManifestationPatch = Partial<{
  container_id: string | null;
  position: number;
  level: number | null;
  display_meta: Record<string, unknown>;
}>;

export async function updateManifestation(
  manifId: string,
  patch: ManifestationPatch,
): Promise<TaskManifestationRow> {
  return runOptimisticUpdate<TaskManifestationRow>({
    table: 'task_manifestations',
    id: manifId,
    patch: patch as Record<string, unknown>,
    label: 'Sicht aendern',
    run: async () => {
      const { data, error } = await supabase
        .from('task_manifestations')
        .update(patch)
        .eq('id', manifId)
        .select()
        .single();
      if (error) throw error;
      return data as TaskManifestationRow;
    },
  });
}

// Drag-Drop-Move: Position innerhalb desselben Containers oder Wechsel
// in einen anderen Container desselben Kinds. kind-Wechsel ist nicht
// zulaessig (Phase 1: erst T.2 erlaubt z.B. Item→Card-Move).
export async function moveManifestation(
  manifId: string,
  newContainerId: string | null,
  newPosition: number,
): Promise<TaskManifestationRow> {
  return updateManifestation(manifId, {
    container_id: newContainerId,
    position: newPosition,
  });
}

export async function removeManifestation(manifId: string): Promise<void> {
  await runOptimisticDelete({
    table: 'task_manifestations',
    id: manifId,
    label: 'Sicht entfernen',
    run: async () => {
      const { error } = await supabase.from('task_manifestations').delete().eq('id', manifId);
      if (error) throw error;
    },
  });
}
