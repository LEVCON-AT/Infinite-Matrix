// Smart-Summary-Widget pro Cell (Phase 4 T.1.E + T.1.E.2).
//
// Ein einziger laenglicher Container statt drei separater Pills — klar
// abgesetzt von Feature-Chips (die sind farbig + 22×22 quadratisch).
// Inhalt:
//   - Status-Cluster (Counts) mit Mid-Dot-Trennern: nur sichtbar bei
//     count > 0.
//       overdue:   flag-Icon (rot) + Zahl in --text
//       due_today: clock-Icon (amber) + Zahl in --text
//       active:    list-bullet-Icon (teal) + Zahl in --text
//   - Gap vor dem Chevron (Variante A des UX-Vorschlags) — Whitespace
//     allein kommuniziert die Trennung „Daten vs. Action".
//   - chevron-right (12px) in --text3, damit klar wird: das ist ein
//     Action-Indikator, nicht eine weitere Daten-Zelle.
//
// Click oeffnet die Stub-Page /w/:wsId/c/:cellId/summary (T.1.E.2);
// dort wird in der Folge-Welle T.SS das eigentliche Dashboard
// implementiert. KEIN title-Tooltip — aria-label fuer Screen-Reader.

import { useNavigate } from '@solidjs/router';
import { type Component, Show } from 'solid-js';
import type { CellTaskSummary as CellTaskSummaryData } from '../lib/task-aggregate';
import Icon from './Icon';

type Props = {
  workspaceId: string;
  cellId: string;
  summary: CellTaskSummaryData;
};

function buildAriaLabel(s: CellTaskSummaryData): string {
  // Reihenfolge: am dringendsten zuerst.
  const lines: string[] = [];
  if (s.overdue > 0) lines.push(`${s.overdue} ueberfaellig`);
  if (s.due_today > 0) lines.push(`${s.due_today} heute faellig`);
  if (s.active > 0) lines.push(`${s.active} offen`);
  if (lines.length === 0) return 'Smart Summary oeffnen';
  return `${lines.join(', ')} — Smart Summary oeffnen`;
}

const CellTaskSummary: Component<Props> = (p) => {
  const navigate = useNavigate();

  // Render nur wenn IRGENDWAS sinnvolles drin ist. active 0 + overdue 0
  // + due_today 0 → der Container wuerde leer aussehen (nur Chevron).
  const hasContent = () => p.summary.active > 0 || p.summary.overdue > 0 || p.summary.due_today > 0;

  // Mid-Dot zwischen Counts: nur einfuegen wenn DAVOR ein anderer Count
  // steht. Verhindert „· 5 active" bei nur active.
  const showDotBeforeToday = () => p.summary.overdue > 0 && p.summary.due_today > 0;
  const showDotBeforeActive = () =>
    (p.summary.overdue > 0 || p.summary.due_today > 0) && p.summary.active > 0;

  function onClick(e: MouseEvent) {
    // stopPropagation — Cell-Hintergrund hat im Edit-Mode einen eigenen
    // onClick-Handler (Overlay). Smart-Summary-Click ist eigene Aktion.
    e.stopPropagation();
    navigate(`/w/${p.workspaceId}/c/${p.cellId}/summary`);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      navigate(`/w/${p.workspaceId}/c/${p.cellId}/summary`);
    }
  }

  return (
    <Show when={hasContent()}>
      <button
        type="button"
        class="mx-task-sum"
        aria-label={buildAriaLabel(p.summary)}
        onClick={onClick}
        onKeyDown={onKeyDown}
      >
        <span class="mx-task-sum-counts">
          <Show when={p.summary.overdue > 0}>
            <span class="mx-task-sum-count mx-task-sum-overdue">
              <Icon name="flag" size={12} />
              <span class="mx-task-sum-num">{p.summary.overdue}</span>
            </span>
          </Show>
          <Show when={showDotBeforeToday()}>
            <span class="mx-task-sum-dot" aria-hidden="true">
              ·
            </span>
          </Show>
          <Show when={p.summary.due_today > 0}>
            <span class="mx-task-sum-count mx-task-sum-today">
              <Icon name="clock" size={12} />
              <span class="mx-task-sum-num">{p.summary.due_today}</span>
            </span>
          </Show>
          <Show when={showDotBeforeActive()}>
            <span class="mx-task-sum-dot" aria-hidden="true">
              ·
            </span>
          </Show>
          <Show when={p.summary.active > 0}>
            <span class="mx-task-sum-count mx-task-sum-active">
              <Icon name="list-bullet" size={12} />
              <span class="mx-task-sum-num">{p.summary.active}</span>
            </span>
          </Show>
        </span>
        <span class="mx-task-sum-chev" aria-hidden="true">
          <Icon name="chevron-right" size={12} />
        </span>
      </button>
    </Show>
  );
};

export default CellTaskSummary;
