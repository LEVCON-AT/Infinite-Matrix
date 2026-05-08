// Welle WV.D.3.g — Channel-Widget-Renderer.
//
// Konzept §13.4 + plan-welle-d.md §4.1.
//
// Rendert eine Liste der letzten Messages eines konfigurierten Channel-
// Bridges. Das Widget wird in TemplateWidgetRenderer (Match: type='channel')
// gemounted; widget_external_channels-Row (mit provider + external_ref)
// liefert dem Renderer Provider und Inbox-ID.
//
// State-Maschine:
//   - „Nicht konfiguriert" — kein widget_external_channels-Eintrag
//     (Edit-Mode-CTA: Channel waehlen).
//   - „Provider nicht implementiert" — DB hat externe-Ref, aber Lib hat
//     keinen Impl (z.B. discord-V1).
//   - „Token fehlt" — User-Token nicht verbunden (CTA: Settings oeffnen).
//   - „Token abgelaufen" — Re-Connect-CTA.
//   - „OK" — Message-Liste.

import { A } from '@solidjs/router';
import { useParams } from '@solidjs/router';
import { type Component, For, Show, createMemo, createResource } from 'solid-js';
import { useUser } from '../lib/auth';
import { type ChannelMessage, getChannelImpl, hasChannelImpl } from '../lib/channels';
import { CHANNEL_PROVIDER_LABEL } from '../lib/channels-meta';
import { fetchOAuthTokens, tokenStatusFor } from '../lib/oauth-tokens';
import type { WidgetExternalChannelRow } from '../lib/types';
import Icon from './Icon';

export type ChannelWidgetProps = {
  // Channel-Bridge fuer dieses Widget. null = Widget noch nicht
  // verknuepft (User muss im Inspector einen Channel waehlen).
  channel: WidgetExternalChannelRow | null;
  editMode?: boolean;
  // Optional: in Edit-Mode kann Caller einen "Channel waehlen"-CTA
  // einblenden, der den Inspector oeffnet. V1 Stub-Callback.
  onPickChannel?: () => void;
};

const ChannelWidget: Component<ChannelWidgetProps> = (p) => {
  const user = useUser();
  const params = useParams();
  const wsId = () => params.workspaceId;

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

  const provider = () => p.channel?.provider ?? null;
  const isImplemented = createMemo(() => {
    const prov = provider();
    return prov ? hasChannelImpl(prov) : false;
  });
  const tokenStatus = createMemo(() => {
    const prov = provider();
    if (!prov) return null;
    const list = tokens();
    if (!list) return null;
    return tokenStatusFor(list, prov);
  });

  // Inbox-ID aus external_ref. Provider-spezifisch — V1 unterstuetzen
  // wir die Felder die Slack/Teams nutzen: channel_id (Slack) oder
  // chat_id / inbox_id (Teams/Mail).
  const inboxId = createMemo(() => {
    const ref = p.channel?.external_ref;
    if (!ref) return null;
    const r = ref as Record<string, unknown>;
    return ((r.inbox_id ?? r.channel_id ?? r.chat_id ?? r.folder_id) as string | undefined) ?? null;
  });

  const [messages] = createResource(
    () => {
      const prov = provider();
      const inb = inboxId();
      const stat = tokenStatus();
      if (!prov || !inb || !isImplemented()) return null;
      if (!stat || stat.kind !== 'valid') return null;
      return { prov, inb };
    },
    async (req) => {
      try {
        const impl = getChannelImpl(req.prov);
        return await impl.listMessages(req.inb, 20);
      } catch (err) {
        console.warn('ChannelWidget listMessages:', err);
        return [];
      }
    },
  );

  return (
    <div class="channel-widget-body">
      <Show when={!p.channel}>
        <ChannelEmptyHint
          editMode={p.editMode}
          onPickChannel={p.onPickChannel}
          message="Noch kein Channel verknuepft."
        />
      </Show>
      <Show when={p.channel}>
        {(channel) => (
          <>
            <Show when={!isImplemented()}>
              <ChannelEmptyHint
                editMode={p.editMode}
                message={`${CHANNEL_PROVIDER_LABEL[channel().provider]}: Provider noch nicht implementiert (V1).`}
              />
            </Show>
            <Show when={isImplemented() && (!tokenStatus() || tokenStatus()?.kind === 'missing')}>
              <ChannelTokenMissingHint provider={channel().provider} workspaceId={wsId()} />
            </Show>
            <Show when={isImplemented() && tokenStatus()?.kind === 'expired'}>
              <ChannelTokenMissingHint provider={channel().provider} workspaceId={wsId()} expired />
            </Show>
            <Show when={isImplemented() && tokenStatus()?.kind === 'valid' && !inboxId()}>
              <ChannelEmptyHint
                editMode={p.editMode}
                onPickChannel={p.onPickChannel}
                message="Inbox/Channel nicht ausgewaehlt."
              />
            </Show>
            <Show when={isImplemented() && tokenStatus()?.kind === 'valid' && inboxId()}>
              <Show when={messages.loading}>
                <p class="channel-widget-hint">Lade Nachrichten…</p>
              </Show>
              <Show when={!messages.loading && (messages() ?? []).length === 0}>
                <p class="channel-widget-hint">Keine Nachrichten.</p>
              </Show>
              <ul class="channel-widget-list">
                <For each={messages() ?? []}>{(msg) => <ChannelMessageItem message={msg} />}</For>
              </ul>
            </Show>
          </>
        )}
      </Show>
    </div>
  );
};

const ChannelEmptyHint: Component<{
  editMode?: boolean;
  message: string;
  onPickChannel?: () => void;
}> = (p) => {
  return (
    <div class="channel-widget-empty">
      <p class="channel-widget-hint">{p.message}</p>
      <Show when={p.editMode && p.onPickChannel}>
        <button type="button" class="btn-subtle btn-small" onClick={() => p.onPickChannel?.()}>
          <Icon name="plus" size={11} />
          <span>Channel waehlen</span>
        </button>
      </Show>
    </div>
  );
};

const ChannelTokenMissingHint: Component<{
  provider: string;
  workspaceId?: string;
  expired?: boolean;
}> = (p) => {
  const settingsHref = () =>
    p.workspaceId ? `/w/${p.workspaceId}/settings/account/channels` : '/settings/account/channels';
  return (
    <div class="channel-widget-empty">
      <p class="channel-widget-hint">
        {p.expired ? 'Token abgelaufen.' : 'Provider noch nicht verbunden.'}
      </p>
      <A href={settingsHref()} class="btn-subtle btn-small">
        <Icon name="cog" size={11} />
        <span>{p.expired ? 'Neu verbinden' : 'Verbinden'}</span>
      </A>
    </div>
  );
};

const ChannelMessageItem: Component<{ message: ChannelMessage }> = (p) => {
  const formattedTime = createMemo(() => {
    try {
      const d = new Date(p.message.receivedAt);
      return d.toLocaleString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  });

  return (
    <li class="channel-widget-msg">
      <div class="channel-widget-msg-head">
        <span class="channel-widget-msg-from">{p.message.fromName}</span>
        <span class="channel-widget-msg-time">{formattedTime()}</span>
      </div>
      <Show when={p.message.subject}>
        {(subj) => <p class="channel-widget-msg-subject">{subj()}</p>}
      </Show>
      <p class="channel-widget-msg-body">{p.message.bodyText}</p>
      <Show when={p.message.externalUrl}>
        {(url) => (
          <a class="channel-widget-msg-link" href={url()} target="_blank" rel="noopener noreferrer">
            <Icon name="arrow-top-right-on-square" size={10} />
            <span>Im Provider oeffnen</span>
          </a>
        )}
      </Show>
    </li>
  );
};

export default ChannelWidget;
