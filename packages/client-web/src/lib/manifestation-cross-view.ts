// Cross-View-Drop-Helper (Phase 4 T.1.G.2.C).
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

import { translateDbError } from './errors';
import { addManifestation, moveManifestation } from './tasks';
import { showToast, showUndoToast } from './toasts';
import type { TaskManifestationRow } from './types';

type DropOnKanbanArgs = {
  workspaceId: string;
  taskId: string;
  taskLabel?: string;
  targetColId: string;
  targetPosition?: number; // optional, default ans Ende
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
      await moveManifestation(
        existingKanban.id,
        targetColId,
        targetPosition ?? Date.now(), // grosse Zahl → ans Ende; Re-Number macht moveCard nicht, das ist V1-pragmatisch
      );
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
    const created = await addManifestation(workspaceId, {
      task_id: taskId,
      kind: 'kanban',
      container_id: targetColId,
      position: targetPosition ?? Date.now(),
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
  existingForTask: TaskManifestationRow[];
};

export async function dropOnChecklist(args: DropOnChecklistArgs): Promise<void> {
  const { workspaceId, taskId, targetChecklistId, targetPosition, existingForTask } = args;
  const existingChecklist = existingForTask.find((m) => m.kind === 'checklist');
  if (existingChecklist && existingChecklist.container_id === targetChecklistId) {
    showToast('Schon in dieser Checkliste.', 'info');
    return;
  }
  if (existingChecklist) {
    const oldContainer = existingChecklist.container_id;
    const oldPosition = existingChecklist.position;
    try {
      await moveManifestation(
        existingChecklist.id,
        targetChecklistId,
        targetPosition ?? Date.now(),
      );
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
    const created = await addManifestation(workspaceId, {
      task_id: taskId,
      kind: 'checklist',
      container_id: targetChecklistId,
      position: targetPosition ?? Date.now(),
      level: 0,
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
