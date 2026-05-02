// AiProviderEditModal — Phase 2 Welle A.0.
//
// Add/Edit-Modal fuer User-AI-Provider. Form mit Kind-Select, Label,
// Key (password-Input, beim Edit optional), Model-Name + "als Default
// setzen". Direct-Links zu Provider-Consoles als "Wo finde ich den
// Key?"-Helper — der naechste Klick setzt den User auf die richtige
// Seite, statt ihn googeln zu lassen.
//
// Encryption passiert serverseitig (set_ai_provider-RPC). Klartext
// verlaesst den Frontend-Memory nur als Request-Body und wird danach
// nicht persistiert (kein localStorage, kein State).
//
// Test-Button ist in A.0 deaktiviert mit Hint "Test wird mit der ai-
// assist-Pipe (A.2) freigeschaltet". Wir bauen die UI schon dafuer,
// damit der Sprint A.2 nur Backend-Verdrahtung nachreichen muss.

import { type Component, For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import {
  PROVIDER_CONSOLE_URLS,
  PROVIDER_DEFAULT_MODELS,
  PROVIDER_LABELS,
  setAiProvider,
} from '../lib/ai-providers';
import { installFocusRestore, installFocusTrap } from '../lib/dialog';
import { translateDbError } from '../lib/errors';
import { showToast } from '../lib/toasts';
import type { AiProvider, AiProviderKind } from '../lib/types';
import Icon from './Icon';

export type AiProviderEditModalProps = {
  // null = Add-Mode, Provider = Edit-Mode (Key bleibt verborgen + optional)
  provider: AiProvider | null;
  hasOtherProviders: boolean;
  onClose: () => void;
  onSaved: () => void;
};

const KIND_OPTIONS: ReadonlyArray<AiProviderKind> = ['anthropic', 'openai', 'gemini'];

const AiProviderEditModal: Component<AiProviderEditModalProps> = (p) => {
  const [kind, setKind] = createSignal<AiProviderKind>(p.provider?.kind ?? 'anthropic');
  const [label, setLabel] = createSignal(p.provider?.label ?? '');
  const [apiKey, setApiKey] = createSignal('');
  const [modelName, setModelName] = createSignal(
    p.provider?.model_name ?? PROVIDER_DEFAULT_MODELS[p.provider?.kind ?? 'anthropic'],
  );
  // Wenn schon ein anderer Default existiert, zeigen wir den Toggle.
  // Beim ersten Provider eines Users ist Default automatisch true (RPC
  // setzt nichts wenn kein anderer existiert — UNIQUE-Index braucht's
  // ja nur fuer >1 Reihe).
  const [setDefault, setSetDefault] = createSignal(p.provider?.is_default ?? !p.hasOtherProviders);
  const [busy, setBusy] = createSignal(false);

  let labelInput: HTMLInputElement | undefined;
  let cardRef: HTMLDivElement | undefined;

  onMount(() => {
    onCleanup(installFocusRestore());
    // AU-B1 K4 (B1-D-003): Focus-Trap auf dem Modal-Card. API-Key-Form
    // ist sensibel, Tab-Escape in den Hintergrund waere ein Risiko.
    if (cardRef) onCleanup(installFocusTrap(cardRef));
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      p.onClose();
    };
    document.addEventListener('keydown', onKey, true);
    onCleanup(() => document.removeEventListener('keydown', onKey, true));
    labelInput?.focus();
  });

  // Beim Provider-Kind-Wechsel: Default-Modell setzen, wenn der User
  // nichts manuell eingetragen hat (oder das alte Default-Modell stand).
  const onKindChange = (next: AiProviderKind) => {
    const prev = kind();
    setKind(next);
    if (modelName() === '' || modelName() === PROVIDER_DEFAULT_MODELS[prev]) {
      setModelName(PROVIDER_DEFAULT_MODELS[next]);
    }
  };

  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy()) return;

    const trimmedLabel = label().trim();
    if (!trimmedLabel) {
      showToast('Bitte einen Namen fuer den Provider angeben.', 'error');
      labelInput?.focus();
      return;
    }
    const trimmedKey = apiKey().trim();
    if (!p.provider && !trimmedKey) {
      showToast('Bitte einen API-Key einfuegen.', 'error');
      return;
    }

    setBusy(true);
    try {
      await setAiProvider({
        id: p.provider?.id,
        kind: kind(),
        label: trimmedLabel,
        apiKey: trimmedKey ? trimmedKey : undefined,
        modelName: modelName().trim() || undefined,
        setDefault: setDefault(),
      });
      showToast(p.provider ? 'Provider aktualisiert.' : 'Provider angelegt.', 'success');
      p.onSaved();
      p.onClose();
    } catch (err) {
      console.error('setAiProvider:', err);
      showToast(translateDbError(err, 'Provider konnte nicht gespeichert werden.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: ESC via onMount-Handler.
    <div
      class="overlay-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) p.onClose();
      }}
    >
      <div
        ref={cardRef}
        class="overlay-card ai-provider-modal"
        // biome-ignore lint/a11y/useSemanticElements: role=dialog bewusst.
        role="dialog"
        aria-modal="true"
        aria-label={p.provider ? 'Provider bearbeiten' : 'Provider hinzufuegen'}
      >
        <header class="overlay-head">
          <h3>{p.provider ? 'Provider bearbeiten' : 'Provider hinzufuegen'}</h3>
          <button type="button" class="overlay-close" onClick={p.onClose} aria-label="Schliessen">
            <Icon name="x" size={18} />
          </button>
        </header>
        <form class="overlay-body ai-provider-form" onSubmit={submit}>
          <div class="form-row">
            <label for="ai-kind">Anbieter</label>
            <select
              id="ai-kind"
              value={kind()}
              onChange={(e) => onKindChange(e.currentTarget.value as AiProviderKind)}
            >
              <For each={KIND_OPTIONS}>
                {(k) => <option value={k}>{PROVIDER_LABELS[k]}</option>}
              </For>
            </select>
            <a
              class="ai-provider-link"
              href={PROVIDER_CONSOLE_URLS[kind()]}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="arrow-top-right-on-square" size={12} />
              <span>Wo finde ich meinen Key?</span>
            </a>
          </div>
          <div class="form-row">
            <label for="ai-label">Name</label>
            <input
              id="ai-label"
              ref={(el) => {
                labelInput = el;
              }}
              type="text"
              value={label()}
              placeholder="z.B. Claude Privat"
              onInput={(e) => setLabel(e.currentTarget.value)}
              required
              maxlength={64}
            />
          </div>
          <div class="form-row">
            <label for="ai-key">API-Key{p.provider ? ' (leer lassen = nicht aendern)' : ''}</label>
            <input
              id="ai-key"
              type="password"
              value={apiKey()}
              placeholder={p.provider ? '••••••••' : 'sk-...'}
              onInput={(e) => setApiKey(e.currentTarget.value)}
              autocomplete="off"
              spellcheck={false}
            />
            <p class="hint">
              <Icon name="lock-closed" size={12} />
              <span>
                Wird verschluesselt gespeichert. Nur die Server-Pipe sieht ihn beim Aufruf.
              </span>
            </p>
          </div>
          <div class="form-row">
            <label for="ai-model">Modell</label>
            <input
              id="ai-model"
              type="text"
              value={modelName()}
              placeholder={PROVIDER_DEFAULT_MODELS[kind()]}
              onInput={(e) => setModelName(e.currentTarget.value)}
              maxlength={128}
            />
          </div>
          <div class="form-row form-row-checkbox">
            <label>
              <input
                type="checkbox"
                checked={setDefault()}
                onChange={(e) => setSetDefault(e.currentTarget.checked)}
              />
              <span>Als Standard-Provider verwenden</span>
            </label>
          </div>
          <div class="overlay-actions">
            <button type="button" class="btn btn-subtle" onClick={p.onClose} disabled={busy()}>
              Abbrechen
            </button>
            <button type="submit" class="btn btn-primary lift" disabled={busy()}>
              <Show when={busy()} fallback={p.provider ? 'Speichern' : 'Anlegen'}>
                Speichert…
              </Show>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AiProviderEditModal;
