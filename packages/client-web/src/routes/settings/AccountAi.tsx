// Settings → Konto → AI-Anbindung. Phase 2 Welle A.0.
//
// User legt eigene AI-Provider-Keys ab (Anthropic / OpenAI / Gemini).
// Einer davon kann is_default sein und wird von der ai-assist-Pipe
// (A.2) verwendet, sobald die live ist. Heute (A.0) ist nur das
// Storage + RLS + Encryption fertig — Test-Calls / Onboarding-Wizard
// folgen.

import { For, Show, createResource } from 'solid-js';
import AiProviderList from '../../components/AiProviderList';
import Icon from '../../components/Icon';
import { PROVIDER_CONSOLE_URLS, PROVIDER_LABELS, fetchAiProviders } from '../../lib/ai-providers';
import { useUser } from '../../lib/auth';
import { translateDbError } from '../../lib/errors';
import { showToast } from '../../lib/toasts';
import type { AiProvider, AiProviderKind } from '../../lib/types';

const KIND_ORDER: ReadonlyArray<AiProviderKind> = ['anthropic', 'openai', 'gemini'];

const AccountAi = () => {
  const user = useUser();

  const [providers, { refetch }] = createResource<AiProvider[], string | null>(
    () => user()?.id ?? null,
    async (uid) => {
      if (!uid) return [];
      try {
        return await fetchAiProviders(uid);
      } catch (err) {
        console.error('fetchAiProviders:', err);
        showToast(translateDbError(err, 'Provider konnten nicht geladen werden.'), 'error');
        return [];
      }
    },
  );

  return (
    <article class="settings-pane">
      <header class="settings-pane-head">
        <h2>AI-Anbindung</h2>
        <p class="hint">
          Verbinde Matrix mit einem AI-Anbieter deiner Wahl. Mit hinterlegtem Provider kann der
          Onboarding-Wizard dir einen Workspace vorschlagen, du kannst jederzeit Inline-Hilfe holen,
          und leere Cells lassen sich mit KI-Vorschlaegen einrichten.
        </p>
      </header>

      <section class="settings-form-section">
        <h3>Wo bekomme ich einen API-Key?</h3>
        <p class="hint">
          Du brauchst einen Account beim Anbieter. Nutzungs-Kosten werden ueber deren Plattform
          abgerechnet — Matrix selbst speichert nur den Key, schickt aber alle Requests direkt an
          den Anbieter.
        </p>
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

      <section class="settings-form-section">
        <h3>Datenfluss & Privacy</h3>
        <p class="hint">
          Dein API-Key wird verschluesselt gespeichert (pgp_sym_encrypt). Nur die Server-Pipe kann
          ihn beim Aufruf entschluesseln, das Frontend bekommt ihn nie zurueck. Wenn du KI- Hilfe
          nutzt, sieht der jeweilige Anbieter den Workspace-Kontext (Cell-Inhalte, Karten,
          Checklisten), den du gerade im Drawer/Wizard einbindest. Sensitive Daten lassen sich mit
          lokalen Providern (z.B. Ollama via OpenAI-kompatiblem Endpoint) absichern — fuer die
          Live-Pipe folgt die Adapter-Logik in einem spaeteren Sprint.
        </p>
      </section>
    </article>
  );
};

export default AccountAi;
