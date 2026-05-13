// Task-Layer (Phase 4 T.1.C + Q.2 consolidation) — Mutations + Helpers.
//
// ECS-Architektur: tasks (Layer 0 = Aggregate Root) + atom_manifestations
// (Layer 1 = "wo erscheint die Task / das Atom"). Q.2 hat die alte
// task_manifestations-Tabelle aufgeloest — diese Datei schreibt und
// liest jetzt direkt gegen atom_manifestations mit atom_type='task'.
// Pattern aus lib/objects.ts + lib/mutations.ts: runOptimistic*-Wrapper,
// IDB-Cache-Fallback bei Network-Errors, Snapshot-basiertes Restore
// fuer Undo.
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
import { type CacheTable, getById, getByWorkspace, mergeRows } from './offline-cache';
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

// Q.2: Manifestations-IDB-Cache-Store + Tabellenname zentral. Alle
// Funktionen unten lesen/schreiben gegen atom_manifestations mit
// atom_type='task'-Filter. TaskManifestationRow ist die getypte Sicht
// auf das Subset.
const MANIF_TABLE: CacheTable = 'atom_manifestations';

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
      .from('atom_manifestations')
      .select('*')
      .eq('atom_type', 'task')
      .eq('atom_id', taskId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    const rows = (data ?? []) as TaskManifestationRow[];
    void mergeRows(MANIF_TABLE, rows).catch(() => {});
    markLiveSuccess();
    return rows;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    // IDB hat keinen by_atom-Index — wir holen alle Manifestations und
    // filtern client-seitig. Bei Workspace-Scope reicht das, der Cache
    // ist ohnehin pro Workspace klein gehalten.
    const all = await getByWorkspace<TaskManifestationRow>(MANIF_TABLE, '');
    markCacheFallback();
    return all.filter((m) => m.atom_type === 'task' && m.atom_id === taskId);
  }
}

export async function fetchManifestationsByContainer(
  containerId: string,
  kind: TaskManifestationKind,
): Promise<TaskManifestationRow[]> {
  if (!containerId) return [];
  try {
    const { data, error } = await supabase
      .from('atom_manifestations')
      .select('*')
      .eq('atom_type', 'task')
      .eq('container_id', containerId)
      .eq('kind', kind)
      .order('position', { ascending: true });
    if (error) throw error;
    const rows = (data ?? []) as TaskManifestationRow[];
    void mergeRows(MANIF_TABLE, rows).catch(() => {});
    markLiveSuccess();
    return rows;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const all = await getByWorkspace<TaskManifestationRow>(MANIF_TABLE, '');
    markCacheFallback();
    return all
      .filter((m) => m.atom_type === 'task' && m.container_id === containerId && m.kind === kind)
      .sort((a, b) => a.position - b.position);
  }
}

export async function fetchManifestationsByWorkspace(
  workspaceId: string,
): Promise<TaskManifestationRow[]> {
  if (!workspaceId) return [];
  try {
    const { data, error } = await supabase
      .from('atom_manifestations')
      .select('*')
      .eq('atom_type', 'task')
      .eq('workspace_id', workspaceId);
    if (error) throw error;
    const rows = (data ?? []) as TaskManifestationRow[];
    void mergeRows(MANIF_TABLE, rows).catch(() => {});
    markLiveSuccess();
    return rows;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const cached = await getByWorkspace<TaskManifestationRow>(MANIF_TABLE, workspaceId);
    markCacheFallback();
    return cached.filter((m) => m.atom_type === 'task');
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
// T.AC.D.3: pro-Recur-Instanz toggeln. Caller uebergibt die aktuellen
// done_occurrences (aus dem Render-State); wir berechnen das neue
// Array via toggleOccurrence (lib/recur.ts) und persistieren via
// setTaskDoneOccurrences. Aufrufer aus Calendar/DayView haben den
// Task im wsTasks-Memo geladen — kein Round-Trip noetig.
export async function toggleTaskInstanceDone(
  taskId: string,
  instanceDate: string,
  done: boolean,
  currentOccurrences: string[],
): Promise<TaskRow> {
  const { toggleOccurrence } = await import('./recur');
  const next = toggleOccurrence(currentOccurrences, instanceDate, done);
  return setTaskDoneOccurrences(taskId, next);
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

// Snapshot bauen, dann atom_manifestations explizit purgen (Pseudo-
// CASCADE-Trigger aus Migration 044 erledigt das auch DB-seitig — wir
// rufen den Delete trotzdem damit der lokale Cache sauber bleibt).
// Bei Network-Loss landet der Delete-Spec in der Queue.
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

  // Pseudo-CASCADE-Trigger _atom_manif_purge_for_task aus Migration 044
  // hat die Manifestations DB-seitig schon entfernt — wir putzen den
  // IDB-Cache idempotent, damit kein stale Stand bleibt.
  for (const m of manifestations) {
    await runOptimisticDelete({
      table: MANIF_TABLE,
      id: m.id,
      workspaceId: m.workspace_id,
      run: async () => {
        // Idempotent: loescht nichts wenn der Trigger schon gepurgt hat.
        await supabase.from('atom_manifestations').delete().eq('id', m.id);
      },
    });
  }

  return { task, manifestations };
}

// Restore: legt task wieder mit identischer ID an, dann Manifestations.
// Aufrufer bekommt das via showUndoToast(label, () => restoreTask(snap)).
//
// Beide Inserts laufen durch runOptimisticInsert (architektur.md §4.1) —
// Offline-Klick auf Undo queued die Inserts in der Mutation-Queue und
// patcht den IDB-Cache, statt silent zu brechen wie der pre-§4.1-Pfad
// (direktes supabase.from().insert(), Manifestation-Fehler nur console.error).
// Pattern-Parallele zu restoreCard in mutations.ts.
export async function restoreTask(snap: TaskSnapshot): Promise<TaskRow> {
  const t = snap.task;
  const restored = await runOptimisticInsert<TaskRow>({
    table: 'tasks',
    workspaceId: t.workspace_id,
    label: 'Aufgabe wiederherstellen',
    run: async () => {
      const payload = {
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
      };
      const { data, error } = await supabase.from('tasks').insert(payload).select().single();
      if (error) throw error;
      return data as TaskRow;
    },
    buildOffline: () => t,
  });

  for (const m of snap.manifestations) {
    await runOptimisticInsert<TaskManifestationRow>({
      table: MANIF_TABLE,
      workspaceId: m.workspace_id,
      label: 'Aufgabe wiederherstellen',
      run: async () => {
        const payload = {
          id: m.id,
          atom_type: 'task' as const,
          atom_id: m.atom_id,
          workspace_id: m.workspace_id,
          kind: m.kind,
          container_id: m.container_id,
          position: m.position,
          level: m.level,
          display_meta: m.display_meta,
        };
        const { data, error } = await supabase
          .from('atom_manifestations')
          .insert(payload)
          .select()
          .single();
        if (error) throw error;
        return data as TaskManifestationRow;
      },
      buildOffline: () => m,
    });
  }
  return restored;
}

// ═══════════════════════════════════════════════════════════════
// POSITION-HELPER
// ═══════════════════════════════════════════════════════════════

// Liefert die naechste freie Position fuer eine Manifestation in einem
// bestimmten Container desselben Kinds. Bevorzugt einen Live-Read
// (MAX(position) + 1) und faellt bei Network-Loss auf den IDB-Cache
// zurueck. Q.1.c: ersetzt ad-hoc `Date.now()`-Defaults aus der
// manifestation-cross-view-Welle — Date.now() produziert 13-stellige
// Timestamps, die mit den 0/1/2/...-Positionen der bestehenden
// Manifestations kollidieren und Replay-/Reorder-Pfade brechen.
export async function nextManifestationPosition(
  containerId: string,
  kind: TaskManifestationKind,
): Promise<number> {
  if (!containerId) return 0;
  try {
    const { data, error } = await supabase
      .from('atom_manifestations')
      .select('position')
      .eq('atom_type', 'task')
      .eq('container_id', containerId)
      .eq('kind', kind)
      .order('position', { ascending: false })
      .limit(1);
    if (error) throw error;
    const top = data && data.length > 0 ? (data[0] as { position: number }).position : -1;
    markLiveSuccess();
    return top + 1;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    // Cache-Fallback: alle Manifestations laden und client-seitig
    // filtern. Pattern uebernommen aus nextPositionFromCache in
    // mutations.ts.
    const all = await getByWorkspace<TaskManifestationRow>(MANIF_TABLE, '');
    const filtered = all.filter(
      (m) => m.atom_type === 'task' && m.container_id === containerId && m.kind === kind,
    );
    markCacheFallback();
    if (filtered.length === 0) return 0;
    return filtered.reduce((m, r) => Math.max(m, r.position ?? -1), -1) + 1;
  }
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
      throw new Error(`atom_manifestation kind='${input.kind}' braucht container_id`);
    }
  } else if (input.kind === 'calendar' || input.kind === 'standalone') {
    if (input.container_id) {
      throw new Error(`atom_manifestation kind='${input.kind}' darf keinen container_id haben`);
    }
  }
  if (input.kind === 'checklist') {
    if (input.level == null || input.level < 0 || input.level > 2) {
      throw new Error("atom_manifestation kind='checklist' braucht level 0..2");
    }
  } else if (input.level != null) {
    throw new Error(`atom_manifestation kind='${input.kind}' darf kein level haben`);
  }
}

export async function addManifestation(
  workspaceId: string,
  input: TaskManifestationInput,
): Promise<TaskManifestationRow> {
  validateManifestationInput(input);
  return runOptimisticInsert<TaskManifestationRow>({
    table: MANIF_TABLE,
    workspaceId,
    label: 'Sicht hinzufuegen',
    run: async () => {
      const { data, error } = await supabase
        .from('atom_manifestations')
        .insert({
          atom_type: 'task',
          atom_id: input.atom_id,
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
      atom_type: 'task',
      atom_id: input.atom_id,
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
    table: MANIF_TABLE,
    id: manifId,
    patch: patch as Record<string, unknown>,
    label: 'Sicht aendern',
    run: async () => {
      const { data, error } = await supabase
        .from('atom_manifestations')
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
    table: MANIF_TABLE,
    id: manifId,
    label: 'Sicht entfernen',
    run: async () => {
      const { error } = await supabase.from('atom_manifestations').delete().eq('id', manifId);
      if (error) throw error;
    },
  });
}
