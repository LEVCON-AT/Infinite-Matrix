// Intervallmatrix: Karten-Anzahl pro Zelle × Rhythmus-Kategorie.
// Portiert renderFrequencyMatrix aus client/matrix_tool_beta.html
// (Zeile 6280-6330).
//
// Input: aggregierte Cell-Tree mit Karten (siehe lib/aggregate.ts).
// Rendering: Grid mit hierarchischen Rows (expand/collapse) und
// dynamisch nur-aktiven Spalten (Kategorien ohne Karten werden
// ausgelassen — identisch zum HTML-Vorbild).

import { For, Show, createSignal, type Component } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import type { AggregateCell, FreqCategoryKey } from '../lib/aggregate';
import { FREQ_CATEGORIES } from '../lib/aggregate';
import { cellTarget } from '../lib/alias-dispatch';
import type { CellRow } from '../lib/types';

type Props = {
  workspaceId: string;
  aggregates: AggregateCell[];
  // Flat lookup fuer cellTarget-Navigation (braucht features etc.).
  cellById: Map<string, CellRow>;
};

const FrequencyMatrix: Component<Props> = (p) => {
  const navigate = useNavigate();
  // Expand-State per dataId, Sitzung-lokal. Persistenz weggelassen —
  // im HTML ist _freqExpanded auch nur in-memory.
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set());

  function toggle(dataId: string) {
    const cur = expanded();
    const next = new Set(cur);
    if (next.has(dataId)) next.delete(dataId);
    else next.add(dataId);
    setExpanded(next);
  }

  // Flatten respecting expand-state (rekursiv).
  function flatten(items: AggregateCell[]): AggregateCell[] {
    const out: AggregateCell[] = [];
    for (const a of items) {
      out.push(a);
      if (a.expandable && expanded().has(a.dataId)) {
        out.push(...flatten(a.children));
      }
    }
    return out;
  }

  // Nur die Kategorien zeigen, die in der Top-Level Karten-Summe
  // mindestens eine Karte treffen. (HTML-Vorbild: `activeCols`.)
  function activeCategories() {
    const topCards = p.aggregates.flatMap((a) => a.cards);
    return FREQ_CATEGORIES.filter((cat) => topCards.some((c) => cat.test(c)));
  }

  function countFor(agg: AggregateCell, key: FreqCategoryKey) {
    const cat = FREQ_CATEGORIES.find((c) => c.key === key);
    if (!cat) return 0;
    return agg.cards.filter((c) => cat.test(c)).length;
  }

  function navigateToCell(agg: AggregateCell) {
    const cell = p.cellById.get(agg.cellId);
    if (!cell) return;
    navigate(
      cellTarget(p.workspaceId, {
        cellId: cell.id,
        matrixId: cell.matrix_id,
        features: cell.features ?? [],
        childMatrixId: cell.child_matrix_id,
        boardId: cell.board_id,
      }),
    );
  }

  const rows = () => flatten(p.aggregates);
  const cats = () => activeCategories();

  return (
    <Show
      when={rows().length > 0 && cats().length > 0}
      fallback={<div class="freq-empty">Keine aktiven Aufgaben.</div>}
    >
      <div class="freq-scroll-wrap">
        <table class="freq-grid">
          <thead>
            <tr>
              <th class="freq-hd freq-hd-corner" />
              <For each={cats()}>
                {(cat) => <th class="freq-hd">{cat.label}</th>}
              </For>
            </tr>
          </thead>
          <tbody>
            <For each={rows()}>
              {(agg) => {
                const isOpen = () => expanded().has(agg.dataId);
                return (
                  <tr>
                    <th
                      class="freq-row-hd"
                      style={{ 'padding-left': `${9 + agg.depth * 14}px` }}
                      onClick={() => navigateToCell(agg)}
                      role="link"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          navigateToCell(agg);
                        }
                      }}
                      title="Zelle oeffnen"
                    >
                      <Show
                        when={agg.expandable}
                        fallback={<span class="freq-chevron-spacer" />}
                      >
                        <button
                          type="button"
                          class="freq-chevron"
                          classList={{ expanded: isOpen() }}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggle(agg.dataId);
                          }}
                          aria-label={isOpen() ? 'Einklappen' : 'Ausklappen'}
                        >
                          ▸
                        </button>
                      </Show>
                      <Show when={agg.alias}>
                        <span class="alias-tag">^{agg.alias}</span>
                      </Show>
                      <span class="freq-row-label">{agg.label}</span>
                    </th>
                    <For each={cats()}>
                      {(cat) => {
                        const n = countFor(agg, cat.key);
                        return (
                          <td
                            class="freq-cell"
                            classList={{ 'freq-cell-empty': n === 0 }}
                          >
                            {n > 0 ? n : ''}
                          </td>
                        );
                      }}
                    </For>
                  </tr>
                );
              }}
            </For>
          </tbody>
        </table>
      </div>
    </Show>
  );
};

export default FrequencyMatrix;
