// Aufgabenuebersicht: Karten gruppiert nach Zeit-Spalten. Portiert
// aus renderTaskOverview in matrix_tool_beta.html (Zeile 6428+).
//
// Input: aggregierte Karten (alle aktiven im Subtree), Daily-Col-
// Konfiguration (Zeit-Fenster), Cell-Lookup fuer Origin-Chip.
//
// Rendering: 3+ Spalten nebeneinander, jede mit Header (Label +
// Count) und Card-List. Klick auf Karte → navigate zum Board mit
// ?card=id (CardOverlay oeffnet). Quick-Done-Toggle per Checkbox.
//
// FREQ-2 Scope: nur Lesen + Navigation + Done-Toggle. Spalten-CRUD
// (anlegen/umbenennen/loeschen) kommt in FREQ-3+ oder separat.

import { useNavigate } from '@solidjs/router';
import { type Component, For, Show } from 'solid-js';
import type { DailyCol, DailyColType } from '../lib/daily-cols';
import {
  DCTYPE_LABELS,
  allOccurrencesDoneInRange,
  cardFitsCol,
  getTimeRange,
  useDailyCols,
} from '../lib/daily-cols';
import { showChoice } from '../lib/dialog';
import { translateDbError } from '../lib/errors';
import { setCardDoneOccurrences, toggleCardDone } from '../lib/mutations';
import { isCardDone, isRecurCard, todayIso, toggleOccurrence } from '../lib/recur';
import { useVis } from '../lib/settings';
import { showToast } from '../lib/toasts';
import type { KbCardRow } from '../lib/types';
import Icon from './Icon';

type Props = {
  workspaceId: string;
  cards: KbCardRow[]; // bereits auf aktive Karten gefiltert
};

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

const TaskOverview: Component<Props> = (p) => {
  const navigate = useNavigate();
  // Daily-Col-CRUD wird ueber den `dailyColEdit`-Vis-Key gesteuert —
  // User kann im Settings-Modal zwischen "Nur Edit-Mode" / "Immer
  // sichtbar" / "Ausgeblendet" waehlen. Default: Edit-Mode.
  const canEditCols = useVis('dailyColEdit');
  const dcs = useDailyCols(p.workspaceId);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const DCTYPE_ORDER: DailyColType[] = [
    'today',
    'thisweek',
    'nextweek',
    'thismonth',
    'nextmonth',
    'thisquarter',
    'thisyear',
    'nextyear',
    'nodate',
  ];

  function cardsForCol(col: DailyCol): KbCardRow[] {
    return p.cards.filter((c) => {
      if (!cardFitsCol(c, col, today)) return false;
      // Rekurrente Karte + Range: wenn alle occurrences im Range done,
      // blende sie aus (gilt nicht fuer 'today', dort checken wir nur
      // heute separat).
      if (isRecurCard(c) && col.type !== 'today' && col.type !== 'nodate') {
        const range = getTimeRange(col.type, today);
        if (range && allOccurrencesDoneInRange(c, range.s, range.e)) {
          return false;
        }
      }
      // Today + rekurrent: wenn heute bereits done, ausblenden.
      if (isRecurCard(c) && col.type === 'today') {
        if ((c.done_occurrences ?? []).includes(todayIso())) return false;
      }
      return true;
    });
  }

  async function onQuickDone(card: KbCardRow) {
    try {
      if (isRecurCard(card)) {
        const next = toggleOccurrence(card.done_occurrences, todayIso(), true);
        await setCardDoneOccurrences(card.id, next);
      } else {
        await toggleCardDone(card.id, true);
      }
      showToast('Erledigt.', 'success');
    } catch (err) {
      showToast(translateDbError(err), 'error');
    }
  }

  function openCard(card: KbCardRow) {
    navigate(`/w/${p.workspaceId}/n/${card.board_id}?card=${card.id}`);
  }

  return (
    <div class="daily-cols">
      <For each={dcs.cols()}>
        {(col, idx) => {
          const items = () => cardsForCol(col);
          const isFirst = () => idx() === 0;
          const isLast = () => idx() === dcs.cols().length - 1;
          return (
            <div class="daily-col" data-dcol-id={col.id}>
              <div class="daily-col-hd" classList={{ 'daily-col-hd-edit': canEditCols() }}>
                <Show
                  when={canEditCols()}
                  fallback={
                    <>
                      <div class="flex-fill">
                        <span class="dcolh-name-span">{col.label}</span>
                        <div class="dcolh-type">{DCTYPE_LABELS[col.type]}</div>
                      </div>
                      <span class="dcolh-count">{items().length}</span>
                    </>
                  }
                >
                  {/* Edit-Mode: Label-Input + Type-Select + Reorder + Delete.
                      Layout stapelt vertikal, damit auch bei schmalen Spalten
                      alle Controls erreichbar sind. */}
                  <input
                    class="dcolh-name-input"
                    type="text"
                    value={col.label}
                    placeholder="(ohne Name)"
                    onBlur={(e) => {
                      const v = e.currentTarget.value.trim();
                      if (v && v !== col.label) dcs.rename(col.id, v);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        (e.currentTarget as HTMLInputElement).blur();
                      }
                    }}
                  />
                  <div class="dcolh-edit-row">
                    <select
                      class="dcolh-type-select"
                      value={col.type}
                      onChange={(e) => dcs.setType(col.id, e.currentTarget.value as DailyColType)}
                      title="Zeitfenster"
                    >
                      <For each={DCTYPE_ORDER}>
                        {(t) => <option value={t}>{DCTYPE_LABELS[t]}</option>}
                      </For>
                    </select>
                    <button
                      type="button"
                      class="dcolh-move"
                      onClick={() => dcs.move(col.id, 'left')}
                      disabled={isFirst()}
                      title="Nach links"
                      aria-label="Nach links verschieben"
                    >
                      <Icon name="chevron-left" size={12} />
                    </button>
                    <button
                      type="button"
                      class="dcolh-move"
                      onClick={() => dcs.move(col.id, 'right')}
                      disabled={isLast()}
                      title="Nach rechts"
                      aria-label="Nach rechts verschieben"
                    >
                      <Icon name="chevron-right" size={12} />
                    </button>
                    <button
                      type="button"
                      class="dcolh-del"
                      onClick={() => {
                        if (dcs.cols().length <= 1) return;
                        void (async () => {
                          const choice = await showChoice({
                            title: 'Spalte entfernen',
                            message: `Spalte "${col.label}" aus der Aufgabenuebersicht entfernen? Die Karten bleiben erhalten, nur die Spalten-Sicht verschwindet.`,
                            choices: [
                              { id: 'del', label: 'Entfernen', variant: 'danger' },
                              { id: 'cancel', label: 'Abbrechen', variant: 'default' },
                            ],
                          });
                          if (choice === 'del') dcs.remove(col.id);
                        })();
                      }}
                      disabled={dcs.cols().length <= 1}
                      title={
                        dcs.cols().length <= 1
                          ? 'Letzte Spalte kann nicht entfernt werden'
                          : 'Spalte entfernen'
                      }
                      aria-label="Spalte entfernen"
                    >
                      <Icon name="x" size={12} />
                    </button>
                  </div>
                  <span class="dcolh-count dcolh-count-edit">{items().length}</span>
                </Show>
              </div>
              <Show
                when={items().length > 0}
                fallback={<div class="daily-empty">Nichts faellig</div>}
              >
                <For each={items()}>
                  {(card) => {
                    const dl = fmtDate(card.deadline);
                    const overdue =
                      card.deadline && !isCardDone(card) && new Date(card.deadline) < today;
                    return (
                      <div
                        class="daily-item"
                        data-prio={card.priority || ''}
                        data-overdue={overdue ? 'true' : 'false'}
                      >
                        <button
                          type="button"
                          class="task-check di-check"
                          onClick={() => void onQuickDone(card)}
                          title="Erledigt"
                          aria-label="Erledigt"
                        />
                        <div
                          class="di-name-wrap"
                          role="link"
                          tabIndex={0}
                          onClick={() => openCard(card)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              openCard(card);
                            }
                          }}
                        >
                          <div class="di-name" data-overdue={overdue ? 'true' : 'false'}>
                            {card.name || '(ohne Name)'}
                          </div>
                          <div class="di-from">
                            {dl && <span>{dl}</span>}
                            {overdue && <span class="di-overdue-text"> · ueberfaellig</span>}
                            {isRecurCard(card) && (
                              <span class="di-recur-badge">
                                {' · '}
                                <Icon name="arrow-path" size={10} />
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  }}
                </For>
              </Show>
            </div>
          );
        }}
      </For>
      <Show when={canEditCols()}>
        <div class="daily-col-add-wrap">
          <button
            type="button"
            class="daily-col-add"
            onClick={() => {
              // Default = 'today' mit Standard-Label; der User kann
              // danach Typ + Label ueber die Edit-Controls aendern.
              dcs.add('today');
            }}
            title="Neue Spalte anlegen"
          >
            <Icon name="plus" size={14} />
            <span>Spalte</span>
          </button>
          <button
            type="button"
            class="daily-col-reset"
            onClick={() => {
              void (async () => {
                const choice = await showChoice({
                  title: 'Spalten zuruecksetzen',
                  message:
                    'Alle eigenen Spalten entfernen und die Standard-Sicht wiederherstellen (Heute · Diese Woche · Dieser Monat · Ohne Datum)?',
                  choices: [
                    {
                      id: 'reset',
                      label: 'Zuruecksetzen',
                      variant: 'danger',
                    },
                    { id: 'cancel', label: 'Abbrechen', variant: 'default' },
                  ],
                });
                if (choice === 'reset') dcs.reset();
              })();
            }}
            title="Auf Standard-Spalten zuruecksetzen"
          >
            <Icon name="arrow-uturn-left" size={14} />
          </button>
        </div>
      </Show>
    </div>
  );
};

export default TaskOverview;
