// Cross-View-Drop-Helper (Phase 4 T.1.G.2.C + Q.1.c position-fix).
//
// Drag von einer Sicht (z.B. Sidebar-Tagesansicht-Event) in eine andere
// Sicht (Kanban-Spalte, Checkliste, NodeTree-Cell). Im Gegensatz zu
// manifestation-move.ts bleibt die Quell-Manifestation unangetastet —
// Cross-View ist additiv: ein und dieselbe Task erscheint danach in
// beiden Sichten gleichzeitig (das ist der ECS-Trick).
//
// Idempotenz: wenn die Task bereits eine Manifestation desselben Kinds
// im Zielcontainer hat, kein zweiter Insert (→ Toast „bereits vorhanden").
// Wenn sie eine Manifestation desselben Kinds in einem ANDEREN Container
// hat, schiebt der Helper diese um (Move) statt eine zweite anzulegen —
// User-Erwartung: „der Eintrag wandert", nicht „dupliziert".
//
// Q.1.c: targetPosition-Default lief vorher ueber `Date.now()` (13-
// stelliger Timestamp). Das kollidiert mit den 0/1/2/...-Positionen
// der bestehenden Manifestations: Reorder-Pfade rechnen mit dichten
// Indizes, Drag-Replay aus der Mutation-Queue verschiebt sich um den
// Replay-Zeitstempel statt um die Order-Intention. Stattdessen pflegt
// nextManifestationPosition (lib/tasks.ts) die korrekte naechste
// Position via DB-MAX bzw. IDB-Cache-Fallback.

import { translateDbError } from './errors';
import { addManifestation, moveManifestation, nextManifestationPosition } from './tasks';
import { showToast, showUndoToast } from './toasts';
import type { TaskManifestationRow } from './types';

type DropOnKanbanArgs = {
  workspaceId: string;
  taskId: string;
  taskLabel?: string;
  targetColId: string;
  targetPosition?: number; // optional, default ans Ende des Ziel-Containers
  // Bestaende fuer Idempotenz/Move-Detect.
  existingForTask: TaskManifestationRow[];
};

export async function dropOnKanbanCol(args: DropOnKanbanArgs): Promise<void> {
  const { workspaceId, taskId, targetColId, targetPosition, existingForTask } = args;
  const existingKanban = existingForTask.find((m) => m.kind === 'kanban');
  // Schon in dieser Spalte → No-Op mit Hinweis.
  if (existingKanban && existingKanban.container_id === targetColId) {
    showToast('Schon in dieser Spalte.', 'info');
    return;
  }
  // Existing in anderer Spalte → MOVE statt Add.
  if (existingKanban) {
    const oldContainer = existingKanban.container_id;
    const oldPosition = existingKanban.position;
    try {
      const pos = targetPosition ?? (await nextManifestationPosition(targetColId, 'kanban'));
      await moveManifestation(existingKanban.id, targetColId, pos);
      showUndoToast('Karte verschoben', () => {
        void moveManifestation(existingKanban.id, oldContainer, oldPosition).catch(() => {});
      });
    } catch (err) {
      console.error('dropOnKanbanCol (move):', err);
      showToast(translateDbError(err, 'Verschieben fehlgeschlagen.'), 'error');
    }
    return;
  }
  // Sonst: ADD eine neue Kanban-Manifestation.
  try {
    const pos = targetPosition ?? (await nextManifestationPosition(targetColId, 'kanban'));
    const created = await addManifestation(workspaceId, {
      atom_id: taskId,
      kind: 'kanban',
      container_id: targetColId,
      position: pos,
    });
    showUndoToast('Als Karte hinzugefuegt', () => {
      void import('./tasks').then(({ removeManifestation }) => {
        void removeManifestation(created.id).catch(() => {});
      });
    });
  } catch (err) {
    console.error('dropOnKanbanCol (add):', err);
    showToast(translateDbError(err, 'Hinzufuegen fehlgeschlagen.'), 'error');
  }
}

type DropOnChecklistArgs = {
  workspaceId: string;
  taskId: string;
  taskLabel?: string;
  targetChecklistId: string;
  targetPosition?: number;
  // Level fuer den neuen Eintrag — V1: default 0 (Top-Level). Spaeter
  // koennte der Drop-Handler auf Drop-Position-im-Tree den Level
  // ableiten (z.B. unter einem geoeffneten Knoten = level+1). Heute
  // ignorieren wir die Hierarchie und fuegen am Wurzel-Level ein.
  level?: number;
  existingForTask: TaskManifestationRow[];
};

export async function dropOnChecklist(args: DropOnChecklistArgs): Promise<void> {
  const { workspaceId, taskId, targetChecklistId, targetPosition, existingForTask } = args;
  const level = args.level ?? 0;
  const existingChecklist = existingForTask.find((m) => m.kind === 'checklist');
  if (existingChecklist && existingChecklist.container_id === targetChecklistId) {
    showToast('Schon in dieser Checkliste.', 'info');
    return;
  }
  if (existingChecklist) {
    const oldContainer = existingChecklist.container_id;
    const oldPosition = existingChecklist.position;
    try {
      const pos =
        targetPosition ?? (await nextManifestationPosition(targetChecklistId, 'checklist'));
      await moveManifestation(existingChecklist.id, targetChecklistId, pos);
      showUndoToast('Eintrag verschoben', () => {
        void moveManifestation(existingChecklist.id, oldContainer, oldPosition).catch(() => {});
      });
    } catch (err) {
      console.error('dropOnChecklist (move):', err);
      showToast(translateDbError(err, 'Verschieben fehlgeschlagen.'), 'error');
    }
    return;
  }
  try {
    const pos = targetPosition ?? (await nextManifestationPosition(targetChecklistId, 'checklist'));
    const created = await addManifestation(workspaceId, {
      atom_id: taskId,
      kind: 'checklist',
      container_id: targetChecklistId,
      position: pos,
      level,
    });
    showUndoToast('Als Checklisten-Punkt hinzugefuegt', () => {
      void import('./tasks').then(({ removeManifestation }) => {
        void removeManifestation(created.id).catch(() => {});
      });
    });
  } catch (err) {
    console.error('dropOnChecklist (add):', err);
    showToast(translateDbError(err, 'Hinzufuegen fehlgeschlagen.'), 'error');
  }
}
