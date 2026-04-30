// Smart-Summary-Widget pro Cell (Phase 4 T.1.E).
//
// Kompakter Pill-Block der die Task-Counts der Cell + Subtree anzeigt:
//   - Active-Bubble: open + in_progress + blocked (offene Aufgaben).
//   - Overdue-Bubble: nicht-erledigte Tasks mit deadline < heute.
//   - Due-Today-Bubble: nicht-erledigte Tasks mit deadline === heute.
//
// Erscheint im mx-cell-feats-Block neben den Feature-Chips. Bubbles
// werden nur gerendert, wenn ihr Count > 0 ist — leere Cells erzeugen
// keinen Visual-Noise.
//
// Tooltip (title-Attribut) zeigt die volle Status-Aufschluesselung.
// Click + a11y kommen mit T.1.F (Agenda-Filter pro Cell) — V1 ist
// reines Anzeige-Widget.

import { type Component, Show } from 'solid-js';
import type { CellTaskSummary as CellTaskSummaryData } from '../lib/task-aggregate';
import Icon from './Icon';

// Symbol vor dem Count: bewusst kompakt, da der Pill in der Cell eng
// zwischen Feature-Chips wohnt. Tooltip uebernimmt die Erklaerung.

type Props = {
  summary: CellTaskSummaryData;
};

function buildTooltip(s: CellTaskSummaryData): string {
  // Reihenfolge: am dringendsten zuerst.
  const lines: string[] = [];
  if (s.overdue > 0) lines.push(`${s.overdue}× ueberfaellig`);
  if (s.due_today > 0) lines.push(`${s.due_today}× heute faellig`);
  if (s.in_progress > 0) lines.push(`${s.in_progress}× in Arbeit`);
  if (s.blocked > 0) lines.push(`${s.blocked}× blockiert`);
  if (s.open > 0) lines.push(`${s.open}× offen`);
  if (s.done > 0) lines.push(`${s.done}× erledigt`);
  if (s.archived > 0) lines.push(`${s.archived}× archiviert`);
  if (lines.length === 0) return 'Keine Aufgaben';
  return lines.join(' · ');
}

const CellTaskSummary: Component<Props> = (p) => {
  const tooltip = () => buildTooltip(p.summary);
  // Render nur wenn IRGENDWAS sinnvolles drin ist. active 0 + overdue 0
  // + due_today 0 → der Pill-Block wuerde leer aussehen.
  const hasContent = () => p.summary.active > 0 || p.summary.overdue > 0 || p.summary.due_today > 0;

  return (
    <Show when={hasContent()}>
      <span class="mx-task-sum" title={tooltip()} aria-label={tooltip()}>
        <Show when={p.summary.overdue > 0}>
          <span class="mx-task-sum-pill mx-task-sum-overdue">
            <Icon name="flag" size={12} />
            {p.summary.overdue}
          </span>
        </Show>
        <Show when={p.summary.due_today > 0}>
          <span class="mx-task-sum-pill mx-task-sum-today">
            <Icon name="clock" size={12} />
            {p.summary.due_today}
          </span>
        </Show>
        <Show when={p.summary.active > 0}>
          <span class="mx-task-sum-pill mx-task-sum-active">
            <Icon name="list-bullet" size={12} />
            {p.summary.active}
          </span>
        </Show>
      </span>
    </Show>
  );
};

export default CellTaskSummary;
