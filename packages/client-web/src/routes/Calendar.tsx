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
import { type Component, For, Show, createMemo, createResource, onMount } from 'solid-js';
import Icon from '../components/Icon';
import { pageEnter, slideIn, slideOut } from '../lib/animations';
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
import { translateDbError } from '../lib/errors';
import { installEscReturn, useGridNav } from '../lib/keyboard-nav';
import { fetchAgendaTasks } from '../lib/queries';
import { todayIso } from '../lib/task-aggregate';
import { showToast } from '../lib/toasts';
import type { TaskStatus } from '../lib/types';

type RouteParams = { workspaceId: string };

const WEEKDAY_HEADERS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

function statusKey(s: TaskStatus): string {
  return s; // 1:1; wir verwenden das in CSS-Klassen.
}

const MAX_PER_DAY = 4;

const Calendar: Component = () => {
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

  // Build CalendarEvents aus den Agenda-Items (jeweils task + manifs).
  const events = createMemo<CalendarEvent[]>(() => {
    const items = agenda() ?? [];
    const tasks = items.map((i) => i.task);
    const manifs = items.flatMap((i) => i.manifestations);
    return buildEvents({ tasks, manifestations: manifs });
  });

  const eventsByDay = createMemo(() => groupEventsByDay(events()));

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
    navigate(`/w/${params.workspaceId}/task/${e.taskId}`);
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
      </div>

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
                    <button
                      type="button"
                      class="calendar-event"
                      classList={{
                        [`calendar-event-${statusKey(e.status)}`]: true,
                        'calendar-event-range': e.isRange,
                      }}
                      onClick={(ev) => openEvent(e, ev)}
                      title={e.label}
                    >
                      <Show when={e.time}>
                        <span class="calendar-event-time">{e.time}</span>
                      </Show>
                      <span class="calendar-event-label">{e.label || '(ohne Label)'}</span>
                      <Show when={e.isRange}>
                        <Icon name="arrows-pointing-out" size={10} />
                      </Show>
                    </button>
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
