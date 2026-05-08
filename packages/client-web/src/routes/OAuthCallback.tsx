// Welle WV.D.3.f V1 — OAuth-Callback-Route.
//
// Provider redirected zu /oauth/callback?code=...&state=... (V1-Flow:
// browser-only PKCE-Public-Client). Popup-Page tauscht Code, ruft
// set_oauth_token-RPC, postMessage zum opener, schliesst sich.
//
// Bei Fehlern (state mismatch / token_exchange_failed): zeigt der User
// die Fehlermeldung und schliesst Popup nach Klick auf „Schliessen".

import { type Component, Show, createResource } from 'solid-js';
import { completeOAuthFlow, postOAuthResultToOpener } from '../lib/oauth-flow';

const OAuthCallback: Component = () => {
  const params = () => {
    const sp = new URLSearchParams(window.location.search);
    return {
      code: sp.get('code'),
      state: sp.get('state'),
      error: sp.get('error'),
      errorDescription: sp.get('error_description'),
    };
  };

  const [result] = createResource(async () => {
    const { code, state, error, errorDescription } = params();
    if (error || !code || !state) {
      const reason = errorDescription || error || 'missing_code_or_state';
      if (state) postOAuthResultToOpener(state, { ok: false, reason });
      return { ok: false as const, reason };
    }
    const r = await completeOAuthFlow(state, code);
    postOAuthResultToOpener(state, r);
    if (r.ok) {
      // Auto-close Popup nach kurzer Sicht-Pause damit User die
      // Erfolgsmeldung wahrnimmt.
      setTimeout(() => {
        try {
          window.close();
        } catch {
          // Manche Browser blocken close von nicht-script-opened windows.
        }
      }, 1200);
    }
    return r;
  });

  return (
    <div class="oauth-callback-shell">
      <Show when={result.loading}>
        <p class="oauth-callback-msg">Verbindung wird abgeschlossen…</p>
      </Show>
      <Show when={result()?.ok === true}>
        <div class="oauth-callback-success">
          <h2>Verbunden ✓</h2>
          <p>Dieses Fenster schliesst sich gleich automatisch.</p>
        </div>
      </Show>
      <Show when={result() && result()?.ok === false}>
        <div class="oauth-callback-error">
          <h2>Verbindung fehlgeschlagen</h2>
          <p>{(result() as { ok: false; reason: string }).reason}</p>
          <button type="button" class="btn-subtle" onClick={() => window.close()}>
            Schliessen
          </button>
        </div>
      </Show>
    </div>
  );
};

export default OAuthCallback;
