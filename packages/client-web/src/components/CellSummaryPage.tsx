// Smart-Summary-Stub-Page (Phase 4 T.1.E.2).
//
// Aufruf ueber /w/:wsId/c/:cellId/summary. Click-Ziel der Smart-Summary-
// Pill in MatrixView. Diese Page ist ein STUB — die Folge-Welle T.SS
// ueberschreibt den Inhalt mit dem echten Dashboard (Widgets, Sektionen,
// Filter, Edit-Mode-DnD). Schon hier:
//   - Cell-Breadcrumb-Header (analog CellInfoPage / CellChecklistsPage).
//   - Volle Status-Aufschluesselung der Tasks im Cell-Subtree (kein
//     Hover-Tooltip mehr).
//   - Hinweis-Box "kommt bald" + geplante Sektionen.
//   - Zurueck-zur-Matrix-Link.
//
// Aggregation reuse: buildCellTaskSummaries scoped auf cell.matrix_id,
// dann pro-cell-Lookup ueber summaries.get(cell.id).

import { useNavigate } from '@solidjs/router';
import { type Component, For, Show, createMemo } from 'solid-js';
import { pageEnter } from '../lib/animations';
import { installEscReturn } from '../lib/keyboard-nav';
import { buildCellTaskSummaries, todayIso } from '../lib/task-aggregate';
import type {
  CellRow,
  ChecklistRow,
  ColRow,
  NodeRow,
  RowRow,
  TaskManifestationRow,
  TaskRow,
} from '../lib/types';

type Props = {
  workspaceId: string;
  cell: CellRow;
  row: RowRow | undefined;
  col: ColRow | undefined;
  wsNodes: NodeRow[];
  wsCells: CellRow[];
  wsChecklists: ChecklistRow[];
  wsTasks: TaskRow[];
  wsManifestations: TaskManifestationRow[];
};

const PLANNED_SECTIONS: ReadonlyArray<{ title: string; desc: string }> = [
  {
    title: 'Kommende Tasks',
    desc: 'Tasks mit Deadline ab heute, sortiert nach Datum.',
  },
  {
    title: 'Anstehende Termine',
    desc: 'Calendar-Manifestations sortiert nach Datum/Uhrzeit.',
  },
  {
    title: 'Ueberfaellige Tasks',
    desc: 'Deadline < heute, Status nicht erledigt — mit Inline-Aktionen.',
  },
  {
    title: 'Haeufig aufgerufene Links',
    desc: 'Top-N Links nach Klick-Counter (Atom-Pattern).',
  },
  {
    title: 'Letzte Dokumentationen',
    desc: 'Top-N Docs nach updated_at, mit Snippet-Preview.',
  },
  {
    title: 'Activity-Stream',
    desc: 'Letzte Aenderungen + Kommentare im Cell-Subtree.',
  },
];

const CellSummaryPage: Component<Props> = (p) => {
  const navigate = useNavigate();

  const summary = createMemo(() => {
    const map = buildCellTaskSummaries({
      matrixId: p.cell.matrix_id,
      nodes: p.wsNodes,
      cells: p.wsCells,
      checklists: p.wsChecklists,
      tasks: p.wsTasks,
      manifestations: p.wsManifestations,
      today: todayIso(),
    });
    return map.get(p.cell.id);
  });

  const breadcrumb = () => {
    const r = p.row?.label || '(Zeile)';
    const c = p.col?.label || '(Spalte)';
    return `${r} × ${c}`;
  };

  const matrixHref = () => `/w/${p.workspaceId}/n/${p.cell.matrix_id}`;

  installEscReturn(() => navigate(matrixHref()));

  return (
    <div
      class="cell-info-page"
      ref={(el) => {
        pageEnter(el);
      }}
    >
      <header class="cell-page-head">
        <div class="cell-page-head-text">
          <h3>Smart Summary</h3>
          <a
            class="cell-page-sub cell-page-sub-link"
            href={matrixHref()}
            onClick={(e) => {
              e.preventDefault();
              navigate(matrixHref());
            }}
            title="Zur Matrix"
          >
            {breadcrumb()}
          </a>
          <Show when={p.cell.alias}>
            <span class="node-alias">^{p.cell.alias}</span>
          </Show>
        </div>
      </header>

      <section class="smart-summary-counts">
        <h4>Aufgaben in dieser Zelle und ihrer Unterstruktur</h4>
        <Show
          when={summary()}
          fallback={<p class="hint">Keine Aufgaben in dieser Zelle oder ihrem Subtree.</p>}
        >
          {(s) => (
            <ul class="smart-summary-list">
              <li>
                <span class="smart-summary-label">Offen</span>
                <span class="smart-summary-num">{s().open}</span>
              </li>
              <li>
                <span class="smart-summary-label">In Arbeit</span>
                <span class="smart-summary-num">{s().in_progress}</span>
              </li>
              <li>
                <span class="smart-summary-label">Blockiert</span>
                <span class="smart-summary-num">{s().blocked}</span>
              </li>
              <li class="smart-summary-divider" aria-hidden="true" />
              <li classList={{ 'smart-summary-warn': s().due_today > 0 }}>
                <span class="smart-summary-label">Heute faellig</span>
                <span class="smart-summary-num">{s().due_today}</span>
              </li>
              <li classList={{ 'smart-summary-danger': s().overdue > 0 }}>
                <span class="smart-summary-label">Ueberfaellig</span>
                <span class="smart-summary-num">{s().overdue}</span>
              </li>
              <li class="smart-summary-divider" aria-hidden="true" />
              <li class="smart-summary-muted">
                <span class="smart-summary-label">Erledigt</span>
                <span class="smart-summary-num">{s().done}</span>
              </li>
              <li class="smart-summary-muted">
                <span class="smart-summary-label">Archiviert</span>
                <span class="smart-summary-num">{s().archived}</span>
              </li>
            </ul>
          )}
        </Show>
      </section>

      <section class="smart-summary-coming-soon">
        <h4>Smart-Summary-Dashboard kommt bald</h4>
        <p>
          Diese Seite wird zum anpassbaren Dashboard pro Zelle ausgebaut. Im Edit-Modus wirst du
          Sektionen per Drag-and-Drop neu anordnen, ein-/ausblenden und je Sektion filtern koennen —
          analog Jira-Dashboards. Standard-Sicht: Cell + ihre Unterstruktur (toggelbar).
        </p>
        <p class="hint">Geplante Sektionen:</p>
        <ul class="smart-summary-roadmap">
          <For each={PLANNED_SECTIONS}>
            {(s) => (
              <li>
                <strong>{s.title}</strong>
                <span class="smart-summary-roadmap-desc"> — {s.desc}</span>
              </li>
            )}
          </For>
        </ul>
      </section>

      <p>
        <a
          href={matrixHref()}
          onClick={(e) => {
            e.preventDefault();
            navigate(matrixHref());
          }}
        >
          ← Zurueck zur Matrix
        </a>
      </p>
    </div>
  );
};

export default CellSummaryPage;
