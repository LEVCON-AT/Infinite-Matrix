// Settings → Konto → Sichtbarkeit. Phase 1 (P1.A).
//
// Portiert die `vis`-Sektion aus dem alten SettingsModal hierher.
// Same Settings-Store, same Reset-Logik — nur die Praesentation
// wandert in eine eigene Page mit Outlet-Layout statt Modal.

import { useParams } from '@solidjs/router';
import { For, Show } from 'solid-js';
import Icon from '../../components/Icon';
import { showChoice } from '../../lib/dialog';
import { translateDbError } from '../../lib/errors';
import { clearWorkspaceQueue, pendingMutationCount, replayQueue } from '../../lib/mutation-queue';
import { clearAll as clearOfflineCache } from '../../lib/offline-cache';
import { resetOfflineState } from '../../lib/offline-state';
import {
  ACTIVITY_OPTIONS,
  type ActivityLevel,
  VIS_GROUPS,
  VIS_LABELS,
  VIS_OPTIONS,
  type VisKey,
  resetSettings,
  setActivityLevel,
  setVis,
  useSettings,
} from '../../lib/settings';
import { showToast } from '../../lib/toasts';

const AccountVisibility = () => {
  const settings = useSettings();
  const params = useParams<{ workspaceId?: string }>();

  return (
    <article class="settings-pane">
      <header class="settings-pane-head">
        <h2>Sichtbarkeit</h2>
        <p class="hint">
          Steuert, welche Bedienelemente du siehst. „Nur Edit-Modus" ist der Default — Edit toggelt
          man mit <kbd>Shift</kbd>+<kbd>E</kbd>.
        </p>
      </header>

      <section class="settings-form-section" aria-labelledby="activity-level-head">
        <h3 id="activity-level-head">Aktivitaets-Sichtbarkeit</h3>
        <p class="hint">
          Steuert, was andere Workspace-Mitglieder von dir sehen. Den schnellen Ein/Aus-Schalter
          findest du oben rechts in der Workspace-Leiste.
        </p>
        <div class="settings-radio-group" role="radiogroup" aria-labelledby="activity-level-head">
          <For each={ACTIVITY_OPTIONS}>
            {([value, label, desc]) => (
              <label class="settings-radio">
                <input
                  type="radio"
                  name="activity-level"
                  value={value}
                  checked={settings().activity.level === value}
                  onChange={(e) => {
                    if (e.currentTarget.checked) {
                      setActivityLevel(e.currentTarget.value as ActivityLevel);
                    }
                  }}
                />
                <span class="settings-radio-body">
                  <span class="settings-radio-title">{label}</span>
                  <span class="settings-radio-desc">{desc}</span>
                </span>
              </label>
            )}
          </For>
        </div>
      </section>

      <For each={VIS_GROUPS}>
        {(group) => (
          <section class="settings-form-section">
            <h3>{group.title}</h3>
            <dl class="settings-list">
              <For each={group.keys}>
                {(key) => (
                  <>
                    <dt class="settings-label">
                      <label for={`settings-vis-${key}`}>{VIS_LABELS[key]}</label>
                    </dt>
                    <dd class="settings-control">
                      <select
                        id={`settings-vis-${key}`}
                        class="settings-select"
                        value={settings().vis[key]}
                        onChange={(e) =>
                          setVis(
                            key as VisKey,
                            e.currentTarget.value as 'edit' | 'always' | 'never',
                          )
                        }
                      >
                        <For each={VIS_OPTIONS}>{([v, l]) => <option value={v}>{l}</option>}</For>
                      </select>
                    </dd>
                  </>
                )}
              </For>
            </dl>
          </section>
        )}
      </For>

      <Show when={pendingMutationCount() > 0 && params.workspaceId}>
        <section class="settings-form-section">
          <h3>Synchronisation</h3>
          <p class="hint">
            {pendingMutationCount()} offline-Aenderungen warten auf Synchronisation. Beim naechsten
            Online-Event laufen sie automatisch durch — du kannst aber auch direkt anstossen.
          </p>
          <div class="settings-foot">
            <button
              type="button"
              class="btn-subtle"
              onClick={() => {
                void (async () => {
                  const wsId = params.workspaceId as string;
                  const res = await replayQueue(wsId);
                  if (res.skippedBusy) {
                    showToast('Sync laeuft bereits.', 'info');
                    return;
                  }
                  const total = res.succeeded + res.staled + res.failed;
                  if (total === 0) {
                    showToast('Keine Aenderung synchronisierbar — wahrscheinlich offline.', 'info');
                  } else {
                    showToast(
                      `Sync: ${res.succeeded} ok · ${res.staled} veraltet · ${res.failed} Fehler.`,
                      res.failed > 0 || res.staled > 0 ? 'error' : 'success',
                    );
                  }
                })();
              }}
            >
              <Icon name="arrow-path" size={14} />
              <span>Jetzt synchronisieren</span>
            </button>
            <button
              type="button"
              class="btn-subtle"
              onClick={() => {
                void (async () => {
                  const ok = await showChoice({
                    title: 'Queue verwerfen',
                    message:
                      'Alle pending Offline-Aenderungen unwiderruflich loeschen? Sie werden nicht mehr nachgezogen.',
                    choices: [
                      { id: 'clear', label: 'Verwerfen', variant: 'danger' },
                      { id: 'cancel', label: 'Abbrechen', variant: 'default' },
                    ],
                  });
                  if (ok !== 'clear') return;
                  try {
                    await clearWorkspaceQueue(params.workspaceId as string);
                    showToast('Sync-Queue geleert.', 'success');
                  } catch (err) {
                    showToast(translateDbError(err), 'error');
                  }
                })();
              }}
            >
              <Icon name="trash" size={14} />
              <span>Queue verwerfen</span>
            </button>
          </div>
        </section>
      </Show>

      <section class="settings-form-section">
        <h3>Wartung</h3>
        <div class="settings-foot">
          <button
            type="button"
            class="btn-subtle"
            onClick={() => {
              void (async () => {
                const ok = await showChoice({
                  title: 'Einstellungen zuruecksetzen',
                  message: 'Alle Sichtbarkeits-Einstellungen auf Default setzen?',
                  choices: [
                    { id: 'reset', label: 'Zuruecksetzen', variant: 'danger' },
                    { id: 'cancel', label: 'Abbrechen', variant: 'default' },
                  ],
                });
                if (ok === 'reset') resetSettings();
              })();
            }}
          >
            <Icon name="arrow-uturn-left" size={14} />
            <span>Zuruecksetzen</span>
          </button>
          <button
            type="button"
            class="btn-subtle"
            title="Offline-Cache (IndexedDB) leeren — beim naechsten Read werden die Daten frisch vom Server geladen."
            onClick={() => {
              void (async () => {
                const ok = await showChoice({
                  title: 'Offline-Cache leeren',
                  message:
                    'Loescht alle gespeicherten Workspace-Daten aus dem lokalen IndexedDB-Cache. Beim naechsten Reload werden alle Daten frisch vom Server gezogen — beim Online-Stand kein Datenverlust, offline aber leere Sicht.',
                  choices: [
                    { id: 'clear', label: 'Cache leeren', variant: 'danger' },
                    { id: 'cancel', label: 'Abbrechen', variant: 'default' },
                  ],
                });
                if (ok !== 'clear') return;
                try {
                  await clearOfflineCache();
                  resetOfflineState();
                  showToast('Offline-Cache geleert.', 'success');
                } catch (err) {
                  showToast(translateDbError(err), 'error');
                }
              })();
            }}
          >
            <Icon name="trash" size={14} />
            <span>Cache leeren</span>
          </button>
        </div>
      </section>
    </article>
  );
};

export default AccountVisibility;
