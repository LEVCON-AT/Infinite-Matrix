// Settings → Konto → Channel-Anbindungen. Welle WV.D.3.c.
//
// User verbindet eigene OAuth-Tokens fuer Mail/Chat/Drive-Provider
// (Slack/Teams/...). V1 Manual-Paste; Auto-OAuth-Flow folgt mit D.3.f.

import { type Component, For, Show, createResource, createSignal } from 'solid-js';
import ChannelTokenSetupModal from '../../components/ChannelTokenSetupModal';
import Icon from '../../components/Icon';
import { useUser } from '../../lib/auth';
import { getChannelImpl, hasChannelImpl } from '../../lib/channels';
import {
  CHANNEL_DOMAIN_ORDER,
  CHANNEL_PROVIDERS_BY_DOMAIN,
  CHANNEL_PROVIDER_DOCS_URL,
  CHANNEL_PROVIDER_ICON,
  CHANNEL_PROVIDER_LABEL,
} from '../../lib/channels-meta';
import { showConfirm } from '../../lib/dialog';
import { translateDbError } from '../../lib/errors';
import { startOAuthFlow, supportsBrowserPkce, supportsServerSideOAuth } from '../../lib/oauth-flow';
import {
  deleteOAuthToken,
  fetchOAuthProviderSlots,
  fetchOAuthTokens,
  tokenStatusFor,
} from '../../lib/oauth-tokens';
import { showToast } from '../../lib/toasts';
import type { ChannelProvider, OAuthProviderSlotSafe, UserOAuthTokenSafe } from '../../lib/types';

const AccountChannels: Component = () => {
  const user = useUser();
  const [setupProvider, setSetupProvider] = createSignal<ChannelProvider | null>(null);
  const [busyProvider, setBusyProvider] = createSignal<ChannelProvider | null>(null);

  const [tokens, { refetch }] = createResource<UserOAuthTokenSafe[], string | null>(
    () => user()?.id ?? null,
    async (uid) => {
      if (!uid) return [];
      try {
        return await fetchOAuthTokens(uid);
      } catch (err) {
        console.error('fetchOAuthTokens:', err);
        showToast(translateDbError(err, 'Channels konnten nicht geladen werden.'), 'error');
        return [];
      }
    },
  );

  // Provider-Slots (admin-konfigurierbar, RLS platform_admin-only).
  // Frontend rendert „OAuth verbinden"-Button nur wenn Slot fuer den
  // Provider configured ist. Nicht-Admin-User bekommen leere Liste,
  // dann fallback auf Manual-Paste.
  const [slots] = createResource<OAuthProviderSlotSafe[]>(async () => {
    try {
      return await fetchOAuthProviderSlots();
    } catch {
      return [];
    }
  });

  const slotFor = (provider: ChannelProvider): OAuthProviderSlotSafe | null => {
    return slots()?.find((s) => s.provider === provider) ?? null;
  };

  const canUseBrowserOauth = (provider: ChannelProvider): boolean => {
    if (!supportsBrowserPkce(provider) && !supportsServerSideOAuth(provider)) return false;
    const slot = slotFor(provider);
    if (!slot) return false;
    return Boolean(slot.client_id && slot.auth_url && slot.token_url);
  };

  const handleConnectOAuth = async (provider: ChannelProvider) => {
    const slot = slotFor(provider);
    if (!slot) {
      showToast('Provider-Slot nicht konfiguriert (Admin).', 'error');
      return;
    }
    setBusyProvider(provider);
    try {
      const flow = await startOAuthFlow({ provider, slot });
      const result = await flow.done;
      if (result.ok) {
        showToast(`${CHANNEL_PROVIDER_LABEL[provider]} verbunden.`, 'success');
        void refetch();
      } else if (result.reason !== 'popup_closed') {
        showToast(`${CHANNEL_PROVIDER_LABEL[provider]}: ${result.reason}`, 'error');
      }
    } catch (err) {
      console.error('startOAuthFlow:', err);
      showToast(err instanceof Error ? err.message : 'OAuth-Flow fehlgeschlagen.', 'error');
    } finally {
      setBusyProvider(null);
    }
  };

  const handleDisconnect = async (provider: ChannelProvider) => {
    const ok = await showConfirm({
      title: `${CHANNEL_PROVIDER_LABEL[provider]} trennen?`,
      message:
        'Der gespeicherte Token wird geloescht. Verknuepfte Widgets werden beim naechsten Refresh leer angezeigt — neu verbinden geht jederzeit.',
      variant: 'danger',
      confirmLabel: 'Trennen',
      cancelLabel: 'Abbrechen',
    });
    if (!ok || busyProvider()) return;
    setBusyProvider(provider);
    try {
      await deleteOAuthToken(provider);
      showToast(`${CHANNEL_PROVIDER_LABEL[provider]} getrennt.`, 'success');
      void refetch();
    } catch (err) {
      console.error('deleteOAuthToken:', err);
      showToast(translateDbError(err, 'Trennen fehlgeschlagen.'), 'error');
    } finally {
      setBusyProvider(null);
    }
  };

  const handleTest = async (provider: ChannelProvider) => {
    if (!hasChannelImpl(provider)) {
      showToast(
        `Test fuer ${CHANNEL_PROVIDER_LABEL[provider]} kommt in einem spaeteren Sprint.`,
        'info',
      );
      return;
    }
    setBusyProvider(provider);
    try {
      const impl = getChannelImpl(provider);
      const result = await impl.testConnect();
      if (result.ok) {
        showToast(
          `${CHANNEL_PROVIDER_LABEL[provider]}: verbunden als ${result.profileLabel}.`,
          'success',
        );
      } else {
        showToast(`${CHANNEL_PROVIDER_LABEL[provider]}: ${result.reason}`, 'error');
      }
    } catch (err) {
      console.error('testConnect:', err);
      showToast(translateDbError(err, 'Test fehlgeschlagen.'), 'error');
    } finally {
      setBusyProvider(null);
    }
  };

  const renderCard = (provider: ChannelProvider) => {
    const status = () => tokenStatusFor(tokens() ?? [], provider);
    const isImplemented = hasChannelImpl(provider);

    return (
      <article class="channel-provider-card" data-provider={provider}>
        <header class="channel-provider-card-head">
          <span class="channel-provider-card-icon" aria-hidden="true">
            <Icon name={CHANNEL_PROVIDER_ICON[provider]} size={18} />
          </span>
          <div class="channel-provider-card-title">
            <h4>{CHANNEL_PROVIDER_LABEL[provider]}</h4>
            <ChannelStatusChip status={status()} implemented={isImplemented} />
          </div>
        </header>
        <a
          class="channel-provider-card-doc"
          href={CHANNEL_PROVIDER_DOCS_URL[provider]}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Icon name="arrow-top-right-on-square" size={11} />
          <span>Setup-Doku</span>
        </a>
        <div class="channel-provider-card-actions">
          <Show
            when={status().kind === 'missing'}
            fallback={
              <>
                <button
                  type="button"
                  class="btn-subtle btn-small"
                  onClick={() => void handleTest(provider)}
                  disabled={busyProvider() === provider || !isImplemented}
                  title={
                    isImplemented
                      ? 'Verbindung pruefen'
                      : 'Test fuer diesen Provider noch nicht implementiert'
                  }
                >
                  Test
                </button>
                <button
                  type="button"
                  class="btn-subtle btn-small btn-danger-subtle"
                  onClick={() => void handleDisconnect(provider)}
                  disabled={busyProvider() === provider}
                >
                  Trennen
                </button>
              </>
            }
          >
            <Show
              when={canUseBrowserOauth(provider)}
              fallback={
                <button
                  type="button"
                  class="btn-primary btn-small"
                  onClick={() => setSetupProvider(provider)}
                  disabled={busyProvider() === provider}
                  title="Manuell Token einfuegen"
                >
                  Verbinden
                </button>
              }
            >
              <button
                type="button"
                class="btn-primary btn-small"
                onClick={() => void handleConnectOAuth(provider)}
                disabled={busyProvider() === provider}
                title="OAuth-Flow im Popup oeffnen"
              >
                {busyProvider() === provider ? 'OAuth…' : 'OAuth-Verbinden'}
              </button>
              <button
                type="button"
                class="btn-subtle btn-small"
                onClick={() => setSetupProvider(provider)}
                disabled={busyProvider() === provider}
                title="Manuell Token einfuegen (Fallback)"
              >
                Manuell
              </button>
            </Show>
          </Show>
        </div>
      </article>
    );
  };

  return (
    <article class="settings-pane">
      <header class="settings-pane-head">
        <h2>Channel-Anbindungen</h2>
        <p class="hint">
          Verbinde Matrix mit deinen Mail-/Chat-/Drive-Diensten. Tokens werden verschluesselt
          gespeichert (gleicher Master-Key wie bei AI-Providern). Auto-OAuth-Flow kommt mit einem
          spaeteren Sprint — V1 paste deine Tokens manuell ein.
        </p>
      </header>

      <For each={CHANNEL_DOMAIN_ORDER}>
        {(domain) => (
          <section class="settings-form-section">
            <h3>{domain}</h3>
            <div class="channel-provider-grid">
              <For each={CHANNEL_PROVIDERS_BY_DOMAIN[domain] ?? []}>
                {(provider) => renderCard(provider)}
              </For>
            </div>
          </section>
        )}
      </For>

      <Show when={setupProvider()}>
        {(prov) => (
          <ChannelTokenSetupModal
            provider={prov()}
            onClose={() => setSetupProvider(null)}
            onSaved={() => void refetch()}
          />
        )}
      </Show>
    </article>
  );
};

const ChannelStatusChip: Component<{
  status: ReturnType<typeof tokenStatusFor>;
  implemented: boolean;
}> = (p) => {
  const kind = () => p.status.kind;
  return (
    <span
      class="channel-status-chip"
      classList={{
        'channel-status-missing': kind() === 'missing',
        'channel-status-valid': kind() === 'valid',
        'channel-status-expired': kind() === 'expired',
      }}
    >
      <Show when={kind() === 'missing'}>
        <span>{p.implemented ? 'Nicht verbunden' : 'Nicht verbunden (V2)'}</span>
      </Show>
      <Show when={kind() === 'valid'}>
        <Icon name="check" size={11} />
        <span>Verbunden</span>
      </Show>
      <Show when={kind() === 'expired'}>
        <Icon name="x" size={11} />
        <span>Abgelaufen</span>
      </Show>
    </span>
  );
};

export default AccountChannels;
