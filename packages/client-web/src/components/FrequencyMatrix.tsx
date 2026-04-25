// Intervallmatrix: Karten-Anzahl pro Zelle × Rhythmus-Kategorie.
// Portiert renderFrequencyMatrix aus packages/client-standalone/matrix.html
// (Zeile 6280-6330).
//
// Input: aggregierte Cell-Tree mit Karten (siehe lib/aggregate.ts).
// Rendering: Grid mit hierarchischen Rows (expand/collapse) und
// dynamisch nur-aktiven Spalten (Kategorien ohne Karten werden
// ausgelassen — identisch zum HTML-Vorbild).

import { For, Show, createMemo, createSignal, onCleanup, onMount, type Component } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import type { AggregateCell, FreqCategoryKey } from '../lib/aggregate';
import { FREQ_CATEGORIES } from '../lib/aggregate';
import { cellTarget } from '../lib/alias-dispatch';
import type { CellRow, KbCardRow } from '../lib/types';
import Icon from './Icon';

// Hierarchische Indentation: Base-Padding + zusaetzliche Tiefe pro Level.
// Werte aus dem HTML-Vorbild (renderFrequencyMatrix) uebernommen.
const FREQ_INDENT_BASE = 9;
const FREQ_INDENT_PER_LEVEL = 14;

type Props = {
  workspaceId: string;
  aggregates: AggregateCell[];
  // Flat lookup fuer cellTarget-Navigation (braucht features etc.).
  cellById: Map<string, CellRow>;
};

type FlyoutState = {
  title: string;
  cards: KbCardRow[];
};

const FrequencyMatrix: Component<Props> = (p) => {
  const navigate = useNavigate();
  // Expand-State per dataId, Sitzung-lokal. Persistenz weggelassen —
  // im HTML ist _freqExpanded auch nur in-memory.
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set());
  // Flyout beim Klick auf eine Zahl-Cell.
  const [flyout, setFlyout] = createSignal<FlyoutState | null>(null);

  // ESC schliesst Flyout (Capture, damit andere Handler nicht greifen).
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !flyout()) return;
      e.stopImmediatePropagation();
      setFlyout(null);
    };
    document.addEventListener('keydown', onKey, true);
    onCleanup(() => document.removeEventListener('keydown', onKey, true));
  });

  function openFlyout(agg: AggregateCell, key: FreqCategoryKey) {
    const cat = FREQ_CATEGORIES.find((c) => c.key === key);
    if (!cat) return;
    const matching = agg.cards.filter((c) => cat.test(c));
    if (matching.length === 0) return;
    setFlyout({
      title: `${agg.label} · ${cat.label}`,
      cards: matching,
    });
  }

  function openCardFromFlyout(card: KbCardRow) {
    navigate(`/w/${p.workspaceId}/n/${card.board_id}?card=${card.id}`);
    setFlyout(null);
  }

  function toggle(dataId: string) {
    const cur = expanded();
    const next = new Set(cur);
    if (next.has(dataId)) next.delete(dataId);
    else next.add(dataId);
    setExpanded(next);
  }

  // Flatten respecting expand-state (rekursiv). Reaktiv auf
  // p.aggregates + expanded() — beide aendern sich nur bei
  // Aggregate-Refetch oder Toggle, nicht bei jedem Re-Render.
  const rows = createMemo<AggregateCell[]>(() => {
    const exp = expanded();
    const walk = (items: AggregateCell[]): AggregateCell[] => {
      const out: AggregateCell[] = [];
      for (const a of items) {
        out.push(a);
        if (a.expandable && exp.has(a.dataId)) {
          out.push(...walk(a.children));
        }
      }
      return out;
    };
    return walk(p.aggregates);
  });

  // Nur die Kategorien zeigen, die in der Top-Level Karten-Summe
  // mindestens eine Karte treffen. (HTML-Vorbild: `activeCols`.)
  // Haengt nur an p.aggregates — kein Re-Eval pro Expand-Klick.
  const cats = createMemo(() => {
    const topCards = p.aggregates.flatMap((a) => a.cards);
    return FREQ_CATEGORIES.filter((cat) => topCards.some((c) => cat.test(c)));
  });

  // Pre-Bake der Counts: Map<dataId, Record<FreqCategoryKey, number>>.
  // Vorher wurde fuer jede Cell-Cell-Render-Combo (~50 Rows × 6 Cats)
  // `agg.cards.filter(cat.test)` neu gerechnet — das Memo zerlegt
  // das in einen einzigen Walk pro Aggregate-Refetch.
  const countMap = createMemo(() => {
    const m = new Map<string, Partial<Record<FreqCategoryKey, number>>>();
    const walk = (items: AggregateCell[]): void => {
      for (const a of items) {
        const counts: Partial<Record<FreqCategoryKey, number>> = {};
        for (const cat of FREQ_CATEGORIES) {
          let n = 0;
          for (const c of a.cards) {
            if (cat.test(c)) n += 1;
          }
          counts[cat.key] = n;
        }
        m.set(a.dataId, counts);
        if (a.children.length > 0) walk(a.children);
      }
    };
    walk(p.aggregates);
    return m;
  });

  function countFor(agg: AggregateCell, key: FreqCategoryKey) {
    return countMap().get(agg.dataId)?.[key] ?? 0;
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
                      style={{
                        'padding-left': `${FREQ_INDENT_BASE + agg.depth * FREQ_INDENT_PER_LEVEL}px`,
                      }}
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
                            classList={{
                              'freq-cell-empty': n === 0,
                              'freq-cell-clickable': n > 0,
                            }}
                            role={n > 0 ? 'button' : undefined}
                            tabIndex={n > 0 ? 0 : -1}
                            onClick={() => n > 0 && openFlyout(agg, cat.key)}
                            onKeyDown={(e) => {
                              if (n > 0 && (e.key === 'Enter' || e.key === ' ')) {
                                e.preventDefault();
                                openFlyout(agg, cat.key);
                              }
                            }}
                            title={n > 0 ? 'Karten anzeigen' : undefined}
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

      <Show when={flyout()}>
        {(f) => (
          <div
            class="overlay-scrim freq-flyout-scrim"
            onClick={(e) => {
              if (e.target === e.currentTarget) setFlyout(null);
            }}
          >
            <div class="overlay-card freq-flyout-card" role="dialog">
              <header class="overlay-head">
                <h3>{f().title}</h3>
                <button
                  type="button"
                  class="overlay-close"
                  onClick={() => setFlyout(null)}
                  aria-label="Schliessen"
                >
                  <Icon name="x" size={18} />
                </button>
              </header>
              <ul class="freq-flyout-list">
                <For each={f().cards}>
                  {(card) => (
                    <li>
                      <button
                        type="button"
                        class="freq-flyout-item"
                        onClick={() => openCardFromFlyout(card)}
                      >
                        <span class="freq-flyout-name">
                          {card.name || '(ohne Name)'}
                        </span>
                        <Show when={card.deadline}>
                          <span class="freq-flyout-meta">
                            {card.deadline}
                          </span>
                        </Show>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </div>
          </div>
        )}
      </Show>
    </Show>
  );
};

export default FrequencyMatrix;
