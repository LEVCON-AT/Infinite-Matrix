// Settings-Modal: vis-Keys mit Select pro Gruppe. Zuruecksetzen-Button
// am Ende. ESC (capture) schliesst; Backdrop-Klick schliesst ebenfalls.
// Kein Focus-Trap — ausreichend: onMount setzt Fokus auf das erste Select,
// Tab wandert natuerlich durch die Rows.

import { useParams } from '@solidjs/router';
import { type Component, For, Show, onCleanup, onMount } from 'solid-js';
import { installFocusRestore, showChoice } from '../lib/dialog';
import { translateDbError } from '../lib/errors';
import { clearWorkspaceQueue, pendingMutationCount, replayQueue } from '../lib/mutation-queue';
import { clearAll as clearOfflineCache } from '../lib/offline-cache';
import { resetOfflineState } from '../lib/offline-state';
import {
  VIS_GROUPS,
  VIS_LABELS,
  VIS_OPTIONS,
  type VisKey,
  resetSettings,
  setVis,
  useSettings,
} from '../lib/settings';
import { showToast } from '../lib/toasts';
import Icon from './Icon';

type Props = {
  onClose: () => void;
};

const SettingsModal: Component<Props> = (p) => {
  const settings = useSettings();
  const params = useParams<{ workspaceId?: string }>();
  let firstSelect: HTMLSelectElement | undefined;

  onMount(() => {
    onCleanup(installFocusRestore());
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      p.onClose();
    };
    document.addEventListener('keydown', h, true);
    onCleanup(() => document.removeEventListener('keydown', h, true));
    // Fokus ins erste Select — Tastatur-Flow kann sofort ueber
    // Pfeiltasten die erste Sichtbarkeits-Regel aendern.
    firstSelect?.focus();
  });

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Backdrop-Klick — Tastatur via ESC-Capture im onMount.
    <div
      class="overlay-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) p.onClose();
      }}
    >
      <div
        class="overlay-card settings-card"
        // biome-ignore lint/a11y/useSemanticElements: <div role="dialog"> bewusst statt <dialog> — showModal() haette aufwendige Migration aller Modals zur Folge.
        role="dialog"
        aria-modal="true"
        aria-label="Einstellungen"
      >
        <header class="overlay-head">
          <h3>Einstellungen</h3>
          <button type="button" class="overlay-close" onClick={p.onClose} aria-label="Schliessen">
            <Icon name="x" size={18} />
          </button>
        </header>
        <div class="overlay-body settings-body">
          <p class="settings-hint hint">
            Sichtbarkeit der Bedienelemente. „Nur Edit-Modus" ist der Default — Edit toggelt man mit{' '}
            <kbd>Shift</kbd>+<kbd>E</kbd>.
          </p>
          <For each={VIS_GROUPS}>
            {(group, groupIdx) => (
              <section class="settings-group">
                <h4>{group.title}</h4>
                <dl class="settings-list">
                  <For each={group.keys}>
                    {(key, keyIdx) => {
                      const isFirst = groupIdx() === 0 && keyIdx() === 0;
                      return (
                        <>
                          <dt class="settings-label">
                            <label for={`settings-vis-${key}`}>{VIS_LABELS[key]}</label>
                          </dt>
                          <dd class="settings-control">
                            <select
                              id={`settings-vis-${key}`}
                              class="settings-select"
                              ref={
                                isFirst
                                  ? (el) => {
                                      firstSelect = el;
                                    }
                                  : undefined
                              }
                              value={settings().vis[key]}
                              onChange={(e) =>
                                setVis(
                                  key as VisKey,
                                  e.currentTarget.value as 'edit' | 'always' | 'never',
                                )
                              }
                            >
                              <For each={VIS_OPTIONS}>
                                {([v, l]) => <option value={v}>{l}</option>}
                              </For>
                            </select>
                          </dd>
                        </>
                      );
                    }}
                  </For>
                </dl>
              </section>
            )}
          </For>
          <Show when={pendingMutationCount() > 0 && params.workspaceId}>
            <section class="settings-group">
              <h4>Synchronisation</h4>
              <p class="hint">
                {pendingMutationCount()} offline-Aenderungen warten auf Synchronisation. Beim
                naechsten Online-Event laufen sie automatisch durch — du kannst aber auch direkt
                anstossen.
              </p>
              <div class="settings-foot" style="margin-top:var(--space-sm);gap:var(--space-sm);">
                <button
                  type="button"
                  class="btn-subtle"
                  onClick={() => {
                    void (async () => {
                      const res = await replayQueue(params.workspaceId as string);
                      if (res.skippedBusy) {
                        showToast('Sync laeuft bereits.', 'info');
                        return;
                      }
                      const total = res.succeeded + res.staled + res.failed;
                      if (total === 0) {
                        showToast(
                          'Keine Aenderung synchronisierbar — wahrscheinlich offline.',
                          'info',
                        );
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
                          {
                            id: 'clear',
                            label: 'Verwerfen',
                            variant: 'danger',
                          },
                          {
                            id: 'cancel',
                            label: 'Abbrechen',
                            variant: 'default',
                          },
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
        </div>
        <footer class="overlay-foot settings-foot">
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
          <button type="button" class="btn-c" onClick={p.onClose}>
            Schliessen
          </button>
        </footer>
      </div>
    </div>
  );
};

export default SettingsModal;
