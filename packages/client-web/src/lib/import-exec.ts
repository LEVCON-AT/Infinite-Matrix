// Fuehrt einen ImportPlan gegen Supabase aus. Append in den angegebenen
// Workspace. Reihenfolge respektiert FK-Abhaengigkeiten:
//   1. nodes (ohne parent_cell_id)
//   2. rows, cols
//   3. kb_cols
//   4. checklists → checklist_items
//   5. cells (mit FKs auf rows/cols/nodes)
//   6. kb_cards (mit FKs auf kb_cols + checklists)
//   7. links
//   8. UPDATE nodes.parent_cell_id
//
// Fehler im Insert brechen ab und werfen — Teil-Importe bleiben. User bekommt
// Toast, kann Workspace manuell bereinigen oder neu importieren.

import type { ImportPlan } from './import-types';
import { supabase } from './supabase';

export type ImportProgressEvent = {
  step: string;
  current: number;
  total: number;
};

export type ImportProgressFn = (ev: ImportProgressEvent) => void;

export class ImportExecError extends Error {
  public step: string;
  public cause: unknown;
  constructor(step: string, cause: unknown) {
    const msg = cause instanceof Error ? cause.message : JSON.stringify(cause);
    super(`Import-Schritt "${step}" fehlgeschlagen: ${msg}`);
    this.name = 'ImportExecError';
    this.step = step;
    this.cause = cause;
  }
}

// Hilfsfunktion: Batched insert mit Fortschritts-Reporting.
async function insertBatch<T extends Record<string, unknown>>(
  table: string,
  rows: T[],
  step: string,
  onProgress: ImportProgressFn | undefined,
  batchSize = 200,
): Promise<void> {
  if (rows.length === 0) {
    onProgress?.({ step, current: 0, total: 0 });
    return;
  }
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const { error } = await supabase.from(table).insert(chunk);
    if (error) throw new ImportExecError(step, error);
    onProgress?.({
      step,
      current: Math.min(i + chunk.length, rows.length),
      total: rows.length,
    });
  }
}

export async function executeImport(
  plan: ImportPlan,
  workspaceId: string,
  onProgress?: ImportProgressFn,
): Promise<void> {
  const ws = workspaceId;

  // 1) nodes (parent_cell_id bewusst NULL am Anfang)
  await insertBatch(
    'nodes',
    plan.nodes.map((n) => ({
      id: n.id,
      workspace_id: ws,
      type: n.type,
      label: n.label,
      alias: n.alias,
      parent_cell_id: null,
      data: n.data,
    })),
    'nodes',
    onProgress,
  );

  // 2a) rows
  await insertBatch(
    'rows',
    plan.rows.map((r) => ({
      id: r.id,
      workspace_id: ws,
      matrix_id: r.matrix_id,
      label: r.label,
      position: r.position,
    })),
    'rows',
    onProgress,
  );

  // 2b) cols
  await insertBatch(
    'cols',
    plan.cols.map((c) => ({
      id: c.id,
      workspace_id: ws,
      matrix_id: c.matrix_id,
      label: c.label,
      position: c.position,
    })),
    'cols',
    onProgress,
  );

  // 3) kb_cols
  await insertBatch(
    'kb_cols',
    plan.kbCols.map((c) => ({
      id: c.id,
      workspace_id: ws,
      board_id: c.board_id,
      label: c.label,
      position: c.position,
      color: c.color,
    })),
    'kb_cols',
    onProgress,
  );

  // 4a) checklists
  await insertBatch(
    'checklists',
    plan.checklists.map((c) => ({
      id: c.id,
      workspace_id: ws,
      board_id: c.board_id,
      label: c.label,
      position: c.position,
      recur: c.recur,
      close_mode: c.close_mode,
      action: c.action,
      history: c.history,
      alias: c.alias,
    })),
    'checklists',
    onProgress,
  );

  // 4b) Phase 4 T.1.D: checklist_items → tasks + task_manifestations.
  await insertBatch(
    'tasks',
    plan.checklistItems.map((it) => ({
      id: it.id,
      workspace_id: ws,
      label: it.text,
      status: it.done ? 'done' : 'open',
      attrs: { legacy_kind: 'checklist_item' },
    })),
    'tasks',
    onProgress,
  );
  await insertBatch(
    'task_manifestations',
    plan.checklistItems.map((it) => ({
      task_id: it.id,
      workspace_id: ws,
      kind: 'checklist',
      container_id: it.checklist_id,
      level: it.level,
      position: it.position,
    })),
    'task_manifestations',
    onProgress,
  );

  // 5) cells
  await insertBatch(
    'cells',
    plan.cells.map((c) => ({
      id: c.id,
      workspace_id: ws,
      matrix_id: c.matrix_id,
      row_id: c.row_id,
      col_id: c.col_id,
      alias: c.alias,
      features: c.features,
      child_matrix_id: c.child_matrix_id,
      board_id: c.board_id,
      data: c.data,
    })),
    'cells',
    onProgress,
  );

  // 6) Phase 4 T.1.D: kb_cards → tasks + task_manifestations.
  //    Karten-Feldern auf tasks/attrs/manifestation aufgeteilt
  //    (siehe lib/task-projections.ts fuer das Mapping).
  await insertBatch(
    'tasks',
    plan.kbCards.map((c) => {
      const status = c.archived ? 'archived' : c.done ? 'done' : 'open';
      const attrs: Record<string, unknown> = { legacy_kind: 'kb_card' };
      if (c.priority != null) attrs.priority = c.priority;
      if (c.tags && c.tags.length > 0) attrs.tags = c.tags;
      if (c.alias != null) attrs.alias = c.alias;
      if (c.checklist != null) attrs.checklist_inline = c.checklist;
      if (c.checklist_ref != null) attrs.checklist_ref = c.checklist_ref;
      if (c.source_cl_id != null) attrs.source_cl_id = c.source_cl_id;
      if (c.source_label != null) attrs.source_label = c.source_label;
      return {
        id: c.id,
        workspace_id: ws,
        label: c.name,
        note: c.note ?? null,
        status,
        deadline: c.deadline,
        who: c.who ?? [],
        recur: c.recur,
        done_occurrences: c.done_occurrences ?? [],
        attrs,
      };
    }),
    'tasks',
    onProgress,
  );
  await insertBatch(
    'task_manifestations',
    plan.kbCards.map((c) => ({
      task_id: c.id,
      workspace_id: ws,
      kind: 'kanban',
      container_id: c.col_id,
      position: c.position,
      display_meta: { board_id: c.board_id },
    })),
    'task_manifestations',
    onProgress,
  );

  // 7) links
  await insertBatch(
    'links',
    plan.links.map((l) => ({
      id: l.id,
      workspace_id: ws,
      board_id: l.board_id,
      type: l.type,
      label: l.label,
      url: l.url,
      alias: l.alias,
      position: l.position,
      data: l.data,
    })),
    'links',
    onProgress,
  );

  // 8) UPDATE nodes.parent_cell_id
  // Kein Bulk-Update in supabase-js — pro Eintrag ein update-Call.
  // Bei vielen Nested-Nodes wird das spuerbar; akzeptabel fuer Phase 0.
  const updates = plan.parentCellUpdates;
  let i = 0;
  for (const u of updates) {
    const { error } = await supabase
      .from('nodes')
      .update({ parent_cell_id: u.parentCellId })
      .eq('id', u.nodeId)
      .eq('workspace_id', ws);
    if (error) throw new ImportExecError('parent_cell_id-Update', error);
    i++;
    onProgress?.({
      step: 'parent_cell_id-Update',
      current: i,
      total: updates.length,
    });
  }
}
