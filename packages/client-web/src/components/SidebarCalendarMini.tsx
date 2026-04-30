// Sidebar-Mini-Calendar (Phase 4 T.1.G.B Stufe 1).
//
// Kompakter Multi-Monats-Calendar fuer die Sidebar. Default 1 Monat,
// expandable bidirektional bis +5 vergangene und +11 zukuenftige
// (gesamt max 17, sinnvoll capped auf 12 sichtbare).
//
// Tag-Click: setzt selectedDay → Tagesansicht updated. Doppel-Click:
// navigate zur grossen Calendar-Route mit Datum vorausgewaehlt.

import { useNavigate } from '@solidjs/router';
import { type Component, For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { type AtomManifestationRow, dropAtomOnDate } from '../lib/atom-manifestations';
import {
  type CalendarEvent,
  addMonths,
  buildMonthGrid,
  dayStatus,
  groupEventsByDay,
  monthLabelDe,
} from '../lib/calendar';
import { activeDrag, bindDropTarget } from '../lib/drag-context';
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
  // T.AC.B: workspace-weite atom_manifestations (atom_type IN ('link',
  // 'checklist','doc')) fuer Idempotenz-Check beim Drop.
  atomManifestations?: AtomManifestationRow[];
  onAtomManifestationsChanged?: () => void;
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

  // Drag-Hover auf den ‹/›-Nav-Buttons → nach 350ms Hover springt der
  // Anker einen Monat weiter. Damit kann der User eine Karte in einen
  // anderen Monat draggen ohne den Drag abzubrechen. Solange er auf
  // dem Chevron haelt, navigiert es weiter (auto-repeat alle 1100ms —
  // langsam genug fuer normales Tempo, sonst rast der Kalender).
  //
  // Wichtige Invariante: jedes navAnchor-Tick + jeder Timer-Start
  // prueft activeDrag(). Wenn der Drag ohne dragleave/drop endet
  // (z.B. ESC oder Drop ausserhalb), bleibt der Interval sonst
  // kleben und schaltet weiter — User-Bug 2026-05-01.
  const REPEAT_MS = 1100;
  function bindDragNav(delta: number) {
    let firstTimer: ReturnType<typeof setTimeout> | null = null;
    let repeatTimer: ReturnType<typeof setInterval> | null = null;
    let btnEl: HTMLElement | null = null;
    function clear() {
      if (firstTimer != null) {
        clearTimeout(firstTimer);
        firstTimer = null;
      }
      if (repeatTimer != null) {
        clearInterval(repeatTimer);
        repeatTimer = null;
      }
      btnEl?.removeAttribute('data-drag-hover');
    }
    return {
      ref: (el: HTMLElement) => {
        btnEl = el;
      },
      onDragEnter: (e: DragEvent) => {
        if (!activeDrag()) return;
        e.preventDefault();
        btnEl?.setAttribute('data-drag-hover', '1');
        if (firstTimer != null || repeatTimer != null) return;
        firstTimer = setTimeout(() => {
          firstTimer = null;
          if (!activeDrag()) {
            clear();
            return;
          }
          navAnchor(delta);
          repeatTimer = setInterval(() => {
            if (!activeDrag()) {
              clear();
              return;
            }
            navAnchor(delta);
          }, REPEAT_MS);
        }, 350);
      },
      onDragOver: (e: DragEvent) => {
        if (!activeDrag()) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
      },
      onDragLeave: (e: DragEvent) => {
        // dragleave feuert auch wenn der Cursor auf ein KIND-Element
        // wechselt (z.B. das SVG-Icon im Button). Ohne den
        // relatedTarget-Filter schiesst es den Hold-Timer ab, bevor
        // die 350 ms voll sind — und der Auto-Nav loest nie aus.
        const ct = e.currentTarget as HTMLElement | null;
        const rt = e.relatedTarget as Node | null;
        if (ct && rt && ct.contains(rt)) return;
        clear();
      },
      onDrop: () => {
        clear();
      },
    };
  }

  // Sicherheitsnetz auf document-Ebene: wenn der Drag ausserhalb des
  // Chevron-Buttons endet (z.B. Drop auf einen Tag, oder ESC), kommt
  // kein dragleave/drop auf dem Button — also kein clear(). Der
  // activeDrag()-Check im Interval bremst die Auto-Nav, aber das
  // data-drag-hover-Attribut bleibt sichtbar. Hier ziehen wir es weg.
  onMount(() => {
    const onDocDragEnd = () => {
      for (const el of document.querySelectorAll('.sb-cal-mini-nav-btn[data-drag-hover]')) {
        el.removeAttribute('data-drag-hover');
      }
    };
    document.addEventListener('dragend', onDocDragEnd);
    document.addEventListener('drop', onDocDragEnd);
    onCleanup(() => {
      document.removeEventListener('dragend', onDocDragEnd);
      document.removeEventListener('drop', onDocDragEnd);
    });
  });

  // Drop-Handler: drei Faelle.
  //   - atom='task': existing path (Move via deadline / Calendar-Manif,
  //     sonst Modal-Add).
  //   - atom='link' | 'checklist' (T.AC.B): legt eine atom_manifestation
  //     mit kind='calendar' an (oder Move, wenn schon vorhanden). Kein
  //     Modal — non-task-Atoms haben heute kein Modal-Pendant.
  function handleDrop(
    iso: string,
    src: {
      atom: string;
      atomId: string;
      label?: string;
      sourceManifId?: string;
      url?: string;
    },
  ) {
    setDragOverIso(null);
    if (src.atom === 'task') {
      const task = p.tasksById.get(src.atomId);
      const manif = src.sourceManifId ? p.manifestationsById.get(src.sourceManifId) : undefined;
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
      openManifestationModal({
        workspaceId: p.workspaceId,
        taskId: src.atomId,
        taskLabel: src.label ?? '',
        defaultDate: iso,
      });
      return;
    }
    if (src.atom === 'link' || src.atom === 'checklist') {
      void dropAtomOnDate({
        workspaceId: p.workspaceId,
        atomType: src.atom,
        atomId: src.atomId,
        atomLabel: src.label,
        atomUrl: src.url,
        newDate: iso,
        existing: p.atomManifestations ?? [],
      }).then(() => p.onAtomManifestationsChanged?.());
      return;
    }
  }

  return (
    <div class="sb-cal-mini">
      <div class="sb-cal-mini-head">
        {(() => {
          const prev = bindDragNav(-1);
          return (
            <button
              type="button"
              class="sb-cal-mini-nav-btn click-pulse"
              ref={prev.ref}
              onClick={() => navAnchor(-1)}
              aria-label="Vorheriger Monat"
              title="Vorheriger Monat"
              onDragEnter={prev.onDragEnter}
              onDragOver={prev.onDragOver}
              onDragLeave={prev.onDragLeave}
              onDrop={prev.onDrop}
            >
              <Icon name="chevron-left" size={12} />
            </button>
          );
        })()}
        <button
          type="button"
          class="sb-cal-mini-today-btn click-pulse"
          onClick={goToday}
          title="Heute (T)"
        >
          Heute
        </button>
        {(() => {
          const next = bindDragNav(1);
          return (
            <button
              type="button"
              class="sb-cal-mini-nav-btn click-pulse"
              ref={next.ref}
              onClick={() => navAnchor(1)}
              aria-label="Naechster Monat"
              title="Naechster Monat"
              onDragEnter={next.onDragEnter}
              onDragOver={next.onDragOver}
              onDragLeave={next.onDragLeave}
              onDrop={next.onDrop}
            >
              <Icon name="chevron-right" size={12} />
            </button>
          );
        })()}
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
                        accepts: (src) =>
                          src.atom === 'task' || src.atom === 'link' || src.atom === 'checklist',
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
