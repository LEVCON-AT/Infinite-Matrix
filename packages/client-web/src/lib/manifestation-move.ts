// Manifestation-Move-Helper (Phase 4 T.1.G.2.B).
//
// Behandelt alle Move-Faelle aus dem Drag-Drop:
//
// 1. EXPLICIT Calendar-Manifestation (manifId vorhanden):
//    - Mini-Calendar-Tag-Drop → display_meta.start_date neu, end_date
//      mit Delta verschoben (Range bleibt erhalten).
//    - Hour-Slot-Drop → display_meta.time neu (+ start_date wenn
//      anderer Tag).
//
// 2. VIRTUAL (kein manifId — Event aus tasks.deadline gerendert):
//    - Mini-Calendar-Tag-Drop → setTaskDeadline(newDate). Damit folgt
//      das virtual-Event automatisch dem deadline.
//    - Hour-Slot-Drop → ADD eine explicit Calendar-Manifestation an
//      mit start_date + time.
//
// Toast mit Undo (revert auf altes display_meta bzw. altes deadline).

import { addDays, fromIso } from './calendar';
import { translateDbError } from './errors';
import {
  addManifestation,
  removeManifestation,
  setTaskDeadline,
  updateManifestation,
} from './tasks';
import { showToast, showUndoToast } from './toasts';
import type { TaskManifestationRow } from './types';

type MoveByDateArgs = {
  workspaceId: string;
  taskId: string;
  manifId?: string;
  // currentManif liefert das aktuelle display_meta — wird vom Aufrufer
  // mitgegeben (er hat es eh schon im Render-State). Bei virtual-
  // Events: undefined.
  currentManif?: TaskManifestationRow;
  // Aktuelle deadline des Tasks (fuer virtual-Fallback).
  currentDeadline?: string | null;
  newDate: string; // 'YYYY-MM-DD'
};

export async function moveByDate(args: MoveByDateArgs): Promise<void> {
  const {
    workspaceId: _workspaceId,
    taskId,
    manifId,
    currentManif,
    currentDeadline,
    newDate,
  } = args;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
    showToast('Ungueltiges Datum.', 'error');
    return;
  }

  // Fall 1: explicit manifestation.
  if (manifId && currentManif) {
    const dm = (currentManif.display_meta ?? {}) as Record<string, unknown>;
    const oldStart = (dm.start_date as string | undefined) ?? currentDeadline ?? newDate;
    const oldEnd = (dm.end_date as string | undefined) ?? null;
    if (oldStart === newDate) return; // No-op
    const dayDelta = daysBetween(oldStart, newDate);
    const nextMeta: Record<string, unknown> = { ...dm, start_date: newDate };
    if (oldEnd) {
      nextMeta.end_date = addDays(oldEnd, dayDelta);
    }
    try {
      await updateManifestation(manifId, { display_meta: nextMeta });
      showUndoToast('Termin verschoben', () => {
        void updateManifestation(manifId, { display_meta: dm }).catch(() => {
          /* undo-Failure ist nicht kritisch */
        });
      });
    } catch (err) {
      console.error('moveByDate (manif):', err);
      showToast(translateDbError(err, 'Verschieben fehlgeschlagen.'), 'error');
    }
    return;
  }

  // Fall 2: virtual (kein manifId) — task.deadline aendern.
  const oldDeadline = currentDeadline ?? null;
  if (oldDeadline === newDate) return;
  try {
    await setTaskDeadline(taskId, newDate);
    showUndoToast('Deadline verschoben', () => {
      void setTaskDeadline(taskId, oldDeadline).catch(() => {
        /* undo-Failure ist nicht kritisch */
      });
    });
  } catch (err) {
    console.error('moveByDate (virtual):', err);
    showToast(translateDbError(err, 'Verschieben fehlgeschlagen.'), 'error');
  }
}

type MoveByTimeArgs = {
  workspaceId: string;
  taskId: string;
  manifId?: string;
  currentManif?: TaskManifestationRow;
  // Tag in dem das Hour-Slot liegt — wenn anders als bisheriger
  // start_date, schiebt sich auch das Datum.
  dayIso: string;
  newTime: string; // 'HH:MM'
};

export async function moveByTime(args: MoveByTimeArgs): Promise<void> {
  const { workspaceId, taskId, manifId, currentManif, dayIso, newTime } = args;
  if (!/^\d{2}:\d{2}$/.test(newTime)) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayIso)) return;

  // Fall 1: explicit manifestation — update time + (if needed) start_date.
  if (manifId && currentManif) {
    const dm = (currentManif.display_meta ?? {}) as Record<string, unknown>;
    const oldStart = (dm.start_date as string | undefined) ?? null;
    const oldTime = (dm.time as string | undefined) ?? null;
    if (oldStart === dayIso && oldTime === newTime) return;
    const oldEnd = (dm.end_date as string | undefined) ?? null;
    const nextMeta: Record<string, unknown> = { ...dm, time: newTime, start_date: dayIso };
    if (oldEnd && oldStart) {
      // Range-Delta (Tage) erhalten.
      const dayDelta = daysBetween(oldStart, dayIso);
      nextMeta.end_date = addDays(oldEnd, dayDelta);
    }
    try {
      await updateManifestation(manifId, { display_meta: nextMeta });
      showUndoToast('Termin verschoben', () => {
        void updateManifestation(manifId, { display_meta: dm }).catch(() => {});
      });
    } catch (err) {
      console.error('moveByTime (manif):', err);
      showToast(translateDbError(err, 'Verschieben fehlgeschlagen.'), 'error');
    }
    return;
  }

  // Fall 2: virtual — wir promoten zur explicit Manifestation, weil
  // tasks.deadline keine time speichern kann. Resultat: neue Calendar-
  // Manifestation mit start_date=dayIso + time=newTime; deadline bleibt
  // unveraendert (User koennte das spaeter selbst aendern).
  try {
    const created = await addManifestation(workspaceId, {
      atom_id: taskId,
      kind: 'calendar',
      display_meta: { start_date: dayIso, time: newTime },
    });
    showUndoToast('Termin angelegt', () => {
      void removeManifestation(created.id).catch(() => {});
    });
  } catch (err) {
    console.error('moveByTime (virtual→add):', err);
    showToast(translateDbError(err, 'Anlegen fehlgeschlagen.'), 'error');
  }
}

function daysBetween(fromIsoStr: string, toIsoStr: string): number {
  const a = fromIso(fromIsoStr).getTime();
  const b = fromIso(toIsoStr).getTime();
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}
