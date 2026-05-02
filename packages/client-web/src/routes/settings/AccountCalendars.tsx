// Settings → Konto → Externe Kalender (Welle I.6).
//
// Listet alle external_calendars des Users (workspace-uebergreifend),
// inkl. Status, Last-Sync, Color-Picker, Sync-Intervall-Select,
// Pull-Now-Button, Toggle, Loeschen. "+ Calendar verbinden"-Button
// oeffnet AddExternalCalendarModal.

import { useParams } from '@solidjs/router';
import { type Component, For, Show, createMemo, createResource, createSignal } from 'solid-js';
import AddExternalCalendarModal from '../../components/AddExternalCalendarModal';
import Icon from '../../components/Icon';
import { useSession } from '../../lib/auth';
import {
  deleteExternalCalendar,
  fetchExternalCalendars,
  triggerExternalCalendarSync,
  updateExternalCalendar,
} from '../../lib/calendar-inbound';
import { formatDateTimeDE } from '../../lib/dates';
import { showConfirm } from '../../lib/dialog';
import { translateDbError } from '../../lib/errors';
import { fetchMyWorkspaces } from '../../lib/queries';
import { showToast } from '../../lib/toasts';
import type { ExternalCalendar } from '../../lib/types';

const SYNC_INTERVAL_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 5, label: '5 Min' },
  { value: 10, label: '10 Min' },
  { value: 15, label: '15 Min' },
  { value: 30, label: '30 Min' },
  { value: 60, label: '1 Std' },
  { value: 120, label: '2 Std' },
  { value: 240, label: '4 Std' },
  { value: 480, label: '8 Std' },
  { value: 720, label: '12 Std' },
  { value: 1440, label: '24 Std' },
];

const KIND_LABEL: Record<ExternalCalendar['kind'], string> = {
  ics_subscribe: 'iCal',
  google: 'Google',
  microsoft: 'Outlook',
  upload: 'Datei',
};

const AccountCalendars: Component = () => {
  const params = useParams<{ workspaceId: string }>();
  const session = useSession();

  const [calendars, { refetch }] = createResource(
    () => session()?.user?.id ?? null,
    async () => {
      try {
        return await fetchExternalCalendars();
      } catch (err) {
        console.error('fetchExternalCalendars:', err);
        showToast(translateDbError(err, 'Kalender nicht ladbar.'), 'error');
        return [] as ExternalCalendar[];
      }
    },
  );

  const [workspaces] = createResource(
    () => session()?.user?.id ?? null,
    () => fetchMyWorkspaces(),
  );

  const wsLabel = createMemo<Map<string, string>>(() => {
    const m = new Map<string, string>();
    for (const ws of workspaces() ?? []) m.set(ws.id, ws.name);
    return m;
  });

  const [addOpen, setAddOpen] = createSignal(false);
  const [busyId, setBusyId] = createSignal<string | null>(null);

  async function onPullNow(cal: ExternalCalendar): Promise<void> {
    setBusyId(cal.id);
    try {
      await triggerExternalCalendarSync(cal.id);
      showToast('Sync angefordert.', 'success');
      // Nach kurzer Verzoegerung refetchen damit last_sync_at sichtbar wird.
      setTimeout(() => void refetch(), 1500);
    } catch (err) {
      showToast(translateDbError(err, 'Sync fehlgeschlagen.'), 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function onToggleEnabled(cal: ExternalCalendar): Promise<void> {
    setBusyId(cal.id);
    try {
      await updateExternalCalendar({ id: cal.id, enabled: !cal.enabled });
      void refetch();
    } catch (err) {
      showToast(translateDbError(err, 'Aenderung fehlgeschlagen.'), 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function onChangeColor(cal: ExternalCalendar, color: string): Promise<void> {
    setBusyId(cal.id);
    try {
      await updateExternalCalendar({ id: cal.id, color });
      void refetch();
    } catch (err) {
      showToast(translateDbError(err, 'Farbe konnte nicht gespeichert werden.'), 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function onChangeInterval(cal: ExternalCalendar, value: number): Promise<void> {
    setBusyId(cal.id);
    try {
      await updateExternalCalendar({ id: cal.id, syncIntervalMinutes: value });
      void refetch();
    } catch (err) {
      showToast(translateDbError(err, 'Intervall konnte nicht gespeichert werden.'), 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function onDelete(cal: ExternalCalendar): Promise<void> {
    const ok = await showConfirm({
      title: 'Kalender entfernen?',
      message: `„${cal.label}" und alle daraus importierten Termine werden geloescht. Tasks die aus diesen Terminen abgeleitet wurden bleiben (entkoppelt).`,
      confirmLabel: 'Entfernen',
      variant: 'danger',
    });
    if (!ok) return;
    setBusyId(cal.id);
    try {
      await deleteExternalCalendar(cal.id);
      showToast('Kalender entfernt.', 'success');
      void refetch();
    } catch (err) {
      showToast(translateDbError(err, 'Loeschen fehlgeschlagen.'), 'error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <article class="settings-pane">
      <header class="settings-pane-head">
        <h2>Externe Kalender</h2>
        <p class="hint">
          Outlook / Google / Apple / iCal Kalender abonnieren. Importierte Termine erscheinen im
          Matrix-Calendar mit Provider-Farbe + Badge — aus jedem Termin kannst Du eine Task
          ableiten (Snapshot oder live verbunden).
        </p>
      </header>

      <section class="settings-form-section" id="add-calendar-head">
        <button type="button" class="btn btn-primary lift" onClick={() => setAddOpen(true)}>
          <Icon name="arrow-top-right-on-square" size={14} />
          <span>Kalender verbinden</span>
        </button>
      </section>

      <Show
        when={(calendars() ?? []).length > 0}
        fallback={
          <section class="settings-form-section">
            <p class="settings-empty">Noch kein externer Kalender verbunden.</p>
          </section>
        }
      >
        <section class="settings-form-section">
          <h3>Verbundene Kalender</h3>
          <ul class="ext-cal-list">
            <For each={calendars() ?? []}>
              {(cal) => (
                <li
                  class="ext-cal-row"
                  classList={{ disabled: !cal.enabled, busy: busyId() === cal.id }}
                >
                  <div class="ext-cal-color-cell">
                    <input
                      type="color"
                      value={cal.color}
                      class="ext-cal-color"
                      onChange={(e) => void onChangeColor(cal, e.currentTarget.value)}
                      disabled={busyId() === cal.id}
                      aria-label="Farbe"
                    />
                  </div>
                  <div class="ext-cal-main">
                    <div class="ext-cal-label">
                      <strong>{cal.label}</strong>
                      <span class="ext-cal-kind-badge">{KIND_LABEL[cal.kind]}</span>
                      <Show when={!cal.enabled}>
                        <span class="ext-cal-status-chip off">aus</span>
                      </Show>
                      <Show when={cal.sync_status === 'syncing'}>
                        <span class="ext-cal-status-chip syncing">syncing</span>
                      </Show>
                      <Show when={cal.sync_status === 'error'}>
                        <span class="ext-cal-status-chip error" title={cal.last_error_msg ?? ''}>
                          error
                        </span>
                      </Show>
                    </div>
                    <div class="ext-cal-meta">
                      <span>{wsLabel().get(cal.workspace_id) ?? '—'}</span>
                      <Show when={cal.source_url}>
                        <span class="ext-cal-source-url" title={cal.source_url ?? ''}>
                          {(cal.source_url ?? '').replace(/^https?:\/\//, '').slice(0, 40)}…
                        </span>
                      </Show>
                      <Show when={cal.last_sync_at}>
                        <span>Sync: {formatDateTimeDE(cal.last_sync_at!)}</span>
                      </Show>
                    </div>
                  </div>

                  <div class="ext-cal-actions">
                    <Show when={cal.kind === 'ics_subscribe' || cal.kind === 'google' || cal.kind === 'microsoft'}>
                      <select
                        class="input ext-cal-interval"
                        value={cal.sync_interval_minutes}
                        onChange={(e) =>
                          void onChangeInterval(cal, Number(e.currentTarget.value))
                        }
                        disabled={busyId() === cal.id}
                        aria-label="Sync-Intervall"
                      >
                        <For each={SYNC_INTERVAL_OPTIONS}>
                          {(o) => <option value={o.value}>{o.label}</option>}
                        </For>
                      </select>
                      <button
                        type="button"
                        class="btn btn-subtle"
                        onClick={() => void onPullNow(cal)}
                        disabled={busyId() === cal.id || !cal.enabled}
                        title="Jetzt syncen"
                      >
                        <Icon name="arrow-top-right-on-square" size={14} />
                        <span>Sync</span>
                      </button>
                    </Show>
                    <button
                      type="button"
                      class="btn btn-subtle"
                      onClick={() => void onToggleEnabled(cal)}
                      disabled={busyId() === cal.id}
                    >
                      {cal.enabled ? 'Pausieren' : 'Aktivieren'}
                    </button>
                    <button
                      type="button"
                      class="btn btn-danger-subtle"
                      onClick={() => void onDelete(cal)}
                      disabled={busyId() === cal.id}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>

      <Show when={addOpen()}>
        <AddExternalCalendarModal
          defaultWorkspaceId={params.workspaceId}
          onClose={() => setAddOpen(false)}
          onAdded={() => void refetch()}
        />
      </Show>
    </article>
  );
};

export default AccountCalendars;
