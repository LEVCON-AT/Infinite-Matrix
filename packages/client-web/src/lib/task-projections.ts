// Task-Layer Projections (Phase 4 T.1.D — Native Datenfluss)
//
// Verantwortung:
//   Daten leben ausschliesslich in `tasks` + `task_manifestations`.
//   Diese Datei mappt zwischen der DB-nahen ECS-Form (TaskRow +
//   TaskManifestationRow) und der Legacy-UI-Form (KbCardRow /
//   ChecklistItemRow), die BoardView/ChecklistPanel/CardOverlay/etc.
//   noch konsumieren. Sobald T.1.D5-T.1.D7 die UI auf die compound
//   form (KanbanCard / ChecklistEntry) umstellen, schmelzen die
//   `to*Row()`-Projektionen auf 1:1-Zuweisungen ein und diese Datei
//   verschwindet (T.1.D8).
//
// Mapping-Tabelle (kb_cards):
//   task.id                    → KbCardRow.id           (1:1 durch Migration 041)
//   task.label                 → KbCardRow.name
//   task.note                  → KbCardRow.note         (null → '')
//   task.status === 'done'     → KbCardRow.done
//   task.status === 'archived' → KbCardRow.archived
//   task.deadline              → KbCardRow.deadline
//   task.who                   → KbCardRow.who
//   task.recur                 → KbCardRow.recur
//   task.done_occurrences      → KbCardRow.done_occurrences
//   manif.container_id         → KbCardRow.col_id
//   manif.position             → KbCardRow.position
//   manif.display_meta.board_id → KbCardRow.board_id
//   task.attrs.priority        → KbCardRow.priority
//   task.attrs.tags            → KbCardRow.tags         (default [])
//   task.attrs.alias           → KbCardRow.alias
//   task.attrs.color           → KbCardRow.color
//   task.attrs.checklist_inline → KbCardRow.checklist
//   task.attrs.checklist_ref   → KbCardRow.checklist_ref
//   task.attrs.source_cl_id    → KbCardRow.source_cl_id
//   task.attrs.source_label    → KbCardRow.source_label
//
// Mapping-Tabelle (checklist_items):
//   task.id                    → ChecklistItemRow.id    (1:1 durch Migration 041)
//   task.label                 → ChecklistItemRow.text
//   task.status === 'done'     → ChecklistItemRow.done
//   manif.container_id         → ChecklistItemRow.checklist_id
//   manif.position             → ChecklistItemRow.position
//   manif.level                → ChecklistItemRow.level

import type {
  CardRecur,
  ChecklistItemRow,
  InlineChecklistItem,
  KbCardRow,
  TaskManifestationRow,
  TaskRow,
} from './types';

// ─── Projektionen: TaskRow + ManifRow → Legacy-UI-Form ─────────

export function taskAndManifToCard(task: TaskRow, manif: TaskManifestationRow): KbCardRow {
  const a = task.attrs ?? {};
  return {
    id: task.id,
    workspace_id: task.workspace_id,
    board_id: ((manif.display_meta as Record<string, unknown> | null)?.board_id as string) ?? '',
    col_id: manif.container_id ?? '',
    alias: (a.alias as string | null | undefined) ?? null,
    name: task.label,
    note: task.note ?? '',
    tags: ((a.tags as string[] | undefined) ?? []) as string[],
    who: task.who ?? [],
    deadline: task.deadline,
    priority: (a.priority as number | null | undefined) ?? null,
    done: task.status === 'done',
    archived: task.status === 'archived',
    position: manif.position,
    recur: (task.recur ?? null) as Record<string, unknown> | null,
    done_occurrences: task.done_occurrences ?? [],
    source_cl_id: (a.source_cl_id as string | null | undefined) ?? null,
    source_label: (a.source_label as string | null | undefined) ?? null,
    checklist_ref: (a.checklist_ref as string | null | undefined) ?? null,
    checklist: (a.checklist_inline as InlineChecklistItem[] | null | undefined) ?? null,
    color: (a.color as string | null | undefined) ?? null,
    created_at: task.created_at,
    updated_at: task.updated_at,
  };
}

export function taskAndManifToItem(task: TaskRow, manif: TaskManifestationRow): ChecklistItemRow {
  return {
    id: task.id,
    workspace_id: task.workspace_id,
    checklist_id: manif.container_id ?? '',
    text: task.label,
    done: task.status === 'done',
    level: (manif.level ?? 0) as 0 | 1 | 2,
    position: manif.position,
  };
}

// ─── Inverse: Legacy-Snapshot → Task + Manifestation ───────────
// Brauchen wir fuer Undo (restoreCard, restoreChecklistItem). Der
// Snapshot ist die Legacy-Row-Form, daraus rekonstruieren wir Task
// + Manifestation, die dann ueber lib/tasks.ts neu eingespielt werden.

export function cardSnapshotToTaskAndManif(snap: KbCardRow): {
  task: TaskRow;
  manif: TaskManifestationRow;
} {
  const status = snap.archived ? 'archived' : snap.done ? 'done' : 'open';
  const attrs: Record<string, unknown> = {
    legacy_kind: 'kb_card',
  };
  if (snap.priority != null) attrs.priority = snap.priority;
  if (snap.tags && snap.tags.length > 0) attrs.tags = snap.tags;
  if (snap.alias != null) attrs.alias = snap.alias;
  if (snap.color != null) attrs.color = snap.color;
  if (snap.checklist != null) attrs.checklist_inline = snap.checklist;
  if (snap.checklist_ref != null) attrs.checklist_ref = snap.checklist_ref;
  if (snap.source_cl_id != null) attrs.source_cl_id = snap.source_cl_id;
  if (snap.source_label != null) attrs.source_label = snap.source_label;

  const task: TaskRow = {
    id: snap.id,
    workspace_id: snap.workspace_id,
    label: snap.name,
    note: snap.note ?? null,
    status,
    deadline: snap.deadline,
    who: snap.who ?? [],
    recur: (snap.recur ?? null) as CardRecur | null,
    done_occurrences: snap.done_occurrences ?? [],
    attrs,
    created_at: snap.created_at,
    created_by: null,
    updated_at: snap.updated_at,
  };

  // Manifestation bekommt eine *neue* id beim Restore — wir nehmen die
  // task.id-basierte Synth-Id, falls der Caller keine kennt. Wenn der
  // Snapshot eine bekannte manif-id im display_meta haette, koennten
  // wir die uebernehmen — aber Legacy-Snapshots wissen nichts von
  // Manifestations. Synth-Id reicht.
  const manif: TaskManifestationRow = {
    id: `${snap.id}-kanban`, // Synth — DB vergibt beim Replay eine echte UUID
    task_id: snap.id,
    workspace_id: snap.workspace_id,
    kind: 'kanban',
    container_id: snap.col_id,
    position: snap.position,
    level: null,
    display_meta: { board_id: snap.board_id },
    created_at: snap.created_at,
  };

  return { task, manif };
}

export function itemSnapshotToTaskAndManif(snap: ChecklistItemRow): {
  task: TaskRow;
  manif: TaskManifestationRow;
} {
  const task: TaskRow = {
    id: snap.id,
    workspace_id: snap.workspace_id,
    label: snap.text,
    note: null,
    status: snap.done ? 'done' : 'open',
    deadline: null,
    who: [],
    recur: null,
    done_occurrences: [],
    attrs: { legacy_kind: 'checklist_item' },
    created_at: new Date().toISOString(),
    created_by: null,
    updated_at: new Date().toISOString(),
  };

  const manif: TaskManifestationRow = {
    id: `${snap.id}-checklist`,
    task_id: snap.id,
    workspace_id: snap.workspace_id,
    kind: 'checklist',
    container_id: snap.checklist_id,
    position: snap.position,
    level: snap.level,
    display_meta: {},
    created_at: new Date().toISOString(),
  };

  return { task, manif };
}

// ─── Patch-Splitter: Legacy-CardPatch → TaskPatch + ManifPatch + AttrsMerge ───
// Aufrufer in mutations.ts uebergibt einen Mix aus Task-Feldern (name,
// done, deadline, ...), Manifestation-Feldern (col_id, position,
// board_id) und Attrs-Feldern (priority, tags, alias, color, ...) —
// wir teilen ihn auf, damit jede Schicht ihren eigenen Update bekommt.
//
// `attrs` ist ein PARTIAL-Merge: nur die im Patch erwaehnten Schluessel
// werden in den existierenden attrs-Record reingeschrieben (der
// Aufrufer in mutations.ts liest den aktuellen task.attrs frisch vor
// dem Update). null-Werte loeschen den Schluessel (jsonb_strip_nulls
// auf der DB ist nicht aktiv — wir muessen explizit den Key entfernen).

export type CardPatchInput = Partial<{
  name: string;
  note: string | null;
  alias: string | null;
  done: boolean;
  archived: boolean;
  deadline: string | null;
  priority: number | null;
  tags: string[];
  who: string[];
  recur: CardRecur | null;
  color: string | null;
  position: number;
  col_id: string;
  board_id: string;
  checklist: InlineChecklistItem[] | null;
  checklist_ref: string | null;
  source_cl_id: string | null;
  source_label: string | null;
  done_occurrences: string[];
}>;

export type SplitCardPatch = {
  taskPatch: Record<string, unknown>;
  manifPatch: Record<string, unknown>;
  attrsMerge: Record<string, unknown> | null;
  hasManifChange: boolean;
  hasAttrsChange: boolean;
  hasTaskChange: boolean;
};

export function splitCardPatch(patch: CardPatchInput): SplitCardPatch {
  const taskPatch: Record<string, unknown> = {};
  const manifPatch: Record<string, unknown> = {};
  const attrsMerge: Record<string, unknown> = {};

  if ('name' in patch) taskPatch.label = patch.name;
  if ('note' in patch) taskPatch.note = patch.note ?? null;
  if ('deadline' in patch) taskPatch.deadline = patch.deadline ?? null;
  if ('who' in patch) taskPatch.who = patch.who ?? [];
  if ('recur' in patch) taskPatch.recur = patch.recur ?? null;
  if ('done_occurrences' in patch) taskPatch.done_occurrences = patch.done_occurrences ?? [];

  // Status: done UND archived sind boolean-Toggles, die alle in das
  // Status-Enum projizieren. Beide in einem Patch ist denkbar
  // (z.B. setArchived(false) + done unveraendert) — letzter gewinnt.
  if ('archived' in patch) {
    taskPatch.status = patch.archived ? 'archived' : 'open';
  }
  if ('done' in patch) {
    // archived geht vor (User kann archivierte Karten nicht "abhaken").
    if (taskPatch.status !== 'archived') {
      taskPatch.status = patch.done ? 'done' : 'open';
    }
  }

  // Manifestation-Felder.
  if ('col_id' in patch) manifPatch.container_id = patch.col_id;
  if ('position' in patch) manifPatch.position = patch.position;
  // board_id sitzt in display_meta — Caller muss display_meta aus dem
  // bestehenden Manif lesen + mergen. Wir signalisieren das ueber
  // einen separaten Schluessel.
  if ('board_id' in patch) manifPatch.__board_id = patch.board_id;

  // Attrs-Felder.
  if ('priority' in patch) attrsMerge.priority = patch.priority;
  if ('tags' in patch) attrsMerge.tags = patch.tags ?? [];
  if ('alias' in patch) attrsMerge.alias = patch.alias;
  if ('color' in patch) attrsMerge.color = patch.color;
  if ('checklist' in patch) attrsMerge.checklist_inline = patch.checklist;
  if ('checklist_ref' in patch) attrsMerge.checklist_ref = patch.checklist_ref;
  if ('source_cl_id' in patch) attrsMerge.source_cl_id = patch.source_cl_id;
  if ('source_label' in patch) attrsMerge.source_label = patch.source_label;

  return {
    taskPatch,
    manifPatch,
    attrsMerge: Object.keys(attrsMerge).length > 0 ? attrsMerge : null,
    hasManifChange: Object.keys(manifPatch).length > 0,
    hasAttrsChange: Object.keys(attrsMerge).length > 0,
    hasTaskChange: Object.keys(taskPatch).length > 0,
  };
}

export type ItemPatchInput = Partial<{
  text: string;
  done: boolean;
  level: 0 | 1 | 2;
  position: number;
}>;

export type SplitItemPatch = {
  taskPatch: Record<string, unknown>;
  manifPatch: Record<string, unknown>;
  hasTaskChange: boolean;
  hasManifChange: boolean;
};

export function splitItemPatch(patch: ItemPatchInput): SplitItemPatch {
  const taskPatch: Record<string, unknown> = {};
  const manifPatch: Record<string, unknown> = {};

  if ('text' in patch) taskPatch.label = patch.text;
  if ('done' in patch) taskPatch.status = patch.done ? 'done' : 'open';

  if ('level' in patch) manifPatch.level = patch.level;
  if ('position' in patch) manifPatch.position = patch.position;

  return {
    taskPatch,
    manifPatch,
    hasTaskChange: Object.keys(taskPatch).length > 0,
    hasManifChange: Object.keys(manifPatch).length > 0,
  };
}

// Merge-Helper fuer attrs: existierende attrs + Patch-Merge → neuer
// Attrs-Record. null-Werte aus dem Merge loeschen den Schluessel
// (Konvention "patch=null heisst loeschen").
export function mergeAttrs(
  current: Record<string, unknown>,
  merge: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...current };
  for (const [k, v] of Object.entries(merge)) {
    if (v === null || v === undefined) {
      delete next[k];
    } else {
      next[k] = v;
    }
  }
  return next;
}
