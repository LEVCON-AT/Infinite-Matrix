// Sidebar-Tagesansicht (Phase 4 T.1.G.B Stufe 2).
//
// Outlook-Style Stunden-Grid mit konstanter Hoehe (visibleRange aus
// Working-Hours + Buffer). Multi-Day-Events oben in einer „All-Day-
// Bar". Single-Day-Events absolut positioniert im Stunden-Grid.
// Overlap-Events werden in Spalten gestapelt (Greedy-Layout, siehe
// lib/day-view-layout.ts).
//
// Tag-Wechsel: Fade-Out + Fade-In (lib/animations.ts) — kein
// translateX, in der schmalen Sidebar zu hektisch.
//
// Click auf Event → /task/:taskId. Drag-Drop wird in T.1.G.2
// ergaenzt; T.1.G.B legt nur die data-draggable-Attribute + grab-
// Cursor als Vorbereitung an.

import { useNavigate } from '@solidjs/router';
import { type Component, For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { fadeIn, fadeOut } from '../lib/animations';
import { type CalendarEvent, fromIso, groupEventsByDay } from '../lib/calendar';
import { columnGeometry, heightPx, layoutDay, topPx as topPxFn } from '../lib/day-view-layout';
import { formatHHMM, visibleRangeForDay, workingHours } from '../lib/working-hours';
import Icon from './Icon';

type Props = {
  workspaceId: string;
  selectedDay: string; // 'YYYY-MM-DD'
  events: CalendarEvent[];
};

const PIXELS_PER_MINUTE = 32 / 60; // 32px pro Stunde
const ALL_DAY_BAR_HEIGHT = 22;

const WEEKDAY_SHORT_DE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

function formatDayLabel(iso: string): string {
  const d = fromIso(iso);
  const dow = WEEKDAY_SHORT_DE[d.getDay()];
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${dow} ${day}.${month}.${d.getFullYear()}`;
}

const SidebarDayView: Component<Props> = (p) => {
  const navigate = useNavigate();
  const [renderedDay, setRenderedDay] = createSignal(p.selectedDay);
  let bodyRef: HTMLDivElement | undefined;

  // Fade-Swap bei Tag-Wechsel: bei jedem selectedDay-Update fade-out,
  // dann setRenderedDay (wodurch Solid neu rendert), dann fade-in.
  createEffect(() => {
    const next = p.selectedDay;
    if (next === renderedDay()) return;
    void (async () => {
      if (bodyRef) await fadeOut(bodyRef);
      setRenderedDay(next);
      requestAnimationFrame(() => {
        if (bodyRef) fadeIn(bodyRef);
      });
    })();
  });

  const eventsForDay = createMemo(() => {
    return groupEventsByDay(p.events).get(renderedDay()) ?? [];
  });

  const range = createMemo(() => {
    const d = fromIso(renderedDay());
    return visibleRangeForDay(d, workingHours());
  });

  const layout = createMemo(() =>
    layoutDay({
      dayIso: renderedDay(),
      events: eventsForDay(),
      visibleStartMin: range().startMin,
      visibleEndMin: range().endMin,
    }),
  );

  // Stunden-Lines: ganze Stunden im sichtbaren Range.
  const hourLines = createMemo<number[]>(() => {
    const r = range();
    const firstHour = Math.ceil(r.startMin / 60);
    const lastHour = Math.floor(r.endMin / 60);
    const out: number[] = [];
    for (let h = firstHour; h <= lastHour; h++) {
      out.push(h);
    }
    return out;
  });

  function topPx(min: number): number {
    return topPxFn(min, PIXELS_PER_MINUTE);
  }

  function gridHeight(): number {
    const r = range();
    return (r.endMin - r.startMin) * PIXELS_PER_MINUTE;
  }

  function bufferBeforeHeight(): number {
    const r = range();
    return Math.max(0, r.mainStartMin - r.startMin) * PIXELS_PER_MINUTE;
  }

  function bufferAfterHeight(): number {
    const r = range();
    return Math.max(0, r.endMin - r.mainEndMin) * PIXELS_PER_MINUTE;
  }

  function bufferAfterTop(): number {
    return (range().mainEndMin - range().startMin) * PIXELS_PER_MINUTE;
  }

  function openEvent(e: CalendarEvent, ev: MouseEvent) {
    ev.stopPropagation();
    navigate(`/w/${p.workspaceId}/task/${e.taskId}`);
  }

  function openInCalendarRoute() {
    navigate(`/w/${p.workspaceId}/calendar?date=${renderedDay()}`);
  }

  return (
    <div class="sb-day">
      <header class="sb-day-head">
        <button
          type="button"
          class="sb-day-head-label click-pulse"
          onClick={openInCalendarRoute}
          title="Im grossen Kalender oeffnen"
        >
          {formatDayLabel(renderedDay())}
        </button>
      </header>

      <div
        class="sb-day-body"
        ref={(el) => {
          bodyRef = el;
        }}
      >
        <Show when={!range().enabled}>
          <p class="sb-day-disabled-hint">
            Kein Arbeitstag konfiguriert.
            <br />
            Pro Wochentag in den Einstellungen aktivieren.
          </p>
        </Show>

        <Show when={range().enabled}>
          <Show when={layout().multiDay.length > 0}>
            <div class="sb-day-allday">
              <For each={layout().multiDay.slice(0, 3)}>
                {(e) => (
                  <button
                    type="button"
                    class="sb-day-allday-item"
                    classList={{ [`sb-day-event-${e.status}`]: true }}
                    onClick={(ev) => openEvent(e, ev)}
                    style={{ height: `${ALL_DAY_BAR_HEIGHT}px` }}
                    data-draggable="task"
                    data-task-id={e.taskId}
                    title={e.label}
                  >
                    <Icon name="arrows-pointing-out" size={10} />
                    <span class="sb-day-allday-label">{e.label || '(ohne Label)'}</span>
                  </button>
                )}
              </For>
              <Show when={layout().multiDay.length > 3}>
                <span class="sb-day-allday-overflow">+{layout().multiDay.length - 3} weitere</span>
              </Show>
            </div>
          </Show>

          <div class="sb-day-grid" style={{ height: `${gridHeight()}px` }}>
            <Show when={bufferBeforeHeight() > 0}>
              <div
                class="sb-day-buffer sb-day-buffer-before"
                style={{ top: '0px', height: `${bufferBeforeHeight()}px` }}
                aria-hidden="true"
              />
            </Show>
            <Show when={bufferAfterHeight() > 0}>
              <div
                class="sb-day-buffer sb-day-buffer-after"
                style={{
                  top: `${bufferAfterTop()}px`,
                  height: `${bufferAfterHeight()}px`,
                }}
                aria-hidden="true"
              />
            </Show>

            <For each={hourLines()}>
              {(h) => {
                const minRel = h * 60 - range().startMin;
                return (
                  <div class="sb-day-hourline" style={{ top: `${topPx(minRel)}px` }}>
                    <span class="sb-day-hourlabel">{formatHHMM(h * 60)}</span>
                  </div>
                );
              }}
            </For>

            <For each={layout().timed}>
              {(it) => {
                const geom = columnGeometry(it.column, it.totalCols);
                return (
                  <button
                    type="button"
                    class="sb-day-event"
                    classList={{
                      [`sb-day-event-${it.event.status}`]: true,
                      'sb-day-event-no-time': !it.hasTime,
                    }}
                    style={{
                      top: `${topPx(it.startMin)}px`,
                      height: `${heightPx(it.durationMin, PIXELS_PER_MINUTE)}px`,
                      left: `calc(40px + ${geom.leftPct}% * (1 - 40px / 100))`,
                      width: `calc(${geom.widthPct}% - 4px)`,
                    }}
                    onClick={(ev) => openEvent(it.event, ev)}
                    data-draggable="task"
                    data-task-id={it.event.taskId}
                    title={it.event.label}
                  >
                    <Show when={it.event.time}>
                      <span class="sb-day-event-time">{it.event.time}</span>
                    </Show>
                    <span class="sb-day-event-label">{it.event.label || '(ohne Label)'}</span>
                    <Show when={it.event.isRecurring}>
                      <Icon name="arrow-path" size={10} />
                    </Show>
                  </button>
                );
              }}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
};

export default SidebarDayView;
