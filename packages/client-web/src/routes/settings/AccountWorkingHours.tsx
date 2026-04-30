// Settings → Konto → Arbeitszeiten (Phase 4 T.1.G.B Stufe 3).
//
// Pro Wochentag konfigurierbar: enabled, start, end, buffer-vor,
// buffer-nach. Persistiert ueber `lib/working-hours.ts` in
// `public.user_preferences.prefs.working_hours` (DB, nicht localStorage).
//
// Save ist debounced (siehe useWorkingHoursSync) — das Hook ist in
// App.tsx einmalig registriert. Hier nur State-Updates.

import { type Component, For, Show } from 'solid-js';
import {
  WEEKDAYS,
  WEEKDAY_LABEL_DE,
  type Weekday,
  setWorkingHours,
  workingHours,
} from '../../lib/working-hours';

const AccountWorkingHours: Component = () => {
  function patchDay(day: Weekday, patch: Partial<ReturnType<typeof workingHours>[Weekday]>): void {
    const cur = workingHours();
    setWorkingHours({
      ...cur,
      [day]: { ...cur[day], ...patch },
    });
  }

  function applyToAll(day: Weekday): void {
    const src = workingHours()[day];
    const cur = workingHours();
    const next = { ...cur };
    for (const d of WEEKDAYS) {
      next[d] = { ...src };
    }
    setWorkingHours(next);
  }

  return (
    <article class="settings-pane">
      <header class="settings-pane-head">
        <h2>Arbeitszeiten</h2>
        <p class="hint">
          Pro Wochentag Start- und Endzeit. Buffer-Bereiche (vor / nach) bleiben in der Tagesansicht
          sichtbar, sind aber visuell vom Hauptarbeitstag getrennt — fuer regelmaessige Vor-/Nach-
          bereitung. Ausserhalb des sichtbaren Bereichs werden Termine an die naechste Sicht-grenze
          geclamped.
        </p>
      </header>

      <section class="settings-form-section">
        <table class="working-hours-table">
          <thead>
            <tr>
              <th>Tag</th>
              <th>Aktiv</th>
              <th>Start</th>
              <th>Ende</th>
              <th>Buffer vor</th>
              <th>Buffer nach</th>
              <th aria-label="Aktion" />
            </tr>
          </thead>
          <tbody>
            <For each={WEEKDAYS}>
              {(d) => {
                const day = () => workingHours()[d];
                return (
                  <tr classList={{ 'working-hours-disabled': !day().enabled }}>
                    <th scope="row">{WEEKDAY_LABEL_DE[d]}</th>
                    <td>
                      <input
                        type="checkbox"
                        checked={day().enabled}
                        onChange={(e) => patchDay(d, { enabled: e.currentTarget.checked })}
                        aria-label={`${WEEKDAY_LABEL_DE[d]} aktivieren`}
                      />
                    </td>
                    <td>
                      <input
                        type="time"
                        value={day().start}
                        disabled={!day().enabled}
                        onChange={(e) => patchDay(d, { start: e.currentTarget.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="time"
                        value={day().end}
                        disabled={!day().enabled}
                        onChange={(e) => patchDay(d, { end: e.currentTarget.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        max="180"
                        step="15"
                        value={day().buffer_before_min}
                        disabled={!day().enabled}
                        onInput={(e) =>
                          patchDay(d, {
                            buffer_before_min: Math.max(
                              0,
                              Math.min(180, Number.parseInt(e.currentTarget.value, 10) || 0),
                            ),
                          })
                        }
                      />
                      <span class="hint working-hours-unit">min</span>
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        max="180"
                        step="15"
                        value={day().buffer_after_min}
                        disabled={!day().enabled}
                        onInput={(e) =>
                          patchDay(d, {
                            buffer_after_min: Math.max(
                              0,
                              Math.min(180, Number.parseInt(e.currentTarget.value, 10) || 0),
                            ),
                          })
                        }
                      />
                      <span class="hint working-hours-unit">min</span>
                    </td>
                    <td>
                      <Show when={day().enabled}>
                        <button
                          type="button"
                          class="btn-subtle click-pulse"
                          onClick={() => applyToAll(d)}
                          title={`${WEEKDAY_LABEL_DE[d]}-Werte auf alle Tage uebernehmen`}
                        >
                          Auf alle
                        </button>
                      </Show>
                    </td>
                  </tr>
                );
              }}
            </For>
          </tbody>
        </table>
      </section>

      <p class="hint">
        Aenderungen werden automatisch gespeichert. Persistiert pro User-Account (synchronisiert
        ueber Geraete).
      </p>
    </article>
  );
};

export default AccountWorkingHours;
