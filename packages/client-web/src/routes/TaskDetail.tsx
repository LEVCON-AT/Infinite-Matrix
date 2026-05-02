// Phase 4 T.1.F — Task-Detail-Page.
//
// Eine Task hat einen Aggregate-Root (TaskRow) und 0..N Manifestations
// (kanban/checklist/calendar/standalone). Diese Seite zeigt:
//   - Header mit Back-Button + Task-Label.
//   - Status-Toggle-Pills (Inline-Update via setTaskStatus).
//   - Deadline / Recur / Who.
//   - Notes-Area (read-only V1; Edit kommt mit T.2).
//   - Manifestations-Liste mit Container-Label + Kind-Icon + Position.
//   - "+ Sicht hinzufuegen" — disabled-Stub fuer T.1.G.2 (Drag-USP).

import { useNavigate, useParams } from '@solidjs/router';
import { type Component, For, Show, createMemo, createResource, createSignal } from 'solid-js';
import Icon from '../components/Icon';
import { pageEnter } from '../lib/animations';
import { translateDbError } from '../lib/errors';
import { installEscReturn } from '../lib/keyboard-nav';
import { fetchAllChecklists } from '../lib/queries';
import { fetchManifestationsByTask, fetchTask, setTaskStatus } from '../lib/tasks';
import { showToast } from '../lib/toasts';
import type {
  ChecklistRow,
  TaskManifestationKind,
  TaskManifestationRow,
  TaskStatus,
} from '../lib/types';

type RouteParams = { workspaceId: string; taskId: string };

const STATUS_OPTIONS: Array<{ value: TaskStatus; label: string }> = [
  { value: 'open', label: 'Offen' },
  { value: 'in_progress', label: 'In Arbeit' },
  { value: 'blocked', label: 'Blockiert' },
  { value: 'done', label: 'Erledigt' },
  { value: 'archived', label: 'Archiviert' },
];

function kindIcon(
  kind: TaskManifestationKind,
): 'view-columns' | 'check-circle' | 'calendar' | 'tag' {
  switch (kind) {
    case 'kanban':
      return 'view-columns';
    case 'checklist':
      return 'check-circle';
    case 'calendar':
      return 'calendar';
    case 'standalone':
      return 'tag';
  }
}

function kindLabel(kind: TaskManifestationKind): string {
  switch (kind) {
    case 'kanban':
      return 'Kanban-Karte';
    case 'checklist':
      return 'Checklist-Eintrag';
    case 'calendar':
      return 'Kalender-Termin';
    case 'standalone':
      return 'Frei';
  }
}

const TaskDetail: Component = () => {
  const params = useParams<RouteParams>();
  const navigate = useNavigate();
  const [busy, setBusy] = createSignal(false);

  const [task, { refetch: refetchTask }] = createResource(
    () => params.taskId,
    async (tid) => (tid ? await fetchTask(tid) : null),
  );

  const [manifestations] = createResource(
    () => params.taskId,
    async (tid) => (tid ? await fetchManifestationsByTask(tid) : []),
  );

  // Checklists workspace-weit fuer Container-Label-Aufloesung. Kanban-
  // Manifestations zeigen kb_col-Label spaeter; fuer T.1.F reicht der
  // Container-Identifier (UUID) als Fallback.
  const [checklists] = createResource(
    () => params.workspaceId,
    async (wid) => (wid ? await fetchAllChecklists(wid) : []),
  );

  const checklistById = createMemo<Map<string, ChecklistRow>>(
    () => new Map((checklists() ?? []).map((c) => [c.id, c])),
  );

  // History-aware: navigate(-1) erhaelt den Filter-State der Agenda
  // (inkl. customDate aus Calendar-Drilldown). Wenn der User direkt
  // /task/:taskId aufgerufen hat, faellt Browser-Default auf
  // vorherige History-Page.
  function backToAgenda() {
    navigate(-1);
  }

  installEscReturn(backToAgenda);

  async function setStatus(s: TaskStatus) {
    const t = task();
    if (!t || busy() || t.status === s) return;
    setBusy(true);
    try {
      await setTaskStatus(t.id, s);
      void refetchTask();
    } catch (err) {
      console.error('setTaskStatus:', err);
      showToast(translateDbError(err, 'Status konnte nicht geaendert werden.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  function manifContainerLabel(m: TaskManifestationRow): string {
    if (m.kind === 'checklist' && m.container_id) {
      const cl = checklistById().get(m.container_id);
      return cl?.label || '(unbekannte Liste)';
    }
    if (m.kind === 'kanban' && m.container_id) {
      // V1: nur container-id. Spalten-Label aufloesen kommt mit T.SS.
      return `Spalte ${m.container_id.slice(0, 8)}…`;
    }
    if (m.kind === 'calendar') return 'Kalender';
    if (m.kind === 'standalone') return '—';
    return '?';
  }

  return (
    <div
      class="task-detail-page"
      ref={(el) => {
        pageEnter(el);
      }}
    >
      <header class="agenda-head">
        <button
          type="button"
          class="obj-detail-back click-pulse"
          onClick={backToAgenda}
          aria-label="Zurueck zur Agenda"
        >
          <Icon name="arrow-left" size={18} />
        </button>
        <h1 class="agenda-title">
          <Show when={task()} fallback="Aufgabe">
            {(t) => t().label || '(ohne Label)'}
          </Show>
        </h1>
      </header>

      <Show
        when={task()}
        fallback={
          <p class="hint">
            <Show when={!task.loading} fallback="Lade…">
              Aufgabe nicht gefunden.
            </Show>
          </p>
        }
      >
        {(t) => (
          <div class="task-detail-body">
            <Show when={t().derived_from_external_event_id}>
              <aside class="task-derived-banner" classList={{ live: t().derive_sync_mode === 'live' }}>
                <Icon name="arrow-top-right-on-square" size={14} />
                <span>
                  <strong>Aus externem Termin abgeleitet</strong>
                  {t().derive_sync_mode === 'live'
                    ? ' (live verbunden — Sync folgt)'
                    : ' (Snapshot — unabhaengig vom Original)'}
                  <Show when={t().derive_scope === 'series'}> · komplette Serie</Show>
                </span>
              </aside>
            </Show>
            <section class="task-detail-section">
              <h3>Status</h3>
              <div class="task-status-toggle">
                <For each={STATUS_OPTIONS}>
                  {(opt) => (
                    <button
                      type="button"
                      class="task-status-btn click-pulse"
                      classList={{ 'task-status-active': t().status === opt.value }}
                      onClick={() => void setStatus(opt.value)}
                      disabled={busy()}
                    >
                      {opt.label}
                    </button>
                  )}
                </For>
              </div>
            </section>

            <section class="task-detail-section">
              <h3>Eckdaten</h3>
              <dl class="task-detail-meta">
                <dt>Deadline</dt>
                <dd>{t().deadline ?? '—'}</dd>
                <dt>Wer</dt>
                <dd>
                  <Show when={(t().who ?? []).length > 0} fallback="—">
                    {(t().who ?? []).join(', ')}
                  </Show>
                </dd>
                <dt>Wiederholung</dt>
                <dd>
                  <Show when={t().recur} fallback="—">
                    {(t().recur as { type?: string } | null)?.type ?? 'ja'}
                  </Show>
                </dd>
              </dl>
            </section>

            <Show when={t().note}>
              <section class="task-detail-section">
                <h3>Notiz</h3>
                <p class="task-detail-note">{t().note}</p>
              </section>
            </Show>

            <section class="task-detail-section">
              <h3>Manifestationen ({(manifestations() ?? []).length})</h3>
              <Show
                when={(manifestations() ?? []).length > 0}
                fallback={<p class="hint">Diese Aufgabe hat noch keine Sicht.</p>}
              >
                <ul class="task-manif-list">
                  <For each={manifestations() ?? []}>
                    {(m) => (
                      <li class="task-manif-row" classList={{ [`task-manif-${m.kind}`]: true }}>
                        <Icon name={kindIcon(m.kind)} size={14} />
                        <span class="task-manif-kind">{kindLabel(m.kind)}</span>
                        <span class="task-manif-container">{manifContainerLabel(m)}</span>
                        <span class="task-manif-pos">Pos {m.position}</span>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
              <button
                type="button"
                class="task-manif-add-stub"
                disabled
                title="Drag-to-Create-Manifestation kommt mit T.1.G.2"
              >
                <Icon name="plus" size={14} /> Sicht hinzufuegen
              </button>
            </section>
          </div>
        )}
      </Show>

      <footer class="kb-hint-bar">
        <span>
          <kbd>Esc</kbd> zurueck zur Agenda
        </span>
      </footer>
    </div>
  );
};

export default TaskDetail;
