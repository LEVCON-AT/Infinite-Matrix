// Welle WV.D.3.c — Channel-Token-Setup-Modal.
//
// Minimaler Paste-Form fuer User-Token (V1: kein Auto-OAuth-Flow).
// Slack: User generiert xoxp/xoxb auf api.slack.com/apps und pastet ihn
// hier ein. Teams: AccessToken aus dem Microsoft-Dev-Center oder einem
// auth-flow-Helper.
//
// Auto-OAuth-Flow mit PKCE kommt mit Sub-Sprint D.3.f (Server-Side
// Callback-Endpoint + Provider-Slot-Konfig + Authorization-Code-Exchange).
// Bis dahin reicht Manual-Paste fuer Tester.

import { type Component, createSignal, onCleanup, onMount } from 'solid-js';
import { CHANNEL_PROVIDER_LABEL } from '../lib/channels-meta';
import { installFocusRestore, installFocusTrap } from '../lib/dialog';
import { translateDbError } from '../lib/errors';
import { setOAuthToken } from '../lib/oauth-tokens';
import { showToast } from '../lib/toasts';
import type { ChannelProvider } from '../lib/types';
import Icon from './Icon';

export type ChannelTokenSetupModalProps = {
  provider: ChannelProvider;
  // hasRefreshSlot signalisiert ob der Refresh-Token-Eingabe sinnvoll
  // ist. Slack hat keinen Refresh — Token ist long-lived. Teams/Outlook
  // schon — User-Paste-Pfad ist aber V1 nur fuer einmaligen Token, kein
  // Refresh-Loop.
  onClose: () => void;
  onSaved: () => void;
};

const ChannelTokenSetupModal: Component<ChannelTokenSetupModalProps> = (p) => {
  const [accessToken, setAccessToken] = createSignal('');
  const [scopesText, setScopesText] = createSignal('');
  const [busy, setBusy] = createSignal(false);

  let tokenInput: HTMLInputElement | undefined;
  let cardRef: HTMLDivElement | undefined;

  onMount(() => {
    onCleanup(installFocusRestore());
    if (cardRef) onCleanup(installFocusTrap(cardRef));
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      p.onClose();
    };
    document.addEventListener('keydown', onKey, true);
    onCleanup(() => document.removeEventListener('keydown', onKey, true));
    tokenInput?.focus();
  });

  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy()) return;
    const token = accessToken().trim();
    if (token.length < 8) {
      showToast('Token zu kurz.', 'error');
      return;
    }
    setBusy(true);
    try {
      const scopes = scopesText()
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      await setOAuthToken({
        provider: p.provider,
        accessToken: token,
        scopes: scopes.length > 0 ? scopes : undefined,
      });
      showToast(`${CHANNEL_PROVIDER_LABEL[p.provider]} verbunden.`, 'success');
      p.onSaved();
      p.onClose();
    } catch (err) {
      console.error('setOAuthToken:', err);
      showToast(translateDbError(err, 'Token konnte nicht gespeichert werden.'), 'error');
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
        class="overlay-card channel-token-modal"
        // biome-ignore lint/a11y/useSemanticElements: role=dialog bewusst.
        role="dialog"
        aria-modal="true"
        aria-label={`${CHANNEL_PROVIDER_LABEL[p.provider]} verbinden`}
      >
        <header class="overlay-head">
          <h3>{CHANNEL_PROVIDER_LABEL[p.provider]} verbinden</h3>
          <button type="button" class="overlay-close" onClick={p.onClose} aria-label="Schliessen">
            <Icon name="x" size={18} />
          </button>
        </header>
        <form class="overlay-body channel-token-form" onSubmit={submit}>
          <p class="hint">
            V1-Foundation: Auto-OAuth-Flow kommt spaeter. Aktuell paste deinen Token manuell —
            Slack-User generieren ihn auf api.slack.com/apps, Teams-User via Azure-Portal.
          </p>
          <div class="form-row">
            <label for="ch-token">Access-Token</label>
            <input
              id="ch-token"
              ref={(el) => {
                tokenInput = el;
              }}
              type="password"
              value={accessToken()}
              placeholder="xoxp-... / eyJ0eXAi..."
              onInput={(e) => setAccessToken(e.currentTarget.value)}
              autocomplete="off"
              spellcheck={false}
              required
            />
          </div>
          <div class="form-row">
            <label for="ch-scopes">Scopes (optional, kommagetrennt)</label>
            <input
              id="ch-scopes"
              type="text"
              value={scopesText()}
              placeholder="channels:read, chat:write"
              onInput={(e) => setScopesText(e.currentTarget.value)}
            />
          </div>
          <footer class="overlay-foot">
            <button type="button" class="btn-subtle" onClick={p.onClose} disabled={busy()}>
              Abbrechen
            </button>
            <button type="submit" class="btn-primary" disabled={busy()}>
              {busy() ? 'Speichere…' : 'Verbinden'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
};

export default ChannelTokenSetupModal;
