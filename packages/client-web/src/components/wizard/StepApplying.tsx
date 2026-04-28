// Step 4 — Applying. Iteriert den Apply-Loop mit Progress-Bar.
//
// - result.ok=true → phase='done', applyFailures wird in StepDone als
//   Warning-Banner gezeigt wenn nicht-leer (partial success).
// - result.ok=false → bleibt in 'applying'-Phase mit Error-Block +
//   Detail-Liste der Failures. Bei workspaceCreatedButEmpty
//   (fresh-Mode + alle-fail): zusaetzlicher Hinweis zum manuellen
//   Loeschen via Settings → Workspace.

import { type Component, For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { showToast } from '../../lib/toasts';
import { applyWizardProposal } from '../../lib/wizard-apply';
import { useWizard } from '../../lib/wizard-state';
import Icon from '../Icon';

const StepApplying: Component = () => {
  const w = useWizard();
  const [error, setError] = createSignal<string | null>(null);
  const [emptyWorkspaceLabel, setEmptyWorkspaceLabel] = createSignal<string | null>(null);

  let abortCtrl: AbortController | null = null;

  onMount(() => {
    void run();
  });

  onCleanup(() => {
    abortCtrl?.abort();
  });

  async function run(): Promise<void> {
    setError(null);
    setEmptyWorkspaceLabel(null);
    abortCtrl?.abort();
    abortCtrl = new AbortController();

    const proposal = w.proposal();
    if (!proposal) {
      setError('Kein Vorschlag vorhanden — zurueck zu Vorschau.');
      return;
    }

    w.setApplyProgress({ current: 0, total: 0, step: 'Starte…' });
    w.setApplyFailures([]);

    const result = await applyWizardProposal({
      proposal,
      source: w.source(),
      signal: abortCtrl.signal,
      onProgress: (p) => w.setApplyProgress(p),
    });

    w.setApplyFailures(result.failedItems);
    if (result.workspaceId) {
      w.setResultWorkspaceId(result.workspaceId);
    }

    if (result.ok) {
      // Toast bleibt sachlich. Detail-Warnings landen im StepDone falls
      // failedItems nicht leer.
      const partial = result.failedItems.length > 0;
      showToast(
        `${result.createdNodes} ${result.createdNodes === 1 ? 'Knoten' : 'Knoten'} angelegt${
          partial ? ` (${result.failedItems.length} fehlgeschlagen)` : ''
        }.`,
        partial ? 'info' : 'success',
      );
      w.setPhase('done');
      return;
    }

    // Apply gescheitert (0 Knoten angelegt). Wir bleiben im 'applying'-
    // Step mit error-Anzeige — kein Auto-Navigate.
    setError(
      result.failedItems.length > 0
        ? 'Keiner der Knoten konnte angelegt werden. Details siehe unten.'
        : 'Apply fehlgeschlagen — kein Vorschlag konnte umgesetzt werden.',
    );
    if (result.workspaceCreatedButEmpty) {
      setEmptyWorkspaceLabel(proposal.workspace_label || 'Neuer Workspace');
    }
  }

  function handleRetry(): void {
    void run();
  }

  return (
    <>
      <header class="wizard-step-head">
        <h2>Wird angelegt</h2>
        <p class="hint">
          Top-Level-Knoten und ausgewaehlte Eintraege werden in deinen Workspace eingetragen.
        </p>
      </header>

      <div class="wizard-step-body wizard-applying-body">
        <Show
          when={w.applyProgress()}
          fallback={
            <p class="hint">
              <Icon name="sparkles" size={14} /> Vorbereitung…
            </p>
          }
        >
          {(progress) => (
            <div class="wizard-progress">
              <div class="wizard-progress-label">
                <span>{progress().step}</span>
                <span>
                  {progress().current} / {progress().total}
                </span>
              </div>
              <div class="wizard-progress-bar">
                <div
                  class="wizard-progress-fill"
                  style={{
                    width:
                      progress().total === 0
                        ? '0%'
                        : `${Math.min(100, (progress().current / progress().total) * 100)}%`,
                  }}
                />
              </div>
            </div>
          )}
        </Show>

        <Show when={error()}>
          {(msg) => (
            <div class="wizard-error">
              <p class="error">
                <strong>Fehler:</strong> {msg()}
              </p>
              <Show when={emptyWorkspaceLabel()}>
                {(label) => (
                  <p class="hint">
                    Hinweis: der leere Workspace <strong>"{label()}"</strong> wurde angelegt. Du
                    kannst ihn unter <em>Einstellungen → Workspace → Loeschen</em> entfernen oder
                    spaeter selbst befuellen.
                  </p>
                )}
              </Show>
              <Show when={w.applyFailures().length > 0}>
                <ul class="wizard-failure-list">
                  <For each={w.applyFailures()}>
                    {(f) => (
                      <li>
                        <span class="wizard-failure-scope">{f.scope}</span>
                        <span class="wizard-failure-label">{f.label}</span>
                        <span class="wizard-failure-error">{f.error}</span>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </div>
          )}
        </Show>
      </div>

      <Show when={error()}>
        <div class="wizard-footer">
          <button type="button" class="btn-secondary" onClick={() => w.setPhase('preview')}>
            Zurueck zur Vorschau
          </button>
          <button type="button" onClick={handleRetry}>
            Nochmal versuchen
          </button>
        </div>
      </Show>
    </>
  );
};

export default StepApplying;
