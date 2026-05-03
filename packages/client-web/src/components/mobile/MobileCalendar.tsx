// MobileCalendar — Mobile-Variante der Kalender-Page.
//
// Layout:
//   1. Heatmap-Picker oben (7x6 Mini-Grid, 12px-Cells mit Density-Punkten)
//   2. Agenda-Liste darunter, beginnend mit dem aktuellen Anchor und
//      den Folgetagen.
//
// Heatmap-Cells sind die einzige px-Ausnahme im Mobile-Refit (Icon-
// Anker, dokumentiert in style.md §1.1). 12px ist die kleinstmoegliche
// Cell-Groesse die beruehrbar bleibt; mehr Density-Punkte als 4 sind
// nicht mehr unterscheidbar.
//
// Single-Source: dieselben Datenflows wie Desktop-Calendar (eventsByDay,
// grid, anchorIso, today). Mutations (onDayClick, openEvent,
// onToggleInstance) werden vom Calendar.tsx durchgereicht.

import { type Accessor, type Component, For, Show } from 'solid-js';
import type { CalendarDay, CalendarEvent } from '../../lib/calendar';
import Icon from '../Icon';

type MobileCalendarProps = {
  workspaceId: string;
  anchorIso: Accessor<string>;
  today: string;
  grid: Accessor<CalendarDay[]>;
  eventsByDay: Accessor<Map<string, CalendarEvent[]>>;
  onDayClick: (iso: string) => void;
  openEvent: (e: CalendarEvent, ev: MouseEvent) => void;
  onToggleInstance: (e: CalendarEvent, ev: MouseEvent) => void;
};

/** Liefert eine ARIA-konforme deutsche Wochentag-Beschriftung. */
function weekdayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  const days = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  return days[d.getDay()] ?? '';
}

/** Density-Stufe 0-3 fuer Heatmap-Visualisierung. */
function densityLevel(count: number): 0 | 1 | 2 | 3 {
  if (count === 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  return 3;
}

const WEEKDAY_HEADERS_SHORT = ['M', 'D', 'M', 'D', 'F', 'S', 'S'];

const MobileCalendar: Component<MobileCalendarProps> = (props) => {
  // Agenda-Liste: ab Anchor-Tag bis Ende des aktuellen Monats-Grids.
  // Sortiert chronologisch. Leere Tage ueberspringen wir nicht — User
  // sieht "Keine Termine" als ruhigen Hint.
  const agendaDays = () => {
    const cells = props.grid();
    return cells.filter((d) => d.iso >= props.anchorIso());
  };

  return (
    <div class="mobile-calendar">
      {/* Heatmap-Picker oben */}
      <section class="mobile-cal-heatmap-section" aria-label="Monats-Uebersicht">
        <div class="mobile-cal-heatmap-weekdays" aria-hidden="true">
          <For each={WEEKDAY_HEADERS_SHORT}>{(w) => <span>{w}</span>}</For>
        </div>
        <div class="mobile-cal-heatmap-grid">
          <For each={props.grid()}>
            {(day) => {
              const dayEvents = () => props.eventsByDay().get(day.iso) ?? [];
              const level = () => densityLevel(dayEvents().length);
              return (
                <button
                  type="button"
                  class="mobile-cal-heatmap-cell"
                  classList={{
                    'mobile-cal-heatmap-cell-out': !day.inMonth,
                    'mobile-cal-heatmap-cell-today': day.isToday,
                    'mobile-cal-heatmap-cell-anchor': day.iso === props.anchorIso(),
                  }}
                  data-density={level()}
                  onClick={() => props.onDayClick(day.iso)}
                  aria-label={`${day.iso} (${dayEvents().length} Termine)`}
                />
              );
            }}
          </For>
        </div>
      </section>

      {/* Agenda-Liste */}
      <section class="mobile-cal-agenda" aria-label="Agenda">
        <For
          each={agendaDays()}
          fallback={<p class="hint mobile-cal-agenda-empty">Keine kommenden Termine.</p>}
        >
          {(day) => {
            const dayEvents = () => props.eventsByDay().get(day.iso) ?? [];
            return (
              <article
                class="mobile-cal-agenda-day"
                classList={{ 'mobile-cal-agenda-day-today': day.isToday }}
              >
                <header class="mobile-cal-agenda-day-head">
                  <span class="mobile-cal-agenda-day-date">
                    {Number.parseInt(day.iso.slice(8, 10), 10)}
                  </span>
                  <span class="mobile-cal-agenda-day-weekday">{weekdayLabel(day.iso)}</span>
                  <button
                    type="button"
                    class="mobile-cal-agenda-day-open click-pulse"
                    onClick={() => props.onDayClick(day.iso)}
                    aria-label={`Tag ${day.iso} oeffnen`}
                  >
                    <Icon name="chevron-right" size={16} />
                  </button>
                </header>
                <Show
                  when={dayEvents().length > 0}
                  fallback={<p class="hint mobile-cal-agenda-day-empty">—</p>}
                >
                  <ul class="mobile-cal-agenda-day-events">
                    <For each={dayEvents()}>
                      {(e) => (
                        <li>
                          <button
                            type="button"
                            class="mobile-cal-agenda-event click-pulse"
                            classList={{
                              [`mobile-cal-agenda-event-${e.atomType}`]: true,
                              'mobile-cal-agenda-event-done': e.instanceDone === true,
                            }}
                            onClick={(ev) => props.openEvent(e, ev)}
                          >
                            <Show when={e.atomType === 'task' && e.instanceDate}>
                              <input
                                type="checkbox"
                                class="mobile-cal-agenda-event-check"
                                checked={e.instanceDone === true}
                                onClick={(ev) => ev.stopPropagation()}
                                onChange={(ev) => {
                                  ev.stopPropagation();
                                  props.onToggleInstance(e, ev as unknown as MouseEvent);
                                }}
                                aria-label={
                                  e.instanceDone ? 'Wieder offen' : 'Als erledigt markieren'
                                }
                              />
                            </Show>
                            <Show when={e.time}>
                              <span class="mobile-cal-agenda-event-time">{e.time}</span>
                            </Show>
                            <span class="mobile-cal-agenda-event-label">
                              {e.label || '(ohne Label)'}
                            </span>
                            <Show when={e.isRecurring}>
                              <Icon name="arrow-path" size={14} />
                            </Show>
                          </button>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </article>
            );
          }}
        </For>
      </section>
    </div>
  );
};

export default MobileCalendar;
