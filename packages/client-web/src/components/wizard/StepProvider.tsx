// Step 1 — AI-Provider einrichten. Embeds AiProviderList +
// Provider-Console-Direct-Links aus Account-AI-Tab.
//
// "Weiter"-Button enabled wenn useHasDefaultProvider() === true.
// Skip-Pfad ueber onSkip-Callback (showConfirm in WizardShell).

import { type Component, For, Show, createResource } from 'solid-js';
import {
  PROVIDER_CONSOLE_URLS,
  PROVIDER_LABELS,
  fetchAiProviders,
  useHasDefaultProvider,
} from '../../lib/ai-providers';
import { useUser } from '../../lib/auth';
import { translateDbError } from '../../lib/errors';
import { showToast } from '../../lib/toasts';
import type { AiProvider, AiProviderKind } from '../../lib/types';
import { useWizard } from '../../lib/wizard-state';
import AiProviderList from '../AiProviderList';
import Icon from '../Icon';

type Props = {
  onSkip: () => void;
};

const KIND_ORDER: ReadonlyArray<AiProviderKind> = ['anthropic', 'openai', 'gemini'];

const StepProvider: Component<Props> = (p) => {
  const w = useWizard();
  const user = useUser();
  const hasDefault = useHasDefaultProvider();

  const [providers, { refetch }] = createResource<AiProvider[], string | null>(
    () => user()?.id ?? null,
    async (uid) => {
      if (!uid) return [];
      try {
        return await fetchAiProviders(uid);
      } catch (err) {
        console.error('fetchAiProviders (Wizard):', err);
        showToast(translateDbError(err, 'Provider konnten nicht geladen werden.'), 'error');
        return [];
      }
    },
  );

  return (
    <>
      <header class="wizard-step-head">
        <h2>AI-Anbindung</h2>
        <p class="hint">
          Verbinde Matrix mit einem AI-Anbieter. Empfohlen ist <strong>Anthropic Claude</strong> —
          die Tool-Use-Faehigkeiten sind dort am besten getestet, aber alle drei laufen.
        </p>
      </header>

      <div class="wizard-step-body">
        <section class="settings-form-section wizard-providers-info">
          <h3>API-Key holen</h3>
          <div class="ai-provider-cards">
            <For each={KIND_ORDER}>
              {(kind) => (
                <a
                  class="ai-provider-card"
                  href={PROVIDER_CONSOLE_URLS[kind]}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span class={`ai-provider-card-kind ai-provider-kind-${kind}`}>
                    {PROVIDER_LABELS[kind]}
                  </span>
                  <span class="ai-provider-card-link">
                    <span>API-Key holen</span>
                    <Icon name="arrow-top-right-on-square" size={12} />
                  </span>
                </a>
              )}
            </For>
          </div>
        </section>

        <section class="settings-form-section">
          <h3>Meine Provider</h3>
          <Show when={!providers.loading} fallback={<p class="hint">Wird geladen…</p>}>
            <AiProviderList providers={providers() ?? []} onChange={() => void refetch()} />
          </Show>
        </section>
      </div>

      <div class="wizard-footer">
        <button type="button" class="btn-secondary" onClick={() => w.setPhase('welcome')}>
          Zurueck
        </button>
        <button type="button" class="btn-secondary" onClick={p.onSkip}>
          Spaeter ohne KI
        </button>
        <button
          type="button"
          disabled={!hasDefault()}
          onClick={() => w.setPhase('questions')}
          title={hasDefault() ? '' : 'Bitte einen Provider als Standard markieren.'}
        >
          Weiter
        </button>
      </div>
    </>
  );
};

export default StepProvider;
