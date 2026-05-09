// Phase 4 T.1.G.A — Workspace-weite Calendar-Route.
//
// Monats-Grid 7×6 (Mo-So × 6 Wochen). Quellen:
//   - explicit kind='calendar'-Manifestations (display_meta.start_date /
//     end_date / time / duration_min — Range-Render moeglich)
//   - virtual aus tasks.deadline (Single-Day, falls keine explicit
//     Calendar-Manifestation existiert)
//
// URL: /w/:wsId/calendar?date=YYYY-MM-DD
//   - ohne date-Param: Anker = heute.
//   - date-Param wird validiert; ungueltig → fallback auf heute.
//
// Click auf Event → /w/:wsId/task/:taskId (TaskDetail).
// Tag-Klick (Background) → setzt date-Param (vorbereitet fuer T.1.G.B
//   Tagesansicht-Drilldown; T.1.G.A bleibt Read-Only-Overview).
//
// Out-of-Scope T.1.G.A:
//   - Drag-Drop (T.1.G.2).
//   - Atom-Generalisierung Link/Doc/Checkliste (T.AC).
//   - recurFiresOn-Aufloesung — recurring Tasks werden hier NUR an
//     ihrem Original-deadline gerendert. TODO-Hinweis im Header.

import { useNavigate, useParams, useSearchParams } from '@solidjs/router';
import {
  type Component,
  For,
  Show,
  createMemo,
  createResource,
  createSignal,
  onMount,
} from 'solid-js';
import Icon from '../components/Icon';
import ImportedEventDetailModal from '../components/ImportedEventDetailModal';
import { ModalTransition } from '../components/ModalTransition';
import MobileCalendar from '../components/mobile/MobileCalendar';
import { pageEnter, slideIn, slideOut } from '../lib/animations';
import {
  fetchAtomCalendarManifestations,
  removeAtomManifestation,
} from '../lib/atom-manifestations';
import { fetchAtomMarkersForWorkspace } from '../lib/atom-markers';
import { navigateToAtomEvent } from '../lib/atom-routing';
import { useUser } from '../lib/auth';
import { fetchAutoCalendarSuppressedCellIds } from '../lib/auto-calendar-toggle';
import {
  type CalendarEvent,
  addMonths,
  buildEvents,
  buildMonthGrid,
  endOfMonth,
  groupEventsByDay,
  isoDate,
  monthLabelDe,
  startOfMonth,
} from '../lib/calendar';
import { openDokuForContext, shouldIgnoreDKey } from '../lib/docs-open';
import { translateDbError } from '../lib/errors';
import { importedEventModalRequest } from '../lib/imported-event-modal-state';
import { installEscReturn, useGridNav } from '../lib/keyboard-nav';
import { openManifestationModal } from '../lib/manifestation-modal-state';
import { fetchAgendaTasks } from '../lib/queries';
import { todayIso } from '../lib/task-aggregate';
import { toggleTaskInstanceDone } from '../lib/tasks';
import { showToast } from '../lib/toasts';
import type { TaskStatus } from '../lib/types';
import { useMobile } from '../lib/use-mobile';

type RouteParams = { workspaceId: string };

const WEEKDAY_HEADERS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

function statusKey(s: TaskStatus | null): string {
  // Non-task-Atoms (Link/Checklist) haben keinen task-status — wir
  // mappen sie auf 'open' damit sie eine konsistente CSS-Klasse kriegen.
  return s ?? 'open';
}

const MAX_PER_DAY = 4;

const Calendar: Component = () => {
  const mobile = useMobile();
  const params = useParams<RouteParams>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const today = todayIso();

  // Anchor = der Monat, der gerade gezeigt wird. Aus URL gelesen
  // (date-Param), bei ungueltigem Wert fallback auf heute.
  const anchorIso = createMemo<string>(() => {
    const raw = (searchParams.date as string | undefined) ?? '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    return today;
  });

  // Range fuer den Fetch: erster Tag des Grids (Mo der Woche des
  // 1. des Monats) bis letzter Tag des Grids. Ueberlappende Tage
  // aus Vor-/Folgemonat sind Filler — wir fetchen die Tasks aber mit,
  // damit Range-Events korrekt ueberspannen.
  const fetchRange = createMemo(() => {
    const a = anchorIso();
    const monthStart = startOfMonth(a);
    const monthEnd = endOfMonth(a);
    // Etwas Puffer (1 Woche) damit Range-Events die ueber den Monatsrand
    // gehen sicher abgedeckt sind. Der Server filtert per deadline-Range
    // — bei explicit Calendar-Manifestations ist die start_date in
    // display_meta, nicht in tasks.deadline; wir nehmen einen weiten
    // Filter und lassen den Client final groupen.
    const rangeFrom = monthStart;
    const rangeTo = monthEnd;
    return { rangeFrom, rangeTo };
  });

  const [agenda] = createResource(
    () => ({ wsId: params.workspaceId, range: fetchRange() }),
    async ({ wsId, range }) => {
      if (!wsId) return [];
      try {
        // Wir holen auch erledigte Tasks im Monats-Range — der User
        // soll im Calendar auch sehen was schon abgehakt war.
        return await fetchAgendaTasks({
          workspaceId: wsId,
          deadlineFrom: range.rangeFrom,
          deadlineTo: range.rangeTo,
        });
      } catch (err) {
        console.error('fetchAgendaTasks(calendar):', err);
        showToast(translateDbError(err, 'Kalender konnte nicht geladen werden.'), 'error');
        return [];
      }
    },
  );

  // T.AC.B: Non-task Atoms (Link/Checklist/Doc) im Calendar zusaetzlich
  // anzeigen. Eigene Resource, weil nicht via fetchAgendaTasks gefiltert.
  const [atomManifs, { refetch: refetchAtomManifs }] = createResource(
    () => params.workspaceId,
    async (wid) => (wid ? fetchAtomCalendarManifestations(wid) : []),
  );

  // WV.E #37 V1.5 — Auto-Calendar-Toggle-Filter. Set von cell_ids in
  // denen Vorlage-Toggle date_field_auto_calendar=false ist.
  const [suppressedCells] = createResource(
    () => params.workspaceId,
    async (wid) => (wid ? fetchAutoCalendarSuppressedCellIds(wid) : new Set<string>()),
  );

  // §13.3 V2.F — Workspace-Markers fuer ImportedEventDetailModal-Bundle.
  // Direct-Open via /w/<wid>/calendar (unabhaengig von Workspace.tsx) —
  // braucht eigene Resource. Realtime ist auf dieser Route nicht verkabelt
  // (V1-Limit), Refresh erfolgt beim naechsten Modal-Open.
  const user = useUser();
  const [wsAtomMarkers] = createResource(
    () => params.workspaceId,
    async (wid) => (wid ? fetchAtomMarkersForWorkspace(wid) : []),
  );

  // Build CalendarEvents aus den Agenda-Items (jeweils task + manifs).
  // T.AC.D.2: viewRange aktiviert Recur-Expansion fuer den sichtbaren
  // Monatsgrid (rangeFrom..rangeTo deckt nicht nur den Anker-Monat ab,
  // sondern auch die angrenzenden Tage in der ersten/letzten Grid-Zeile).
  const events = createMemo<CalendarEvent[]>(() => {
    const items = agenda() ?? [];
    const tasks = items.map((i) => i.task);
    const manifs = items.flatMap((i) => i.manifestations);
    const r = fetchRange();
    return buildEvents({
      tasks,
      manifestations: manifs,
      atomManifestations: (atomManifs() ?? [])
        .filter((a) => {
          // WV.E #37 V1.5: Auto-Manifs aus suppressed Cells filtern.
          if (a.atom_type !== 'info_field') return true;
          if ((a.display_meta as Record<string, unknown>).auto !== true) return true;
          if (!a.container_id) return true;
          return !(suppressedCells() ?? new Set()).has(a.container_id);
        })
        .map((a) => ({
          id: a.id,
          atom_type: a.atom_type as 'link' | 'checklist' | 'doc' | 'imported_event' | 'info_field',
          atom_id: a.atom_id,
          label: a.label,
          display_meta: a.display_meta,
          url: a.url ?? null,
          source_provider: a.source_provider ?? null,
          source_color: a.source_color ?? null,
        })),
      viewRange: { fromIso: r.rangeFrom, toIso: r.rangeTo },
    });
  });

  // T.AC.D.3: pro-Recur-Instanz toggeln. Wir lookup den Task aus dem
  // aktuellen agenda()-Memo (kein extra Round-Trip), nehmen die heutige
  // done_occurrences-Liste, und persistieren via toggleTaskInstanceDone.
  async function onToggleInstance(e: CalendarEvent, ev: MouseEvent) {
    ev.stopPropagation();
    if (e.atomType !== 'task' || !e.instanceDate) return;
    const items = agenda() ?? [];
    const item = items.find((i) => i.task.id === e.atomId);
    if (!item) return;
    const wantDone = !e.instanceDone;
    try {
      await toggleTaskInstanceDone(
        e.atomId,
        e.instanceDate,
        wantDone,
        item.task.done_occurrences ?? [],
      );
    } catch (err) {
      console.error('toggleTaskInstanceDone:', err);
      showToast(translateDbError(err, 'Status nicht aenderbar.'), 'error');
    }
  }

  // T.AC.D.4-Polish: Doppelclick auf einen Termin oeffnet das Edit-Modal
  // direkt — schneller als hover-✏️. Bei Virtual-Events (kein Manif)
  // faellt der Handler auf openEvent zurueck (= navigiert wie ueblich).
  function onDoubleClickEvent(e: CalendarEvent, ev: MouseEvent) {
    ev.stopPropagation();
    if (!e.originalManifId) {
      void navigateToAtomEvent(params.workspaceId, e, navigate);
      return;
    }
    onEditEvent(e, ev);
  }

  // T.AC.D.4: ✏️ oeffnet das Modal im edit-Mode mit pre-gefilltem
  // display_meta. Edit zielt auf den ANKER-Manif (originalManifId),
  // damit Recur-Edits alle Folgetermine konsistent aendern.
  function onEditEvent(e: CalendarEvent, ev: MouseEvent) {
    ev.stopPropagation();
    if (!e.originalManifId) {
      // Virtual via task.deadline → kein Manif zum editieren. Toast.
      showToast('Termin ohne Manifestation — neu droppen statt edit.', 'info');
      return;
    }
    // Welle I: imported_event ist read-only — Edit ueber das External
    // Calendar-System, nicht ueber Matrix. Detail-Modal hat „Original"-Link.
    if (e.atomType === 'imported_event') {
      showToast(
        'Importierte Termine sind read-only. Bearbeite den Termin in der externen Quelle.',
        'info',
      );
      return;
    }
    if (e.atomType === 'doc') {
      // doc/calendar-edit ist V2 — fallback auf task-Pfad bisher.
      openManifestationModal({
        workspaceId: params.workspaceId,
        atomType: 'task',
        atomId: e.atomId,
        atomLabel: e.label,
        atomUrl: e.url ?? undefined,
        defaultDate: e.startDate,
        mode: 'edit',
        manifId: e.originalManifId,
        existingDisplayMeta: e.displayMeta,
      });
      return;
    }
    // WV.E #37: info_field-Auto-Manifs sind System-gepflegt. Edit
    // zielt auf das info_field selbst (Cell-Info-Section), nicht das
    // Manif. Toast verlinkt den richtigen Pfad.
    if (e.atomType === 'info_field') {
      showToast(
        'Datums-Termine aus Info-Feldern werden automatisch erzeugt. Aendere das Feld direkt in der Cell.',
        'info',
      );
      return;
    }
    openManifestationModal({
      workspaceId: params.workspaceId,
      atomType: e.atomType,
      atomId: e.atomId,
      atomLabel: e.label,
      atomUrl: e.url ?? undefined,
      defaultDate: e.startDate,
      mode: 'edit',
      manifId: e.originalManifId,
      existingDisplayMeta: e.displayMeta,
    });
  }

  // T.AC.C-Polish: ✕ entfernt eine atom_manifestation aus dem Calendar.
  // Nur fuer non-task Atoms — Tasks haben TaskDetail-Page mit Manif-Liste.
  async function onRemoveAtomEvent(e: CalendarEvent, ev: MouseEvent) {
    ev.stopPropagation();
    if (!e.manifId) return;
    if (e.atomType === 'task') return;
    try {
      await removeAtomManifestation(e.manifId);
      void refetchAtomManifs();
      showToast('Aus Kalender entfernt.', 'success');
    } catch (err) {
      console.error('removeAtomManifestation:', err);
      showToast(translateDbError(err, 'Entfernen fehlgeschlagen.'), 'error');
    }
  }

  // Welle I.7 — Filter-Toggle "Inkl. importierte" (Default: an).
  // Persistiert in localStorage, damit der User die Wahl nicht jedes
  // Mal neu treffen muss.
  const FILTER_KEY = 'matrix.calendar.show_imported';
  const initialShowImported = (() => {
    try {
      const v = localStorage.getItem(FILTER_KEY);
      return v === null ? true : v === '1';
    } catch {
      return true;
    }
  })();
  const [showImported, setShowImported] = createSignal(initialShowImported);

  function toggleShowImported(): void {
    const next = !showImported();
    setShowImported(next);
    try {
      localStorage.setItem(FILTER_KEY, next ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  const filteredEvents = createMemo(() =>
    showImported() ? events() : events().filter((e) => e.atomType !== 'imported_event'),
  );

  const eventsByDay = createMemo(() => groupEventsByDay(filteredEvents()));

  const grid = createMemo(() => buildMonthGrid(anchorIso(), today));

  let gridRef: HTMLDivElement | undefined;

  function setAnchor(iso: string) {
    setSearchParams({ date: iso });
  }

  // Monats-Wechsel mit Slide-L/R-Animation. Aktuelles Grid sliched
  // zur Quell-Seite raus, dann setzen wir den neuen Anchor; Solid
  // re-rendered, danach sliched die neue Range rein.
  async function navMonth(delta: number) {
    const dir: 'left' | 'right' = delta > 0 ? 'left' : 'right';
    if (gridRef) await slideOut(gridRef, dir);
    setAnchor(addMonths(anchorIso(), delta));
    requestAnimationFrame(() => {
      if (gridRef) slideIn(gridRef, dir);
    });
  }

  function goToday() {
    setAnchor(today);
  }

  function backToWorkspace() {
    navigate(`/w/${params.workspaceId}`);
  }

  installEscReturn(backToWorkspace);

  // Auto-Focus Heute (oder Anchor) beim Mount, damit Enter direkt
  // greift. Nur wenn Page frisch geladen ist (Focus auf body) — sonst
  // klauen wir den User-Focus bei Back-Navigation aus TaskDetail/Agenda.
  onMount(() => {
    const a = document.activeElement as HTMLElement | null;
    if (a && a !== document.body && a !== document.documentElement) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!gridRef) return;
        const target =
          gridRef.querySelector<HTMLElement>('.calendar-day-anchor') ??
          gridRef.querySelector<HTMLElement>('.calendar-day-today') ??
          gridRef.querySelector<HTMLElement>('.calendar-day');
        target?.focus();
      });
    });
  });

  function openEvent(e: CalendarEvent, ev: MouseEvent) {
    ev.stopPropagation();
    void navigateToAtomEvent(params.workspaceId, e, navigate);
  }

  function onDayClick(iso: string) {
    // T.1.G.A-Refinement: Click/Enter auf einem Tag → Agenda gefiltert
    // auf genau dieses Datum. Befuellter Tag → Liste der Tasks. Leerer
    // Tag → "Keine Aufgaben" + Anlege-Pfad (wird in T.1.G.2 wie ein
    // Drag-Drop ergaenzt). Konsistenter Drilldown ohne Sonderfaelle.
    navigate(`/w/${params.workspaceId}/agenda?date=${iso}`);
  }

  return (
    <div
      class="calendar-page"
      ref={(el) => {
        pageEnter(el);
      }}
    >
      <header class="agenda-head">
        <button
          type="button"
          class="obj-detail-back click-pulse"
          onClick={backToWorkspace}
          aria-label="Zurueck zum Workspace"
        >
          <Icon name="arrow-left" size={18} />
        </button>
        <h1 class="agenda-title">{monthLabelDe(anchorIso())}</h1>
        <span class="agenda-count">
          <Show when={!agenda.loading} fallback={<span class="hint">Lade…</span>}>
            {events().length} Termine
          </Show>
        </span>
      </header>

      <div class="calendar-toolbar">
        <button
          type="button"
          class="agenda-preset-btn click-pulse"
          onClick={() => void navMonth(-1)}
          aria-label="Vorheriger Monat"
        >
          <Icon name="chevron-left" size={14} />
        </button>
        <button type="button" class="agenda-preset-btn click-pulse" onClick={goToday}>
          Heute
        </button>
        <button
          type="button"
          class="agenda-preset-btn click-pulse"
          onClick={() => void navMonth(1)}
          aria-label="Naechster Monat"
        >
          <Icon name="chevron-right" size={14} />
        </button>
        <span class="hint calendar-recur-hint">
          Wiederkehrende Termine erscheinen V1 nur am Original-Datum.
        </span>
        <label class="calendar-filter-toggle">
          <input type="checkbox" checked={showImported()} onChange={toggleShowImported} />
          <span>Importierte Termine</span>
        </label>
      </div>

      <Show
        when={!mobile.phone()}
        fallback={
          <MobileCalendar
            workspaceId={params.workspaceId}
            anchorIso={anchorIso}
            today={today}
            grid={grid}
            eventsByDay={eventsByDay}
            onDayClick={onDayClick}
            openEvent={openEvent}
            onToggleInstance={(e, ev) => void onToggleInstance(e, ev)}
          />
        }
      >
        <div
          class="calendar-grid"
          aria-label={`Kalender ${monthLabelDe(anchorIso())}`}
          ref={(el) => {
            gridRef = el;
            useGridNav(el, '.calendar-day', 7, {
              onPageNext: () => void navMonth(1),
              onPagePrev: () => void navMonth(-1),
              onHome: goToday,
            });
          }}
        >
          <For each={WEEKDAY_HEADERS}>{(w) => <div class="calendar-weekday-head">{w}</div>}</For>
          <For each={grid()}>
            {(day) => {
              const dayEvents = () => eventsByDay().get(day.iso) ?? [];
              const visibleEvents = () => dayEvents().slice(0, MAX_PER_DAY);
              const overflowCount = () => Math.max(0, dayEvents().length - MAX_PER_DAY);
              return (
                <button
                  type="button"
                  class="calendar-day"
                  classList={{
                    'calendar-day-out': !day.inMonth,
                    'calendar-day-today': day.isToday,
                    'calendar-day-weekend': day.isWeekend,
                    'calendar-day-anchor': day.iso === anchorIso(),
                  }}
                  onClick={() => onDayClick(day.iso)}
                  aria-label={day.iso}
                >
                  <span class="calendar-day-num">
                    {day.iso === isoDate(new Date(`${day.iso}T00:00:00`))
                      ? Number.parseInt(day.iso.slice(8, 10), 10)
                      : ''}
                  </span>
                  <For each={visibleEvents()}>
                    {(e) => (
                      <div class="calendar-event-wrap">
                        <button
                          type="button"
                          class="calendar-event"
                          classList={{
                            [`calendar-event-${statusKey(e.status)}`]: true,
                            [`calendar-event-atom-${e.atomType}`]: true,
                            'calendar-event-range': e.isRange,
                            'calendar-event-instance-done': e.instanceDone === true,
                            'calendar-event-imported':
                              e.atomType === 'imported_event' && !!e.sourceColor,
                          }}
                          style={
                            e.atomType === 'imported_event' && e.sourceColor
                              ? { '--cal-event-source-color': e.sourceColor }
                              : undefined
                          }
                          onClick={(ev) => openEvent(e, ev)}
                          onDblClick={(ev) => onDoubleClickEvent(e, ev)}
                          onKeyDown={(ev) => {
                            // Welle D.5b: 'd' auf fokussiertem Calendar-Event
                            // → atom-Doku am Event-Atom anlegen.
                            if (
                              (ev.key === 'd' || ev.key === 'D') &&
                              !ev.shiftKey &&
                              !ev.ctrlKey &&
                              !ev.metaKey &&
                              !ev.altKey
                            ) {
                              if (shouldIgnoreDKey(ev.target)) return;
                              ev.preventDefault();
                              ev.stopPropagation();
                              openDokuForContext({
                                kind: 'atom',
                                atomType: e.atomType,
                                atomId: e.atomId,
                                atomTitle: e.label ?? null,
                              });
                            }
                          }}
                          title={e.label}
                        >
                          <Show when={e.atomType === 'task' && e.instanceDate}>
                            <input
                              type="checkbox"
                              class="calendar-event-check"
                              checked={e.instanceDone === true}
                              onClick={(ev) => ev.stopPropagation()}
                              onChange={(ev) => {
                                ev.stopPropagation();
                                void onToggleInstance(e, ev as unknown as MouseEvent);
                              }}
                              aria-label={
                                e.instanceDone ? 'Wieder offen' : 'Als erledigt markieren'
                              }
                              title={e.instanceDone ? 'Wieder offen' : 'Als erledigt markieren'}
                            />
                          </Show>
                          <Show when={e.atomType === 'link'}>
                            <Icon name="link" size={10} />
                          </Show>
                          <Show when={e.atomType === 'checklist'}>
                            <Icon name="list-bullet" size={10} />
                          </Show>
                          <Show when={e.atomType === 'imported_event'}>
                            <Icon name="arrow-top-right-on-square" size={10} />
                          </Show>
                          <Show when={e.time}>
                            <span class="calendar-event-time">{e.time}</span>
                          </Show>
                          <span class="calendar-event-label">{e.label || '(ohne Label)'}</span>
                          <Show when={e.isRecurring}>
                            <Icon name="arrow-path" size={10} />
                          </Show>
                          <Show when={e.isRange}>
                            <Icon name="arrows-pointing-out" size={10} />
                          </Show>
                        </button>
                        <Show when={e.originalManifId}>
                          <button
                            type="button"
                            class="calendar-event-edit"
                            onClick={(ev) => onEditEvent(e, ev)}
                            title="Termin bearbeiten"
                            aria-label="Termin bearbeiten"
                          >
                            <Icon name="pencil" size={10} />
                          </button>
                        </Show>
                        <Show when={e.atomType !== 'task' && e.manifId}>
                          <button
                            type="button"
                            class="calendar-event-remove"
                            onClick={(ev) => void onRemoveAtomEvent(e, ev)}
                            title="Aus Kalender entfernen"
                            aria-label="Aus Kalender entfernen"
                          >
                            <Icon name="x" size={10} />
                          </button>
                        </Show>
                      </div>
                    )}
                  </For>
                  <Show when={overflowCount() > 0}>
                    <span class="calendar-overflow">+{overflowCount()} weitere</span>
                  </Show>
                </button>
              );
            }}
          </For>
        </div>
      </Show>

      <ModalTransition when={Boolean(importedEventModalRequest())}>
        <Show when={importedEventModalRequest()}>
          {(req) => (
            <ImportedEventDetailModal
              workspaceId={req().workspaceId}
              eventId={req().eventId}
              snapshot={req().snapshot}
              wsAtomMarkers={wsAtomMarkers() ?? []}
              selfUserId={user()?.id}
            />
          )}
        </Show>
      </ModalTransition>

      <footer class="kb-hint-bar">
        <span>
          <kbd>↩</kbd> Tag oeffnen
        </span>
        <span class="kb-hint-sep">·</span>
        <span>
          <kbd>←</kbd>
          <kbd>→</kbd>
          <kbd>↑</kbd>
          <kbd>↓</kbd> Tag
        </span>
        <span class="kb-hint-sep">·</span>
        <span>
          <kbd>Bild ↑↓</kbd> Monat
        </span>
        <span class="kb-hint-sep">·</span>
        <span>
          <kbd>T</kbd> Heute
        </span>
        <span class="kb-hint-sep">·</span>
        <span>
          <kbd>Esc</kbd> zurueck
        </span>
      </footer>
    </div>
  );
};

export default Calendar;
