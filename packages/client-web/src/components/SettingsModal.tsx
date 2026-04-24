// Settings-Modal: vis-Keys mit Select pro Gruppe. Zuruecksetzen-Button
// am Ende. ESC (capture) schliesst; Backdrop-Klick schliesst ebenfalls.
// Kein Focus-Trap — ausreichend: onMount setzt Fokus auf das erste Select,
// Tab wandert natuerlich durch die Rows.

import { For, onCleanup, onMount, type Component } from 'solid-js';
import Icon from './Icon';
import {
  VIS_GROUPS,
  VIS_LABELS,
  VIS_OPTIONS,
  resetSettings,
  setVis,
  useSettings,
  type VisKey,
} from '../lib/settings';
import { clearAll as clearOfflineCache } from '../lib/offline-cache';
import { resetOfflineState } from '../lib/offline-state';
import { showChoice } from '../lib/dialog';
import { showToast } from '../lib/toasts';
import { translateDbError } from '../lib/errors';

type Props = {
  onClose: () => void;
};

const SettingsModal: Component<Props> = (p) => {
  const settings = useSettings();
  let firstSelect: HTMLSelectElement | undefined;

  onMount(() => {
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
    <div
      class="overlay-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) p.onClose();
      }}
    >
      <div
        class="overlay-card settings-card"
        role="dialog"
        aria-modal="true"
        aria-label="Einstellungen"
      >
        <header class="overlay-head">
          <h3>Einstellungen</h3>
          <button
            type="button"
            class="overlay-close"
            onClick={p.onClose}
            aria-label="Schliessen"
          >
            <Icon name="x" size={18} />
          </button>
        </header>
        <div class="overlay-body settings-body">
          <p class="settings-hint hint">
            Sichtbarkeit der Bedienelemente. „Nur Edit-Modus" ist der
            Default — Edit toggelt man mit{' '}
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
                            <label for={`settings-vis-${key}`}>
                              {VIS_LABELS[key]}
                            </label>
                          </dt>
                          <dd class="settings-control">
                            <select
                              id={`settings-vis-${key}`}
                              class="settings-select"
                              ref={isFirst ? (el) => (firstSelect = el) : undefined}
                              value={settings().vis[key]}
                              onChange={(e) =>
                                setVis(
                                  key as VisKey,
                                  e.currentTarget.value as
                                    | 'edit'
                                    | 'always'
                                    | 'never',
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
