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
import AtomMarkerBar from '../components/AtomMarkerBar';
import Icon from '../components/Icon';
import { pageEnter } from '../lib/animations';
import { fetchAtomMarkersForWorkspace } from '../lib/atom-markers';
import { useUser } from '../lib/auth';
import { translateDbError } from '../lib/errors';
import { installEscReturn } from '../lib/keyboard-nav';
import { fetchAllChecklists } from '../lib/queries';
import {
  addDependency,
  fetchDependencies,
  getBlockedBy,
  getBlockersOf,
  removeDependency,
} from '../lib/task-dependencies';
import { fetchManifestationsByTask, fetchTask, fetchTasks, setTaskStatus } from '../lib/tasks';
import { showToast } from '../lib/toasts';
import type {
  ChecklistRow,
  TaskDependencyRow,
  TaskManifestationKind,
  TaskManifestationRow,
  TaskRow,
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
  const user = useUser();
  const [busy, setBusy] = createSignal(false);

  const [task, { refetch: refetchTask }] = createResource(
    () => params.taskId,
    async (tid) => (tid ? await fetchTask(tid) : null),
  );

  const [manifestations] = createResource(
    () => params.taskId,
    async (tid) => (tid ? await fetchManifestationsByTask(tid) : []),
  );

  // §13.3 V2.B: Workspace-Markers fuer den AtomMarkerBar im Header.
  // Wird auf (atom_type='task', atom_id=task.id) clientseitig gefiltert.
  // Eigene Resource statt Workspace.tsx-Bundle, weil TaskDetail eine
  // eigenstaendige Route ist (Direct-Open via /w/<wid>/task/<tid>).
  const [wsAtomMarkers] = createResource(
    () => params.workspaceId,
    async (wid) => (wid ? await fetchAtomMarkersForWorkspace(wid) : []),
  );
  const taskMarkers = createMemo(() =>
    (wsAtomMarkers() ?? []).filter((m) => m.atom_type === 'task' && m.atom_id === params.taskId),
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

  // T.3 — Task-Dependencies: alle Workspace-Deps + alle Tasks (fuer
  // Picker-Auswahl). Beide Resources sind workspace-scope und werden
  // schon aus anderen Pfaden mitgepflegt, hier nur Direkt-Read.
  const [allTasks] = createResource(
    () => params.workspaceId,
    async (wid) => (wid ? await fetchTasks(wid) : []),
  );
  const [dependencies, { refetch: refetchDeps }] = createResource(
    () => params.workspaceId,
    async (wid) => (wid ? await fetchDependencies(wid) : []),
  );

  const taskById = createMemo<Map<string, TaskRow>>(
    () => new Map((allTasks() ?? []).map((t) => [t.id, t])),
  );
  const blockers = createMemo<TaskDependencyRow[]>(() =>
    getBlockersOf(params.taskId, dependencies() ?? []),
  );
  const blockedBy = createMemo<TaskDependencyRow[]>(() =>
    getBlockedBy(params.taskId, dependencies() ?? []),
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

  const [picker, setPicker] = createSignal<'blocker' | 'blocked' | null>(null);
  const [pickerQuery, setPickerQuery] = createSignal('');

  // Kandidaten fuer den Picker: alle Workspace-Tasks ausser dieser
  // selbst und ausser den schon verknuepften (Direction-bezogen, damit
  // wir nicht versehentlich eine Doublette versuchen).
  const pickerCandidates = createMemo<TaskRow[]>(() => {
    const mode = picker();
    if (!mode) return [];
    const all = allTasks() ?? [];
    const linkedIds = new Set<string>();
    if (mode === 'blocker') {
      for (const d of blockers()) linkedIds.add(d.blocker_task_id);
    } else {
      for (const d of blockedBy()) linkedIds.add(d.blocked_task_id);
    }
    const q = pickerQuery().trim().toLowerCase();
    return all
      .filter((t) => t.id !== params.taskId && !linkedIds.has(t.id))
      .filter((t) => (q ? (t.label || '').toLowerCase().includes(q) : true))
      .slice(0, 25);
  });

  async function addDep(otherTaskId: string) {
    const mode = picker();
    if (!mode || !otherTaskId) return;
    try {
      await addDependency({
        workspace_id: params.workspaceId,
        blocker_task_id: mode === 'blocker' ? otherTaskId : params.taskId,
        blocked_task_id: mode === 'blocker' ? params.taskId : otherTaskId,
      });
      setPicker(null);
      setPickerQuery('');
      void refetchDeps();
      showToast('Abhaengigkeit hinzugefuegt.', 'success');
    } catch (err) {
      // Server-Side-Trigger raisen check_violation bei Zyklus + Workspace-
      // Mismatch; unique_violation bei Doublette. Pattern via Code-Match.
      const code = (err as { code?: string }).code;
      const msg =
        code === '23505'
          ? 'Diese Abhaengigkeit existiert bereits.'
          : code === '23514'
            ? 'Nicht moeglich: Zyklus oder Selbst-Bezug.'
            : translateDbError(err, 'Hinzufuegen fehlgeschlagen.');
      showToast(msg, 'error');
    }
  }

  async function removeDep(depId: string) {
    try {
      await removeDependency(depId, params.workspaceId);
      void refetchDeps();
      showToast('Abhaengigkeit entfernt.', 'success');
    } catch (err) {
      showToast(translateDbError(err, 'Entfernen fehlgeschlagen.'), 'error');
    }
  }

  function taskLabel(id: string): string {
    return taskById().get(id)?.label || `(Task ${id.slice(0, 8)}…)`;
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
        {/* §13.3 V2.B: Marker-Bar (Star+Eye) im Task-Detail-Header. Nur
            wenn User-Session + Task geladen ist. */}
        <Show when={user() && task()}>
          <AtomMarkerBar
            workspaceId={params.workspaceId}
            userId={(user() as { id: string }).id}
            atomType="task"
            atomId={params.taskId}
            markers={taskMarkers()}
          />
        </Show>
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
              <aside
                class="task-derived-banner"
                classList={{ live: t().derive_sync_mode === 'live' }}
              >
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

            <section class="task-detail-section task-detail-deps">
              <h3>Abhaengigkeiten</h3>
              <div class="task-deps-grid">
                <div class="task-deps-col">
                  <h4>
                    Wird blockiert von ({blockers().length})
                    <button
                      type="button"
                      class="btn-subtle btn-mini"
                      onClick={() => {
                        setPicker('blocker');
                        setPickerQuery('');
                      }}
                      title="Vorgaenger hinzufuegen"
                    >
                      <Icon name="plus" size={12} /> Hinzufuegen
                    </button>
                  </h4>
                  <Show
                    when={blockers().length > 0}
                    fallback={<p class="hint">Keine Vorgaenger.</p>}
                  >
                    <ul class="task-deps-list">
                      <For each={blockers()}>
                        {(d) => (
                          <li class="task-deps-row">
                            <span class="task-deps-label">{taskLabel(d.blocker_task_id)}</span>
                            <Show
                              when={taskById().get(d.blocker_task_id)?.status === 'done'}
                              fallback={
                                <span class="badge badge-subtle" title="noch offen">
                                  offen
                                </span>
                              }
                            >
                              <span class="badge badge-success" title="erledigt">
                                fertig
                              </span>
                            </Show>
                            <button
                              type="button"
                              class="btn-subtle btn-mini"
                              onClick={() => void removeDep(d.id)}
                              title="Abhaengigkeit entfernen"
                            >
                              <Icon name="x" size={12} />
                            </button>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </div>
                <div class="task-deps-col">
                  <h4>
                    Blockiert ({blockedBy().length})
                    <button
                      type="button"
                      class="btn-subtle btn-mini"
                      onClick={() => {
                        setPicker('blocked');
                        setPickerQuery('');
                      }}
                      title="Nachfolger hinzufuegen"
                    >
                      <Icon name="plus" size={12} /> Hinzufuegen
                    </button>
                  </h4>
                  <Show when={blockedBy().length > 0} fallback={<p class="hint">Nichts.</p>}>
                    <ul class="task-deps-list">
                      <For each={blockedBy()}>
                        {(d) => (
                          <li class="task-deps-row">
                            <span class="task-deps-label">{taskLabel(d.blocked_task_id)}</span>
                            <button
                              type="button"
                              class="btn-subtle btn-mini"
                              onClick={() => void removeDep(d.id)}
                              title="Abhaengigkeit entfernen"
                            >
                              <Icon name="x" size={12} />
                            </button>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </div>
              </div>

              <Show when={picker()}>
                <div class="task-deps-picker">
                  <header>
                    <strong>
                      {picker() === 'blocker' ? 'Vorgaenger waehlen' : 'Nachfolger waehlen'}
                    </strong>
                    <button
                      type="button"
                      class="btn-subtle btn-mini"
                      onClick={() => setPicker(null)}
                    >
                      Abbrechen
                    </button>
                  </header>
                  <input
                    class="input"
                    type="search"
                    placeholder="Suchen…"
                    value={pickerQuery()}
                    onInput={(e) => setPickerQuery(e.currentTarget.value)}
                    autofocus
                  />
                  <Show
                    when={pickerCandidates().length > 0}
                    fallback={<p class="hint">Keine passenden Tasks.</p>}
                  >
                    <ul class="task-deps-picker-list">
                      <For each={pickerCandidates()}>
                        {(cand) => (
                          <li>
                            <button
                              type="button"
                              class="task-deps-picker-row"
                              onClick={() => void addDep(cand.id)}
                            >
                              <span>{cand.label || '(ohne Label)'}</span>
                              <span class="hint">{cand.status}</span>
                            </button>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </div>
              </Show>
            </section>

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
