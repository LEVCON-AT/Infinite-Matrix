// Vollflaechen-Scrim + Fortschritts-Karte fuer lange laufende
// Operationen (Import). Einmal am App-Root gemountet, reagiert auf
// das progress-Signal aus lib/progress.ts. Waehrend aktiv blockt
// der Scrim Pointer-Events — die Oberflaeche ist grau und
// un-klickbar.

import { type Component, Show } from 'solid-js';
import { useProgress } from '../lib/progress';

const ProgressOverlay: Component = () => {
  const p = useProgress();
  return (
    <Show when={p()}>
      {(accessor) => {
        const state = () => accessor();
        const pct = () => {
          const s = state();
          const t = Math.max(1, s.total);
          return Math.min(100, Math.round((s.current / t) * 100));
        };
        return (
          <div
            class="progress-scrim"
            // biome-ignore lint/a11y/useSemanticElements: bewusst <div role="status"> — Scrim ist eine Vollflaechen-Sperrkomponente, role status macht den Fortschritt fuer Screen-Reader announcement-faehig.
            role="status"
            aria-live="polite"
            aria-busy="true"
          >
            <div class="progress-card">
              <div class="progress-title">{state().title}</div>
              <div class="progress-phase">{state().phase}</div>
              <div class="progress-bar" aria-hidden="true">
                <div class="progress-bar-fill" style={{ '--progress-pct': `${pct()}%` }} />
              </div>
              <div class="progress-meta">
                Schritt {state().current} von {state().total} · {pct()}%
              </div>
            </div>
          </div>
        );
      }}
    </Show>
  );
};

export default ProgressOverlay;
