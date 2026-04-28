// Step 4 — Applying. Iteriert den Apply-Loop mit Progress-Bar (A.4d).

import { type Component, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { showToast } from '../../lib/toasts';
import { applyWizardProposal } from '../../lib/wizard-apply';
import { useWizard } from '../../lib/wizard-state';
import Icon from '../Icon';

const StepApplying: Component = () => {
  const w = useWizard();
  const [error, setError] = createSignal<string | null>(null);

  let abortCtrl: AbortController | null = null;

  onMount(() => {
    void run();
  });

  onCleanup(() => {
    abortCtrl?.abort();
  });

  async function run(): Promise<void> {
    setError(null);
    abortCtrl?.abort();
    abortCtrl = new AbortController();

    const proposal = w.proposal();
    if (!proposal) {
      setError('Kein Vorschlag vorhanden — zurueck zu Vorschau.');
      return;
    }

    w.setApplyProgress({ current: 0, total: 0, step: 'Starte…' });

    const result = await applyWizardProposal({
      proposal,
      source: w.source(),
      signal: abortCtrl.signal,
      onProgress: (p) => w.setApplyProgress(p),
    });

    if (result.ok) {
      w.setResultWorkspaceId(result.workspaceId);
      showToast(
        `${result.createdNodes} ${result.createdNodes === 1 ? 'Knoten' : 'Knoten'} angelegt.`,
        'success',
      );
      w.setPhase('done');
      return;
    }

    setError(result.error);
    if (result.partialWorkspaceId) {
      w.setResultWorkspaceId(result.partialWorkspaceId);
    }
  }

  function handleRetry(): void {
    void run();
  }

  function handleSkipToWorkspace(): void {
    w.setPhase('done');
  }

  return (
    <>
      <header class="wizard-step-head">
        <h2>Wird angelegt</h2>
        <p class="hint">
          Die KI hat dir Top-Level-Knoten vorgeschlagen — die kommen jetzt in deinen Workspace.
          Cells, Karten und Checklisten kannst du danach mit dem Hilfe-Drawer rechts ausbauen.
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
            </div>
          )}
        </Show>
      </div>

      <Show when={error()}>
        <div class="wizard-footer">
          <button type="button" class="btn-secondary" onClick={() => w.setPhase('preview')}>
            Zurueck zur Vorschau
          </button>
          <button type="button" class="btn-secondary" onClick={handleSkipToWorkspace}>
            Trotzdem fortfahren
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
