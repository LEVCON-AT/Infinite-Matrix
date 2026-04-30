// Phase 4 T.1.F — Workspace-weite Aufgaben-Uebersicht.
//
// Filter-Bar mit Preset-Pills (Heute / Diese Woche / Ueberfaellig /
// Alle aktiven / Erledigt / Kein Datum) + Trigram-Search auf label +
// optional Who-Filter. Liste sortiert nach deadline asc (nulls last),
// dann created_at desc. Click → TaskDetail.
//
// Filter-State liegt in createSignal — keine URL-Persistenz fuer V1
// (kommt mit T.SS-Welle, die ohnehin Filter-Stack persistiert).

import { useNavigate, useParams, useSearchParams } from '@solidjs/router';
import {
  type Component,
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
} from 'solid-js';
import Icon from '../components/Icon';
import { listStaggerEnter, pageEnter } from '../lib/animations';
import { addDays, endOfMonth, fromIso } from '../lib/calendar';
import { translateDbError } from '../lib/errors';
import { installEscReturn, useArrowListNav } from '../lib/keyboard-nav';
import { type AgendaFilter, type AgendaTask, fetchAgendaTasks } from '../lib/queries';
import { todayIso } from '../lib/task-aggregate';
import { showToast } from '../lib/toasts';
import type { TaskStatus } from '../lib/types';

type RouteParams = { workspaceId: string };

// Preset-Definitionen. Jede liefert einen partiellen Filter, der in
// AgendaFilter eingespeist wird. `label` ist UI-Text.
type Preset = {
  key: string;
  label: string;
  build: (today: string) => Partial<AgendaFilter>;
};

// Datums-Helper: alle Range-Builder nutzen lib/calendar.ts (lokale
// Komponenten, kein UTC-Drift). Ende der Woche = naechster Sonntag
// inklusiv (deutsches Mo-So-Layout).
function endOfWeekIso(today: string): string {
  const dow = (fromIso(today).getDay() + 6) % 7; // Mo=0, So=6
  return addDays(today, 6 - dow);
}

function yesterdayIso(today: string): string {
  return addDays(today, -1);
}

const PRESETS: Preset[] = [
  {
    key: 'overdue',
    label: 'Ueberfaellig',
    build: (today) => ({
      statusIn: ['open', 'in_progress', 'blocked'],
      deadlineTo: yesterdayIso(today),
      hasDeadline: true,
    }),
  },
  {
    key: 'today',
    label: 'Heute',
    build: (today) => ({
      statusIn: ['open', 'in_progress', 'blocked'],
      deadlineFrom: today,
      deadlineTo: today,
      hasDeadline: true,
    }),
  },
  {
    key: 'this_week',
    label: 'Diese Woche',
    build: (today) => ({
      statusIn: ['open', 'in_progress', 'blocked'],
      deadlineFrom: today,
      deadlineTo: endOfWeekIso(today),
      hasDeadline: true,
    }),
  },
  {
    key: 'this_month',
    label: 'Dieser Monat',
    build: (today) => ({
      statusIn: ['open', 'in_progress', 'blocked'],
      deadlineFrom: today,
      deadlineTo: endOfMonth(today),
      hasDeadline: true,
    }),
  },
  {
    key: 'active',
    label: 'Alle aktiven',
    build: () => ({
      statusIn: ['open', 'in_progress', 'blocked'],
      hasDeadline: true,
    }),
  },
  {
    key: 'done',
    label: 'Erledigt',
    build: () => ({
      statusIn: ['done'],
      hasDeadline: true,
    }),
  },
];

function statusLabel(s: TaskStatus): string {
  switch (s) {
    case 'open':
      return 'Offen';
    case 'in_progress':
      return 'In Arbeit';
    case 'blocked':
      return 'Blockiert';
    case 'done':
      return 'Erledigt';
    case 'archived':
      return 'Archiviert';
  }
}

function deadlineLabel(
  deadline: string | null,
  today: string,
): {
  text: string;
  variant: 'overdue' | 'today' | 'soon' | 'plain';
} {
  if (!deadline) return { text: '—', variant: 'plain' };
  if (deadline < today) return { text: deadline, variant: 'overdue' };
  if (deadline === today) return { text: 'Heute', variant: 'today' };
  return { text: deadline, variant: 'soon' };
}

function formatGermanDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}.${month}.${year}`;
}

const Agenda: Component = () => {
  const params = useParams<RouteParams>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [presetKey, setPresetKey] = createSignal<string>('active');
  const [search, setSearch] = createSignal('');
  const [who, setWho] = createSignal('');

  const today = todayIso();

  // Custom-Day-Filter aus URL: ?date=YYYY-MM-DD. Wird vom Calendar-
  // Tag-Click gesetzt. Validiertes ISO; ungueltig → null (= preset
  // greift wie ueblich).
  const customDate = createMemo<string | null>(() => {
    const raw = (searchParams.date as string | undefined) ?? '';
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
  });

  const filter = createMemo<AgendaFilter>(() => {
    const cd = customDate();
    if (cd) {
      // Custom-Tag-Filter: deadline=cd, kein Status-Filter (User soll
      // alles am Tag sehen — incl. erledigt/archiviert).
      return {
        workspaceId: params.workspaceId,
        deadlineFrom: cd,
        deadlineTo: cd,
        hasDeadline: true,
        search: search().trim() || undefined,
        whoIncludes: who().trim() || undefined,
      };
    }
    const preset = PRESETS.find((p) => p.key === presetKey()) ?? PRESETS[4];
    return {
      workspaceId: params.workspaceId,
      ...preset.build(today),
      search: search().trim() || undefined,
      whoIncludes: who().trim() || undefined,
    };
  });

  function setPreset(key: string) {
    setPresetKey(key);
    // Wenn der User einen Standard-Preset waehlt, Custom-Day-Filter
    // verwerfen (sonst wuerde er den Preset wirkungslos machen).
    if (customDate()) setSearchParams({ date: undefined });
  }

  function clearCustomDate() {
    setSearchParams({ date: undefined });
  }

  const [tasks] = createResource(
    () => filter(),
    async (f) => {
      if (!f.workspaceId) return [] as AgendaTask[];
      try {
        return await fetchAgendaTasks(f);
      } catch (err) {
        console.error('fetchAgendaTasks:', err);
        showToast(translateDbError(err, 'Aufgaben konnten nicht geladen werden.'), 'error');
        return [] as AgendaTask[];
      }
    },
  );

  function openTask(taskId: string) {
    navigate(`/w/${params.workspaceId}/task/${taskId}`);
  }

  // History-aware: wenn customDate aktiv (User kam aus Calendar-Tag-
  // Click), browser-back zum Calendar mit erhaltenem ?date=. Sonst
  // direkt zum Workspace.
  function backFromAgenda() {
    if (customDate()) {
      navigate(-1);
    } else {
      navigate(`/w/${params.workspaceId}`);
    }
  }

  installEscReturn(backFromAgenda);

  // List-Container ref fuer Stagger-Enter + Pfeil-Navigation.
  let listRef: HTMLDivElement | undefined;
  // Re-stagger bei jedem Filter-/Search-Wechsel — Items kommen frisch
  // rein. Mit der bestehenden listStaggerEnter-Idempotenz brauchen wir
  // ein Reset des data-Attributs.
  createEffect(() => {
    void filter();
    const el = listRef;
    if (el) {
      el.dataset.staggered = '';
      // rAF damit Solid den neuen DOM-Stand schon committed hat.
      requestAnimationFrame(() => listStaggerEnter(el));
    }
  });

  return (
    <div
      class="agenda-page"
      ref={(el) => {
        pageEnter(el);
      }}
    >
      <header class="agenda-head">
        <button
          type="button"
          class="obj-detail-back click-pulse"
          onClick={backFromAgenda}
          aria-label="Zurueck"
        >
          <Icon name="arrow-left" size={18} />
        </button>
        <h1 class="agenda-title">
          <Show when={customDate()} fallback="Agenda">
            {(d) => `Agenda — ${formatGermanDate(d())}`}
          </Show>
        </h1>
        <span class="agenda-count">
          <Show when={!tasks.loading} fallback={<span class="hint">Lade…</span>}>
            {(tasks() ?? []).length} Aufgaben
          </Show>
        </span>
      </header>

      <div class="agenda-filters">
        <div class="agenda-presets" role="tablist" aria-label="Filter-Presets">
          <Show when={customDate()}>
            {(d) => (
              <button
                type="button"
                class="agenda-preset-btn agenda-preset-active click-pulse"
                onClick={clearCustomDate}
                title="Tag-Filter entfernen"
              >
                <Icon name="calendar" size={12} />
                {formatGermanDate(d())}
                <Icon name="x" size={12} />
              </button>
            )}
          </Show>
          <For each={PRESETS}>
            {(preset) => (
              <button
                type="button"
                class="agenda-preset-btn click-pulse"
                classList={{
                  'agenda-preset-active': !customDate() && presetKey() === preset.key,
                }}
                onClick={() => setPreset(preset.key)}
                role="tab"
                aria-selected={!customDate() && presetKey() === preset.key}
              >
                {preset.label}
              </button>
            )}
          </For>
        </div>
        <div class="agenda-search-row">
          <div class="agenda-search-wrap">
            <Icon name="search" size={14} />
            <input
              type="search"
              class="agenda-search-input"
              placeholder="Suche im Label…"
              value={search()}
              onInput={(e) => setSearch(e.currentTarget.value)}
            />
          </div>
          <div class="agenda-search-wrap agenda-who-wrap">
            <Icon name="user" size={14} />
            <input
              type="text"
              class="agenda-who-input"
              placeholder="Wer (Frei-Text, z.B. mb)"
              title="Filter nach Eintrag in tasks.who. Object-basierter Filter folgt mit T.2."
              value={who()}
              onInput={(e) => setWho(e.currentTarget.value)}
            />
          </div>
        </div>
      </div>

      <div
        class="agenda-list"
        ref={(el) => {
          listRef = el;
          useArrowListNav(el, '.agenda-row');
        }}
      >
        <Show when={!tasks.loading && (tasks() ?? []).length === 0} fallback={null}>
          <p class="hint agenda-empty">Keine Aufgaben mit diesen Filtern.</p>
        </Show>
        <For each={tasks() ?? []}>
          {(item) => {
            const dl = deadlineLabel(item.task.deadline, today);
            return (
              <button type="button" class="agenda-row" onClick={() => openTask(item.task.id)}>
                <span
                  class="agenda-row-date"
                  classList={{ [`agenda-row-date-${dl.variant}`]: true }}
                >
                  <Icon name="calendar" size={12} />
                  {dl.text}
                </span>
                <div class="agenda-row-main">
                  <span class="agenda-row-label">{item.task.label || '(ohne Label)'}</span>
                  <Show when={item.task.note}>
                    <span class="agenda-row-note">{item.task.note}</span>
                  </Show>
                </div>
                <div class="agenda-row-meta">
                  <span
                    class="agenda-status"
                    classList={{
                      [`agenda-status-${item.task.status}`]: true,
                    }}
                  >
                    {statusLabel(item.task.status)}
                  </span>
                  <span class="agenda-manifs">
                    <For each={item.manifestations}>
                      {(m) => (
                        <span
                          class="agenda-manif"
                          classList={{ [`agenda-manif-${m.kind}`]: true }}
                          title={`Sicht: ${m.kind}`}
                        >
                          <Icon
                            name={
                              m.kind === 'kanban'
                                ? 'view-columns'
                                : m.kind === 'checklist'
                                  ? 'check-circle'
                                  : m.kind === 'calendar'
                                    ? 'calendar'
                                    : 'tag'
                            }
                            size={12}
                          />
                        </span>
                      )}
                    </For>
                  </span>
                  <Icon name="chevron-right" size={14} />
                </div>
              </button>
            );
          }}
        </For>
      </div>

      <footer class="kb-hint-bar">
        <span>
          <kbd>↩</kbd> oeffnen
        </span>
        <span class="kb-hint-sep">·</span>
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> Eintrag
        </span>
        <span class="kb-hint-sep">·</span>
        <span>
          <kbd>Esc</kbd> zurueck
        </span>
      </footer>
    </div>
  );
};

export default Agenda;
