// Aggregat-Sektion unter der Matrix. Rendert (FREQ-1) die Intervall-
// matrix, (FREQ-2) die Aufgabenuebersicht und (FREQ-3) den Toggle
// zwischen beiden. Entspricht dem HTML-Vorbild-Flow in
// client/matrix_tool_beta.html renderMatrixPage → renderTaskOverview /
// renderFrequencyMatrix.
//
// Die Sektion erscheint nur, wenn es unter der aktuellen Matrix
// (inkl. Sub-Matrix + Boards) aktive Karten gibt. Leere Matrizen
// sehen die Sektion nicht — spart Platz und Visual-Noise.

import {
  For,
  Show,
  createMemo,
  createResource,
  createSignal,
  type Component,
} from 'solid-js';
import type { CellRow, ColRow, NodeRow, RowRow } from '../lib/types';
import {
  buildFrequencyAggregates,
  collectBoardIdsInMatrixTree,
  isFreqCardActive,
} from '../lib/aggregate';
import { loadDailyCols } from '../lib/daily-cols';
import { fetchCardsForBoards } from '../lib/queries';
import FrequencyMatrix from './FrequencyMatrix';
import TaskOverview from './TaskOverview';

type View = 'overview' | 'freq';

type Props = {
  workspaceId: string;
  matrixId: string;
  // Workspace-weite Daten, vom Parent durchgereicht. Ermoeglicht
  // Subtree-Walk ohne zusaetzlichen Fetch.
  nodes: NodeRow[];
  cells: CellRow[];
  rows: RowRow[];
  cols: ColRow[];
  // Realtime-Version: bei Bump wird Card-Refetch ausgeloest (damit
  // die Aggregate nach Mutation aktuell sind).
  realtimeVersion: number;
};

function storageKey(matrixId: string): string {
  return `matrix-agg-view-${matrixId}`;
}

function loadView(matrixId: string): View {
  try {
    const raw = localStorage.getItem(storageKey(matrixId));
    return raw === 'freq' ? 'freq' : 'overview';
  } catch {
    return 'overview';
  }
}

function saveView(matrixId: string, v: View): void {
  try {
    localStorage.setItem(storageKey(matrixId), v);
  } catch {
    /* ignore */
  }
}

const MatrixAggregateSection: Component<Props> = (p) => {
  const [view, setView] = createSignal<View>(loadView(p.matrixId));

  // Board-IDs im Subtree — rein client-seitig aus nodes+cells.
  const boardIds = createMemo(() =>
    collectBoardIdsInMatrixTree({
      matrixId: p.matrixId,
      nodes: p.nodes,
      cells: p.cells,
    }),
  );

  // Karten-Fetch: haengt an matrixId + realtimeVersion + boardIds-Laenge.
  // Die boardIds selber sind an nodes/cells gebunden; laengere Kette
  // waere ok, aber die ID-Liste aendert sich nur bei Struktur-Mutation.
  const [cards] = createResource(
    () => ({
      matrixId: p.matrixId,
      ids: boardIds(),
      v: p.realtimeVersion,
    }),
    async (key) => {
      if (key.ids.length === 0) return [];
      return fetchCardsForBoards(key.ids, p.workspaceId);
    },
  );

  const activeCount = createMemo(
    () => (cards() ?? []).filter(isFreqCardActive).length,
  );

  const aggregates = createMemo(() => {
    const list = cards();
    if (!list) return [];
    return buildFrequencyAggregates({
      matrixId: p.matrixId,
      nodes: p.nodes,
      cells: p.cells,
      rows: p.rows,
      cols: p.cols,
      cards: list,
    });
  });

  const cellById = createMemo(() => {
    const m = new Map<string, CellRow>();
    for (const c of p.cells) m.set(c.id, c);
    return m;
  });

  function setViewPersisted(v: View) {
    setView(v);
    saveView(p.matrixId, v);
  }

  return (
    <Show when={activeCount() > 0}>
      <section class="matrix-aggregate">
        <header class="matrix-aggregate-head">
          <div
            class="matrix-aggregate-tabs"
            role="tablist"
            aria-label="Aggregat-Ansicht"
          >
            <For each={['overview', 'freq'] as const}>
              {(key) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={view() === key}
                  class="matrix-aggregate-tab"
                  classList={{ active: view() === key }}
                  onClick={() => setViewPersisted(key)}
                >
                  {key === 'overview' ? 'Aufgabenuebersicht' : 'Intervallmatrix'}
                </button>
              )}
            </For>
          </div>
        </header>

        <Show when={view() === 'freq'}>
          <FrequencyMatrix
            workspaceId={p.workspaceId}
            aggregates={aggregates()}
            cellById={cellById()}
          />
        </Show>
        <Show when={view() === 'overview'}>
          <TaskOverview
            workspaceId={p.workspaceId}
            cards={(cards() ?? []).filter(isFreqCardActive)}
            cols={loadDailyCols(p.workspaceId)}
          />
        </Show>
      </section>
    </Show>
  );
};

export default MatrixAggregateSection;
