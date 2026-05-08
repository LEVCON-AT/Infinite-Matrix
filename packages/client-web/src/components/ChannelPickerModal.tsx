// Welle WV.D.3.g — Channel-Picker-Modal.
//
// Konzept §13.4 + plan-welle-d.md §4.1.
//
// User waehlt fuer ein Widget einen Provider + Inbox/Channel. Resultat
// landet in widget_external_channels (provider + external_ref.inbox_id).
//
// V1-Konstraints:
//   - Provider-Liste auf hasChannelImpl gefiltert (Slack/Teams).
//   - Token muss vorhanden + valid sein. Wenn nicht: CTA „verbinden",
//     der Modal schliesst zur Settings-Page.
//   - Keine Pagination der Inbox-Liste — V1 zeigt was listInboxes liefert.

import { A } from '@solidjs/router';
import {
  type Component,
  For,
  Show,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import { useUser } from '../lib/auth';
import {
  type ChannelInbox,
  getChannelImpl,
  getDriveImpl,
  hasChannelImpl,
  hasDriveImpl,
  listImplementedDriveProviders,
  listImplementedProviders,
} from '../lib/channels';
import { CHANNEL_PROVIDER_LABEL } from '../lib/channels-meta';
import { installFocusRestore, installFocusTrap } from '../lib/dialog';
import { translateDbError } from '../lib/errors';
import { fetchOAuthTokens, tokenStatusFor } from '../lib/oauth-tokens';
import { showToast } from '../lib/toasts';
import type { ChannelProvider, TemplateWidgetType, WidgetExternalChannelRow } from '../lib/types';
import { setWidgetChannel } from '../lib/widget-channels';
import Icon from './Icon';

export type ChannelPickerModalProps = {
  widgetId: string;
  workspaceId: string;
  // Welle WV.D.5.a — Picker-Modus. 'channel' = Mail/Chat-Inbox-Liste,
  // 'drive' = Drive-Folder-Liste. Default 'channel'.
  widgetType?: TemplateWidgetType;
  // null = neue Verknuepfung. Set = bestehende editieren (Provider
  // bleibt fest, nur Inbox-Auswahl moeglich).
  existing: WidgetExternalChannelRow | null;
  // Workspace-ID-Pfad fuer Settings-CTA (gleicher wsId wie das Widget).
  settingsWorkspaceId?: string;
  onClose: () => void;
  onSaved: () => void;
};

const ChannelPickerModal: Component<ChannelPickerModalProps> = (p) => {
  const user = useUser();
  const isDrive = () => p.widgetType === 'drive';
  const initialProvider = (p.existing?.provider ?? null) as ChannelProvider | null;
  const [provider, setProvider] = createSignal<ChannelProvider | null>(initialProvider);
  const initialInboxId = ((): string | null => {
    const ref = p.existing?.external_ref as Record<string, unknown> | undefined;
    return ((ref?.inbox_id ?? ref?.folder_id) as string | undefined) ?? null;
  })();
  const [inboxId, setInboxId] = createSignal<string | null>(initialInboxId);
  const [busy, setBusy] = createSignal(false);

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
  });

  const [tokens] = createResource(
    () => user()?.id ?? null,
    async (uid) => {
      if (!uid) return [];
      try {
        return await fetchOAuthTokens(uid);
      } catch {
        return [];
      }
    },
  );

  const tokenStatus = createMemo(() => {
    const prov = provider();
    if (!prov) return null;
    const list = tokens();
    if (!list) return null;
    return tokenStatusFor(list, prov);
  });

  const tokenReady = () => {
    const stat = tokenStatus();
    return stat?.kind === 'valid';
  };

  const hasImpl = (prov: ChannelProvider): boolean =>
    isDrive() ? hasDriveImpl(prov) : hasChannelImpl(prov);

  const [inboxes] = createResource(
    () => {
      const prov = provider();
      if (!prov || !hasImpl(prov) || !tokenReady()) return null;
      return { prov, drive: isDrive() };
    },
    async (req): Promise<ChannelInbox[]> => {
      try {
        if (req.drive) {
          const impl = getDriveImpl(req.prov);
          const folders = await impl.listFolders();
          return folders.map((f) => ({ id: f.id, name: f.name }));
        }
        const impl = getChannelImpl(req.prov);
        return await impl.listInboxes();
      } catch (err) {
        console.warn('listInboxes/listFolders:', err);
        return [];
      }
    },
  );

  const handleSave = async () => {
    const prov = provider();
    const inb = inboxId();
    if (!prov || !inb || busy()) return;
    setBusy(true);
    try {
      await setWidgetChannel({
        widgetId: p.widgetId,
        workspaceId: p.workspaceId,
        provider: prov,
        externalRef: isDrive() ? { folder_id: inb } : { inbox_id: inb },
      });
      showToast('Channel verknuepft.', 'success');
      p.onSaved();
      p.onClose();
    } catch (err) {
      console.error('setWidgetChannel:', err);
      showToast(translateDbError(err, 'Konnte Channel nicht verknuepfen.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const settingsHref = () =>
    p.settingsWorkspaceId
      ? `/w/${p.settingsWorkspaceId}/settings/account/channels`
      : '/settings/account/channels';

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
        class="overlay-card channel-picker-modal"
        // biome-ignore lint/a11y/useSemanticElements: role=dialog bewusst.
        role="dialog"
        aria-modal="true"
        aria-label="Channel verknuepfen"
      >
        <header class="overlay-head">
          <h3>Channel verknuepfen</h3>
          <button type="button" class="overlay-close" onClick={p.onClose} aria-label="Schliessen">
            <Icon name="x" size={18} />
          </button>
        </header>
        <div class="overlay-body channel-picker-body">
          <div class="form-row">
            <label for="ch-pick-provider">Provider</label>
            <select
              id="ch-pick-provider"
              value={provider() ?? ''}
              onChange={(e) =>
                setProvider((e.currentTarget.value || null) as ChannelProvider | null)
              }
            >
              <option value="">— bitte waehlen —</option>
              <For each={isDrive() ? listImplementedDriveProviders() : listImplementedProviders()}>
                {(prov) => <option value={prov}>{CHANNEL_PROVIDER_LABEL[prov]}</option>}
              </For>
            </select>
            <p class="hint">V1 implementiert: Slack + Teams. Weitere Provider folgen.</p>
          </div>

          <Show when={provider() && tokenStatus() && tokenStatus()?.kind !== 'valid'}>
            <div class="channel-picker-token-warn">
              <Icon name="information-circle" size={14} />
              <p class="hint">
                Token fuer {CHANNEL_PROVIDER_LABEL[provider() as ChannelProvider]}{' '}
                {tokenStatus()?.kind === 'expired' ? 'abgelaufen' : 'fehlt'}.
              </p>
              <A href={settingsHref()} class="btn-subtle btn-small" onClick={() => p.onClose()}>
                Verbinden
              </A>
            </div>
          </Show>

          <Show when={tokenReady()}>
            <div class="form-row">
              <label for="ch-pick-inbox">Channel / Inbox</label>
              <Show when={inboxes.loading}>
                <p class="hint">Lade Channels…</p>
              </Show>
              <Show when={!inboxes.loading}>
                <select
                  id="ch-pick-inbox"
                  value={inboxId() ?? ''}
                  onChange={(e) => setInboxId(e.currentTarget.value || null)}
                >
                  <option value="">— bitte waehlen —</option>
                  <For each={inboxes() ?? []}>
                    {(inb: ChannelInbox) => (
                      <option value={inb.id}>
                        {inb.name}
                        {inb.unreadCount && inb.unreadCount > 0 ? ` (${inb.unreadCount})` : ''}
                      </option>
                    )}
                  </For>
                </select>
              </Show>
            </div>
          </Show>
        </div>
        <footer class="overlay-foot">
          <button type="button" class="btn-subtle" onClick={p.onClose} disabled={busy()}>
            Abbrechen
          </button>
          <button
            type="button"
            class="btn-primary"
            disabled={busy() || !provider() || !inboxId()}
            onClick={() => void handleSave()}
          >
            {busy() ? 'Speichere…' : 'Verknuepfen'}
          </button>
        </footer>
      </div>
    </div>
  );
};

export default ChannelPickerModal;
