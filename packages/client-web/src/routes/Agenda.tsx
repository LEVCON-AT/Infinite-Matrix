// Phase 4 T.1.F — Workspace-weite Aufgaben-Uebersicht.
//
// Filter-Bar mit Preset-Pills (Heute / Diese Woche / Ueberfaellig /
// Alle aktiven / Erledigt / Kein Datum) + Trigram-Search auf label +
// optional Who-Filter. Liste sortiert nach deadline asc (nulls last),
// dann created_at desc. Click → TaskDetail.
//
// Filter-State liegt in createSignal — keine URL-Persistenz fuer V1
// (kommt mit T.SS-Welle, die ohnehin Filter-Stack persistiert).

import { useNavigate, useParams } from '@solidjs/router';
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

function endOfWeekIso(today: string): string {
  // Sonntag als Wochenende. JS-Date getDay(): 0=So, 1=Mo, ..., 6=Sa.
  // Wir nehmen Mon-Sun als Woche → Tage bis Sonntag = 7 - dayOfWeek
  // (mit Sonntag=0 → 0 Tage).
  const d = new Date(`${today}T00:00:00`);
  const dow = d.getDay();
  const daysUntilSunday = dow === 0 ? 0 : 7 - dow;
  d.setDate(d.getDate() + daysUntilSunday);
  return d.toISOString().slice(0, 10);
}

function endOfMonthIso(today: string): string {
  const d = new Date(`${today}T00:00:00`);
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return d.toISOString().slice(0, 10);
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
    }),
  },
  {
    key: 'this_week',
    label: 'Diese Woche',
    build: (today) => ({
      statusIn: ['open', 'in_progress', 'blocked'],
      deadlineFrom: today,
      deadlineTo: endOfWeekIso(today),
    }),
  },
  {
    key: 'this_month',
    label: 'Dieser Monat',
    build: (today) => ({
      statusIn: ['open', 'in_progress', 'blocked'],
      deadlineFrom: today,
      deadlineTo: endOfMonthIso(today),
    }),
  },
  {
    key: 'active',
    label: 'Alle aktiven',
    build: () => ({ statusIn: ['open', 'in_progress', 'blocked'] }),
  },
  {
    key: 'no_deadline',
    label: 'Kein Datum',
    build: () => ({
      statusIn: ['open', 'in_progress', 'blocked'],
      hasDeadline: false,
    }),
  },
  {
    key: 'done',
    label: 'Erledigt',
    build: () => ({ statusIn: ['done'] }),
  },
];

function yesterdayIso(today: string): string {
  const d = new Date(`${today}T00:00:00`);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

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

const Agenda: Component = () => {
  const params = useParams<RouteParams>();
  const navigate = useNavigate();

  const [presetKey, setPresetKey] = createSignal<string>('active');
  const [search, setSearch] = createSignal('');
  const [who, setWho] = createSignal('');

  const today = todayIso();

  const filter = createMemo<AgendaFilter>(() => {
    const preset = PRESETS.find((p) => p.key === presetKey()) ?? PRESETS[4];
    return {
      workspaceId: params.workspaceId,
      ...preset.build(today),
      search: search().trim() || undefined,
      whoIncludes: who().trim() || undefined,
    };
  });

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

  function backToWorkspace() {
    navigate(`/w/${params.workspaceId}`);
  }

  // ESC → zurueck zum Workspace.
  installEscReturn(backToWorkspace);

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
          onClick={backToWorkspace}
          aria-label="Zurueck zum Workspace"
        >
          <Icon name="arrow-left" size={18} />
        </button>
        <h1 class="agenda-title">Agenda</h1>
        <span class="agenda-count">
          <Show when={!tasks.loading} fallback={<span class="hint">Lade…</span>}>
            {(tasks() ?? []).length} Aufgaben
          </Show>
        </span>
      </header>

      <div class="agenda-filters">
        <div class="agenda-presets" role="tablist" aria-label="Filter-Presets">
          <For each={PRESETS}>
            {(preset) => (
              <button
                type="button"
                class="agenda-preset-btn click-pulse"
                classList={{ 'agenda-preset-active': presetKey() === preset.key }}
                onClick={() => setPresetKey(preset.key)}
                role="tab"
                aria-selected={presetKey() === preset.key}
              >
                {preset.label}
              </button>
            )}
          </For>
        </div>
        <div class="agenda-search-row">
          <input
            type="search"
            class="agenda-search-input"
            placeholder="Suche im Label…"
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
          />
          <input
            type="text"
            class="agenda-who-input"
            placeholder="Wer (z.B. mb)"
            value={who()}
            onInput={(e) => setWho(e.currentTarget.value)}
          />
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
                  <span
                    class="agenda-deadline"
                    classList={{ [`agenda-deadline-${dl.variant}`]: true }}
                  >
                    <Icon name="calendar" size={12} />
                    {dl.text}
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
    </div>
  );
};

export default Agenda;
