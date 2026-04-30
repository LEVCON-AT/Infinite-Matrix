// Sidebar-Mini-Calendar (Phase 4 T.1.G.B Stufe 1).
//
// Kompakter Multi-Monats-Calendar fuer die Sidebar. Default 1 Monat,
// expandable bidirektional bis +5 vergangene und +11 zukuenftige
// (gesamt max 17, sinnvoll capped auf 12 sichtbare).
//
// Tag-Click: setzt selectedDay → Tagesansicht updated. Doppel-Click:
// navigate zur grossen Calendar-Route mit Datum vorausgewaehlt.

import { useNavigate } from '@solidjs/router';
import { type Component, For, Show, createMemo, createSignal } from 'solid-js';
import {
  type CalendarEvent,
  addMonths,
  buildMonthGrid,
  dayStatus,
  groupEventsByDay,
  monthLabelDe,
} from '../lib/calendar';
import { bindDropTarget } from '../lib/drag-context';
import { useGridNav } from '../lib/keyboard-nav';
import { openManifestationModal } from '../lib/manifestation-modal-state';
import { moveByDate } from '../lib/manifestation-move';
import {
  clampFutureCount,
  clampPastCount,
  useSidebarCalendarState,
} from '../lib/sidebar-calendar-state';
import { todayIso } from '../lib/task-aggregate';
import type { TaskManifestationRow, TaskRow } from '../lib/types';
import Icon from './Icon';

type Props = {
  workspaceId: string;
  events: CalendarEvent[];
  // Workspace-weite Tasks + Manifestations fuer Move-Drop: der Drop-
  // Handler muss das aktuelle display_meta lesen (Range-Delta-Erhalt)
  // bzw. tasks.deadline (virtual-Fallback). Beide sind in Workspace.tsx
  // bereits geladen — durchgereicht statt nochmal zu fetchen.
  tasksById: Map<string, TaskRow>;
  manifestationsById: Map<string, TaskManifestationRow>;
};

const SidebarCalendarMini: Component<Props> = (p) => {
  const navigate = useNavigate();
  const { state, update } = useSidebarCalendarState(p.workspaceId);
  const today = todayIso();

  const eventsByDay = createMemo(() => groupEventsByDay(p.events));

  // Liste der sichtbaren Monate. Vergangene zuerst (oben), dann
  // current, dann zukuenftige.
  const visibleMonths = createMemo<string[]>(() => {
    const s = state();
    const months: string[] = [];
    for (let i = s.pastCount; i >= 1; i--) {
      months.push(addMonths(s.anchorIso, -i));
    }
    months.push(s.anchorIso);
    for (let i = 1; i <= s.futureCount; i++) {
      months.push(addMonths(s.anchorIso, i));
    }
    return months;
  });

  function expandPast() {
    update({ pastCount: clampPastCount(state().pastCount + 2) });
  }
  function collapsePast() {
    update({ pastCount: 0 });
  }
  function expandFuture() {
    update({ futureCount: clampFutureCount(state().futureCount + 2) });
  }
  function collapseFuture() {
    update({ futureCount: 0 });
  }
  function goToday() {
    update({ anchorIso: today, selectedDay: today });
  }
  function navAnchor(delta: number) {
    update({ anchorIso: addMonths(state().anchorIso, delta) });
  }
  function selectDay(iso: string) {
    update({ selectedDay: iso });
  }
  function openCalendarRoute(iso: string) {
    navigate(`/w/${p.workspaceId}/calendar?date=${iso}`);
  }

  // Drag-Hover-State fuer Visual-Feedback (Border-Pulsation auf Tag).
  const [dragOverIso, setDragOverIso] = createSignal<string | null>(null);

  // Drop-Handler: zwei Faelle.
  //   - sourceManifId vorhanden ODER virtual mit deadline → MOVE
  //     (ohne Modal, mit Undo-Toast). Datum aendert sich, ggf. Range-
  //     Delta erhalten.
  //   - Sonst → ADD: oeffnet das Manifestation-Modal.
  function handleDrop(
    iso: string,
    src: { atom: string; atomId: string; label?: string; sourceManifId?: string },
  ) {
    if (src.atom !== 'task') return;
    setDragOverIso(null);
    const task = p.tasksById.get(src.atomId);
    const manif = src.sourceManifId ? p.manifestationsById.get(src.sourceManifId) : undefined;
    // Move-Pfad wenn:
    //   (a) explicit Calendar-Manifestation → Update display_meta.
    //   (b) virtual aus tasks.deadline → setTaskDeadline.
    if (manif?.kind === 'calendar' || task?.deadline) {
      void moveByDate({
        workspaceId: p.workspaceId,
        taskId: src.atomId,
        manifId: manif?.kind === 'calendar' ? manif.id : undefined,
        currentManif: manif?.kind === 'calendar' ? manif : undefined,
        currentDeadline: task?.deadline ?? null,
        newDate: iso,
      });
      return;
    }
    // ADD-Pfad: Task ohne deadline + ohne explicit Calendar-Manifestation
    // → Modal mit Datum-Vorbelegung.
    openManifestationModal({
      workspaceId: p.workspaceId,
      taskId: src.atomId,
      taskLabel: src.label ?? '',
      defaultDate: iso,
    });
  }

  return (
    <div class="sb-cal-mini">
      <div class="sb-cal-mini-head">
        <button
          type="button"
          class="sb-cal-mini-nav-btn click-pulse"
          onClick={() => navAnchor(-1)}
          aria-label="Vorheriger Monat"
          title="Vorheriger Monat"
        >
          <Icon name="chevron-left" size={12} />
        </button>
        <button
          type="button"
          class="sb-cal-mini-today-btn click-pulse"
          onClick={goToday}
          title="Heute (T)"
        >
          Heute
        </button>
        <button
          type="button"
          class="sb-cal-mini-nav-btn click-pulse"
          onClick={() => navAnchor(1)}
          aria-label="Naechster Monat"
          title="Naechster Monat"
        >
          <Icon name="chevron-right" size={12} />
        </button>
      </div>

      <div
        class="sb-cal-mini-body"
        ref={(el) => {
          useGridNav(el, '.sb-cal-mini-day', 7, {
            onPageNext: () => navAnchor(1),
            onPagePrev: () => navAnchor(-1),
            onHome: goToday,
          });
        }}
      >
        <Show when={state().pastCount > 0}>
          <div class="sb-cal-mini-expand-row">
            <button
              type="button"
              class="sb-cal-mini-expand-btn click-pulse"
              onClick={collapsePast}
              title="Vergangene Monate ausblenden"
              aria-label="Vergangene Monate ausblenden"
            >
              <Icon name="chevron-up" size={12} />
              <Icon name="chevron-up" size={12} />
            </button>
          </div>
        </Show>
        <button
          type="button"
          class="sb-cal-mini-expand-btn sb-cal-mini-expand-top click-pulse"
          onClick={expandPast}
          disabled={state().pastCount >= 5}
          title="2 Monate zurueck aufklappen"
          aria-label="2 Monate zurueck aufklappen"
        >
          <Icon name="chevron-up" size={12} />
        </button>

        <For each={visibleMonths()}>
          {(monthIso) => {
            const grid = createMemo(() => buildMonthGrid(monthIso, today));
            return (
              <div class="sb-cal-mini-month">
                <div class="sb-cal-mini-month-label">{monthLabelDe(monthIso)}</div>
                <div class="sb-cal-mini-weekdays">
                  <For each={['M', 'D', 'M', 'D', 'F', 'S', 'S']}>{(w) => <span>{w}</span>}</For>
                </div>
                <div class="sb-cal-mini-grid">
                  <For each={grid()}>
                    {(day) => {
                      const status = () =>
                        dayStatus(eventsByDay().get(day.iso) ?? [], today, day.iso);
                      const dropHandlers = bindDropTarget({
                        accepts: (src) => src.atom === 'task',
                        onEnter: () => setDragOverIso(day.iso),
                        onLeave: () => {
                          if (dragOverIso() === day.iso) setDragOverIso(null);
                        },
                        onDrop: (src) => handleDrop(day.iso, src),
                      });
                      return (
                        <button
                          type="button"
                          class="sb-cal-mini-day"
                          classList={{
                            'sb-cal-mini-day-out': !day.inMonth,
                            'sb-cal-mini-day-today': day.isToday,
                            'sb-cal-mini-day-selected': day.iso === state().selectedDay,
                            'sb-cal-mini-day-dragover': dragOverIso() === day.iso,
                          }}
                          onClick={() => selectDay(day.iso)}
                          onDblClick={() => openCalendarRoute(day.iso)}
                          onDragEnter={dropHandlers.onDragEnter}
                          onDragOver={dropHandlers.onDragOver}
                          onDragLeave={dropHandlers.onDragLeave}
                          onDrop={dropHandlers.onDrop}
                          aria-label={day.iso}
                        >
                          <span class="sb-cal-mini-day-num">
                            {Number.parseInt(day.iso.slice(8, 10), 10)}
                          </span>
                          <Show when={status() != null}>
                            <span
                              class="sb-cal-mini-dot"
                              classList={{
                                [`sb-cal-mini-dot-${status()}`]: true,
                              }}
                              aria-hidden="true"
                            />
                          </Show>
                        </button>
                      );
                    }}
                  </For>
                </div>
              </div>
            );
          }}
        </For>

        <button
          type="button"
          class="sb-cal-mini-expand-btn sb-cal-mini-expand-bot click-pulse"
          onClick={expandFuture}
          disabled={state().futureCount >= 11}
          title="2 Monate weiter aufklappen"
          aria-label="2 Monate weiter aufklappen"
        >
          <Icon name="chevron-down" size={12} />
        </button>
        <Show when={state().futureCount > 0}>
          <div class="sb-cal-mini-expand-row">
            <button
              type="button"
              class="sb-cal-mini-expand-btn click-pulse"
              onClick={collapseFuture}
              title="Zukuenftige Monate ausblenden"
              aria-label="Zukuenftige Monate ausblenden"
            >
              <Icon name="chevron-down" size={12} />
              <Icon name="chevron-down" size={12} />
            </button>
          </div>
        </Show>
      </div>
    </div>
  );
};

export default SidebarCalendarMini;
