// Cell-Task-Aggregation fuer Smart-Summary-Widget (Phase 4 T.1.E).
//
// Pro Cell rekursiv: alle Tasks deren Manifestations entweder
//  - kanban-kind sind und im Cell-Board liegen (display_meta.board_id),
//  - checklist-kind sind und in einer Cell-attached Checkliste liegen,
//  - oder transitiv ueber Sub-Matrizen / Sub-Boards der Zelle.
//
// Status-Buckets richten sich nach dem ECS-Modell (tasks.status enum):
//   open / in_progress / blocked / done / archived. Plus zwei
//   abgeleitete Hilfs-Counts:
//     - overdue:   nicht-erledigte Task mit deadline < heute
//     - due_today: nicht-erledigte Task mit deadline === heute
//
// `active` = open + in_progress + blocked (alle UI-relevanten offenen
// Stati). `total` = alle Stati inkl. done/archived. UI-Pills nutzen
// vor allem `active` + `overdue` + `due_today`.
//
// Pattern uebernommen aus aggregate.ts (Frequency-Aggregation), aber
// hier auf Tasks + Manifestations native, nicht auf KbCardRow-Projektion.

import type {
  CellRow,
  ChecklistRow,
  NodeRow,
  TaskManifestationRow,
  TaskRow,
  TaskStatus,
} from './types';

export type CellTaskSummary = {
  open: number;
  in_progress: number;
  blocked: number;
  done: number;
  archived: number;
  overdue: number;
  due_today: number;
  active: number; // = open + in_progress + blocked
  total: number; // alle inkl. done + archived
};

const EMPTY: CellTaskSummary = {
  open: 0,
  in_progress: 0,
  blocked: 0,
  done: 0,
  archived: 0,
  overdue: 0,
  due_today: 0,
  active: 0,
  total: 0,
};

function bumpSummary(s: CellTaskSummary, t: TaskRow, today: string): void {
  // Side-effect: mutiert s. Aufrufer hat exklusiven Besitz.
  s.total += 1;
  switch (t.status as TaskStatus) {
    case 'open':
      s.open += 1;
      s.active += 1;
      break;
    case 'in_progress':
      s.in_progress += 1;
      s.active += 1;
      break;
    case 'blocked':
      s.blocked += 1;
      s.active += 1;
      break;
    case 'done':
      s.done += 1;
      break;
    case 'archived':
      s.archived += 1;
      break;
  }
  // Overdue / due_today: nur Tasks mit deadline UND nicht abgeschlossen.
  if (t.deadline && t.status !== 'done' && t.status !== 'archived') {
    if (t.deadline < today) s.overdue += 1;
    else if (t.deadline === today) s.due_today += 1;
  }
}

function emptySummary(): CellTaskSummary {
  return { ...EMPTY };
}

// Hauptfunktion: Map<cellId, Summary> fuer alle Cells einer Matrix
// (rekursiv via descendant-Cells in Sub-Matrizen).
//
// Eingabe sind die workspace-weiten Datasets (tasks, manifestations,
// checklists, cells, nodes). Filter passieren intern. Fuer Performance
// indexen wir manifestations nach Container-IDs.
export function buildCellTaskSummaries(args: {
  matrixId: string;
  nodes: NodeRow[];
  cells: CellRow[];
  checklists: ChecklistRow[];
  tasks: TaskRow[];
  manifestations: TaskManifestationRow[];
  today: string; // ISO 'YYYY-MM-DD'
}): Map<string, CellTaskSummary> {
  const { matrixId, nodes, cells, checklists, tasks, manifestations, today } = args;

  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  // cells gruppiert nach matrix_id — fuer Sub-Matrix-Recursion.
  const cellsByMatrix = new Map<string, CellRow[]>();
  for (const c of cells) {
    const arr = cellsByMatrix.get(c.matrix_id) ?? [];
    arr.push(c);
    cellsByMatrix.set(c.matrix_id, arr);
  }

  // Manifestations indexen nach Kind+Container.
  // kanban: container_id = kb_col_id (NICHT board_id). Aggregation pro
  // Cell laeuft aber ueber board_id — wir packen sie deshalb in eine
  // Map nach board_id (aus display_meta), damit cell.board_id direkt
  // matched.
  const tasksByBoard = new Map<string, TaskRow[]>();
  const tasksByChecklist = new Map<string, TaskRow[]>();
  for (const m of manifestations) {
    if (m.atom_type !== 'task') continue;
    const t = taskById.get(m.atom_id);
    if (!t) continue;
    if (m.kind === 'kanban') {
      const bId = (m.display_meta as Record<string, unknown> | null)?.board_id as
        | string
        | undefined;
      if (!bId) continue;
      const arr = tasksByBoard.get(bId) ?? [];
      arr.push(t);
      tasksByBoard.set(bId, arr);
    } else if (m.kind === 'checklist') {
      const cId = m.container_id;
      if (!cId) continue;
      const arr = tasksByChecklist.get(cId) ?? [];
      arr.push(t);
      tasksByChecklist.set(cId, arr);
    }
  }

  // Cell-attached Checklisten gruppiert nach cell_id, damit wir pro
  // Cell die ihr direkt zugehoerigen Listen finden. Board-attached
  // Checklisten (board_id != null) zaehlen ueber board_id (s. unten).
  const checklistsByCell = new Map<string, ChecklistRow[]>();
  const checklistsByBoard = new Map<string, ChecklistRow[]>();
  for (const cl of checklists) {
    if (cl.cell_id) {
      const arr = checklistsByCell.get(cl.cell_id) ?? [];
      arr.push(cl);
      checklistsByCell.set(cl.cell_id, arr);
    } else if (cl.board_id) {
      const arr = checklistsByBoard.get(cl.board_id) ?? [];
      arr.push(cl);
      checklistsByBoard.set(cl.board_id, arr);
    }
  }

  // Cell-direkte Tasks: alle Tasks im Board (kanban) + in board-/cell-
  // attached Checklisten (checklist).
  function tasksDirectlyInCell(cell: CellRow): TaskRow[] {
    const out: TaskRow[] = [];
    if (cell.board_id) {
      const cards = tasksByBoard.get(cell.board_id);
      if (cards) out.push(...cards);
      const cls = checklistsByBoard.get(cell.board_id) ?? [];
      for (const cl of cls) {
        const items = tasksByChecklist.get(cl.id);
        if (items) out.push(...items);
      }
    }
    const cellLists = checklistsByCell.get(cell.id) ?? [];
    for (const cl of cellLists) {
      const items = tasksByChecklist.get(cl.id);
      if (items) out.push(...items);
    }
    return out;
  }

  // Recursive: alle Tasks im Subtree einer Zelle (direkt + sub-matrix).
  // Wir cache die Ergebnisse pro Cell, damit Wiederbesuche bei mehreren
  // Aufrufern (z.B. parent + grandparent) nicht jeden Mal rekursieren.
  const memo = new Map<string, TaskRow[]>();
  function tasksInCellSubtree(cell: CellRow): TaskRow[] {
    const cached = memo.get(cell.id);
    if (cached) return cached;
    const out = tasksDirectlyInCell(cell);
    if (cell.child_matrix_id) {
      const sub = nodeById.get(cell.child_matrix_id);
      if (sub && sub.type === 'matrix') {
        const subCells = cellsByMatrix.get(sub.id) ?? [];
        for (const sc of subCells) {
          out.push(...tasksInCellSubtree(sc));
        }
      }
    }
    memo.set(cell.id, out);
    return out;
  }

  // Build: walk this matrix + all descendant matrices, summary fuer
  // jede Cell. Wir fuellen rekursiv — auch Cells in Sub-Matrizen
  // bekommen ihren Eintrag, weil die Smart-Summary die in jeder
  // Matrix-Ebene zeigt.
  const result = new Map<string, CellTaskSummary>();
  function walkMatrix(mid: string): void {
    const mc = cellsByMatrix.get(mid) ?? [];
    for (const cell of mc) {
      const tasksInSub = tasksInCellSubtree(cell);
      if (tasksInSub.length === 0) {
        // Trotzdem leere Summary eintragen, damit Aufrufer
        // result.get(cellId) ?? EMPTY-Logik nicht braucht.
        // Optional: skip — wir skipen, weil "kein Eintrag" vom
        // UI als "nichts rendern" interpretiert werden kann
        // (active === 0 → kein Badge).
        continue;
      }
      const s = emptySummary();
      const seen = new Set<string>();
      for (const t of tasksInSub) {
        // Eine Task kann ueber mehrere Manifestations in derselben
        // Sub-Tree-Aggregation auftauchen (z.B. kanban+checklist
        // beide in derselben Cell). De-duplicaten via id.
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        bumpSummary(s, t, today);
      }
      result.set(cell.id, s);
      if (cell.child_matrix_id) walkMatrix(cell.child_matrix_id);
    }
  }
  walkMatrix(matrixId);
  return result;
}

// Helper fuer das Heute-Datum. Browser-lokale Zeit, ISO 'YYYY-MM-DD'.
export function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
