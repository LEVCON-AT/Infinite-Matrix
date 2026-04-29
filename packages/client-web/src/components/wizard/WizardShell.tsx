// WizardShell — Multi-Step-Modal-Container fuer den Onboarding-
// Wizard (A.4b).
//
// Pattern aus ImportDialog.tsx: overlay-scrim/overlay-card-Shell mit
// Phase-State + <Show when=phase()===...>-Bloecken pro Step.
//
// ESC schliesst NICHT direkt — der User muss den expliziten Skip-
// Button bedienen. Sonst geht State verloren bei aus-versehen-ESC.
// (Weicht von ImportDialog ab: dort ist ESC=Schliessen erlaubt.)
//
// Focus-Restore: identisch zu Dialog/ImportDialog — beim Mount via
// installFocusRestore, beim Unmount automatisch.
//
// Step-Indicator oben (5 Dots), Body je Phase, Footer mit Buttons
// im jeweiligen Step.

import { useNavigate } from '@solidjs/router';
import { type Component, For, Match, Show, Switch, onCleanup, onMount } from 'solid-js';
import { installFocusRestore, installFocusTrap, showConfirm } from '../../lib/dialog';
import { markOnboardingDone, markOnboardingSkipped } from '../../lib/onboarding-gate';
import { showToast } from '../../lib/toasts';
import {
  VISIBLE_STEPS,
  WizardContext,
  type WizardSource,
  type WizardState,
  createWizardState,
  visibleStepIndex,
} from '../../lib/wizard-state';
import Icon from '../Icon';
import StepApplying from './StepApplying';
import StepDone from './StepDone';
import StepPreview from './StepPreview';
import StepProposing from './StepProposing';
import StepProvider from './StepProvider';
import StepQuestions from './StepQuestions';
import StepWelcome from './StepWelcome';

type Props = {
  source: WizardSource;
  // Wenn Wizard als Modal (Re-Run-Pfad) gerendert wird: onClose schliesst
  // die Modal-Layer von aussen. Bei Initial-Pfad ueber /onboarding-Route
  // ist das undefined — Skip leitet stattdessen per navigate weiter.
  onClose?: () => void;
};

const WizardShell: Component<Props> = (p) => {
  const navigate = useNavigate();
  const state: WizardState = createWizardState(p.source);

  let cardRef: HTMLDivElement | undefined;

  onMount(() => {
    onCleanup(installFocusRestore());
    // AU-B1 K4 (B1-E-002 / B1-D-009 / CC5): Focus-Trap haelt Tab-Order
    // im 720px-Wizard-Modal — sonst sickert er in die Untergrund-UI
    // (WCAG 2.1 SC 2.1.2 Verstoss).
    if (cardRef) onCleanup(installFocusTrap(cardRef));
    // ESC wird absichtlich NICHT zum Schliessen verkabelt (s. oben).
    // Stattdessen: ESC oeffnet Skip-Bestaetigung — falls User irrt,
    // bleibt der State erhalten.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        void handleSkipFromAnywhere();
      }
    };
    document.addEventListener('keydown', onKey, true);
    onCleanup(() => document.removeEventListener('keydown', onKey, true));
  });

  async function handleSkipFromAnywhere(): Promise<void> {
    // Wenn schon im Done-State: Skip macht nichts.
    if (state.phase() === 'done') return;
    const ok = await showConfirm({
      title: 'Wizard wirklich abbrechen?',
      message:
        'Du kannst Matrix auch ohne Wizard nutzen. Wenn du spaeter Hilfe willst, klick rechts oben auf das Funkelchen-Icon.',
      variant: 'warning',
      confirmLabel: 'Ja, abbrechen',
      cancelLabel: 'Doch nicht',
    });
    if (!ok) return;
    await finalizeSkip();
  }

  async function finalizeSkip(): Promise<void> {
    try {
      await markOnboardingSkipped();
    } catch (err) {
      console.error('markOnboardingSkipped:', err);
      // Trotzdem weiter — User kann nicht nicht-skippen.
      showToast(
        'Wizard-Abbruch konnte nicht gespeichert werden — der Wizard zeigt sich evtl. erneut.',
        'error',
      );
    }
    closeOrNavigate();
  }

  async function finalizeDone(): Promise<void> {
    try {
      await markOnboardingDone();
    } catch (err) {
      console.error('markOnboardingDone:', err);
      // Best-effort — Done-State wird trotzdem angezeigt.
    }
    closeOrNavigate();
  }

  function closeOrNavigate(): void {
    if (p.onClose) {
      p.onClose();
      return;
    }
    // Initial-Pfad: navigate zum Workspace.
    const src = p.source;
    if (src.kind === 'initial') {
      navigate(`/w/${src.workspaceId}`, { replace: true });
    } else {
      const wsId = state.resultWorkspaceId();
      if (wsId) {
        navigate(`/w/${wsId}`, { replace: true });
      } else {
        navigate('/', { replace: true });
      }
    }
  }

  return (
    <WizardContext.Provider value={state}>
      <div class="overlay-scrim wizard-scrim">
        <div
          class="overlay-card wizard-card"
          ref={cardRef}
          // biome-ignore lint/a11y/useSemanticElements: <div role="dialog"> bewusst statt <dialog>, analog ImportDialog.
          role="dialog"
          aria-modal="true"
          aria-label="Onboarding-Wizard"
        >
          <header class="wizard-head">
            <div class="wizard-step-indicator">
              <For each={VISIBLE_STEPS}>
                {(step, i) => (
                  <span
                    class="wizard-step-dot"
                    classList={{
                      'wizard-step-active': visibleStepIndex(state.phase()) === i(),
                      'wizard-step-done': visibleStepIndex(state.phase()) > i(),
                    }}
                    aria-label={`Schritt ${i() + 1}: ${step.label}`}
                    title={step.label}
                  />
                )}
              </For>
            </div>
            <button
              type="button"
              class="overlay-close wizard-skip-btn"
              onClick={() => void handleSkipFromAnywhere()}
              aria-label="Wizard abbrechen"
              title="Wizard abbrechen (ESC)"
            >
              <Icon name="x" size={18} />
            </button>
          </header>

          <div class="overlay-body wizard-body">
            <Switch>
              <Match when={state.phase() === 'welcome'}>
                <StepWelcome onSkip={() => void finalizeSkip()} />
              </Match>
              <Match when={state.phase() === 'provider'}>
                <StepProvider onSkip={() => void finalizeSkip()} />
              </Match>
              <Match when={state.phase() === 'questions'}>
                <StepQuestions />
              </Match>
              <Match when={state.phase() === 'proposing'}>
                <StepProposing />
              </Match>
              <Match when={state.phase() === 'preview'}>
                <StepPreview />
              </Match>
              <Match when={state.phase() === 'applying'}>
                <StepApplying />
              </Match>
              <Match when={state.phase() === 'done'}>
                <StepDone onFinish={() => void finalizeDone()} />
              </Match>
              <Match when={state.phase() === 'error'}>
                <div class="wizard-placeholder">
                  <Show when={state.errorMsg()}>{(msg) => <p class="error">{msg()}</p>}</Show>
                  <div class="wizard-footer">
                    <button
                      type="button"
                      class="btn-secondary"
                      onClick={() => {
                        state.setErrorMsg('');
                        state.setPhase('welcome');
                      }}
                    >
                      Zurueck zum Anfang
                    </button>
                    <button type="button" onClick={() => void finalizeSkip()}>
                      Abbrechen
                    </button>
                  </div>
                </div>
              </Match>
            </Switch>
          </div>
        </div>
      </div>
    </WizardContext.Provider>
  );
};

export default WizardShell;
