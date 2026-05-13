// Task-Dependencies (Phase 4 T.3) — Layer 2 des ECS-Patterns.
//
// Gerichtete „Blocker → Blocked"-Beziehung zwischen zwei Tasks im
// gleichen Workspace. Server-Side validation:
//   - Workspace-Match (Migration 089 Trigger)
//   - Kein Selbst-Loop (CHECK)
//   - Keine Doubletten (UNIQUE)
//   - Keine Zyklen (Trigger mit recursive CTE)
//
// Offline-Pfad: IDB-Cache `task_dependencies`, Mutations via
// runOptimisticInsert/Delete — gleich wie objects.ts / tasks.ts.

import { isNetworkError } from './mutation-queue';
import { type CacheTable, getByWorkspace, mergeRows } from './offline-cache';
import { markCacheFallback, markLiveSuccess } from './offline-state';
import { runOptimisticDelete, runOptimisticInsert } from './safe-mutation';
import { supabase } from './supabase';
import type { TaskDependencyInput, TaskDependencyRow } from './types';

export type { TaskDependencyInput, TaskDependencyRow } from './types';

const TABLE: CacheTable = 'task_dependencies';

// Alle Dependencies eines Workspaces — V1 laedt einmal komplett, weil
// die Tabelle pro Workspace klein bleibt (zig bis ein paar hundert).
// Wird vom Task-Detail in beide Richtungen (Blocker / Blocked) gefiltert.
export async function fetchDependencies(workspaceId: string): Promise<TaskDependencyRow[]> {
  if (!workspaceId) return [];
  try {
    const { data, error } = await supabase
      .from('task_dependencies')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    const rows = (data ?? []) as TaskDependencyRow[];
    void mergeRows(TABLE, rows).catch(() => {});
    markLiveSuccess();
    return rows;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const cached = await getByWorkspace<TaskDependencyRow>(TABLE, workspaceId);
    markCacheFallback();
    return cached;
  }
}

// Convenience: alle Dependencies wo blocked_task_id = taskId.
export function getBlockersOf(taskId: string, all: TaskDependencyRow[]): TaskDependencyRow[] {
  return all.filter((d) => d.blocked_task_id === taskId);
}

// Convenience: alle Dependencies wo blocker_task_id = taskId.
export function getBlockedBy(taskId: string, all: TaskDependencyRow[]): TaskDependencyRow[] {
  return all.filter((d) => d.blocker_task_id === taskId);
}

export async function addDependency(input: TaskDependencyInput): Promise<TaskDependencyRow> {
  return runOptimisticInsert<TaskDependencyRow>({
    table: TABLE,
    workspaceId: input.workspace_id,
    label: 'Abhaengigkeit',
    buildOffline: (id) => ({
      id,
      workspace_id: input.workspace_id,
      blocker_task_id: input.blocker_task_id,
      blocked_task_id: input.blocked_task_id,
      created_by: null,
      created_at: new Date().toISOString(),
    }),
    run: async () => {
      const { data, error } = await supabase
        .from('task_dependencies')
        .insert({
          workspace_id: input.workspace_id,
          blocker_task_id: input.blocker_task_id,
          blocked_task_id: input.blocked_task_id,
        })
        .select('*')
        .single();
      if (error) throw error;
      return data as TaskDependencyRow;
    },
  });
}

export async function removeDependency(id: string, workspaceId: string): Promise<void> {
  await runOptimisticDelete({
    table: TABLE,
    id,
    workspaceId,
    label: 'Abhaengigkeit',
    run: async () => {
      const { error } = await supabase.from('task_dependencies').delete().eq('id', id);
      if (error) throw error;
    },
  });
}
