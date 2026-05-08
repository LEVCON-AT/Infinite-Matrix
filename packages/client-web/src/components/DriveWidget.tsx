// Welle WV.D.5.a — Drive-Widget-Renderer.
//
// Konzept §13.3 + plan-welle-d.md §4.3.
//
// Rendert Folder-Children + File-Liste eines konfigurierten Cloud-
// Drive-Folders. Drag-Source: Drag-File → addCellAtomLink (D.5.c).
//
// State-Maschine analog ChannelWidget:
//   - „Nicht konfiguriert" — kein widget_external_channels.
//   - „Provider nicht implementiert" — DB hat ref, lib nicht.
//   - „Token fehlt / abgelaufen" — Settings-CTA.
//   - „OK" — Folder-Picker (sub) + File-Liste.

import { A } from '@solidjs/router';
import { useParams } from '@solidjs/router';
import { type Component, For, Show, createMemo, createResource, createSignal } from 'solid-js';
import { useUser } from '../lib/auth';
import { type DriveFile, type DriveFolder, getDriveImpl, hasDriveImpl } from '../lib/channels';
import { CHANNEL_PROVIDER_LABEL } from '../lib/channels-meta';
import { addCellAtomLink } from '../lib/mutations';
import { fetchOAuthTokens, tokenStatusFor } from '../lib/oauth-tokens';
import { showToast } from '../lib/toasts';
import type { WidgetExternalChannelRow } from '../lib/types';
import Icon from './Icon';

export type DriveWidgetProps = {
  channel: WidgetExternalChannelRow | null;
  editMode?: boolean;
  onPickChannel?: () => void;
  // Welle WV.D.5.c — bei Drag-File wird ein Cell-Link-Atom angelegt.
  // Wenn Caller cellId mitgibt, ist das Drag-Source aktiv. cellId =
  // dem Cell-Container in dem das Widget rendert.
  cellId?: string;
  workspaceId?: string;
};

const DriveWidget: Component<DriveWidgetProps> = (p) => {
  const user = useUser();
  const params = useParams();
  const wsId = () => p.workspaceId ?? params.workspaceId;

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
    return prov ? hasDriveImpl(prov) : false;
  });
  const tokenStatus = createMemo(() => {
    const prov = provider();
    if (!prov) return null;
    const list = tokens();
    if (!list) return null;
    return tokenStatusFor(list, prov);
  });

  // Aktuell angezeigter Folder. Default: aus widget_external_channels.
  const initialFolder = (): string | null => {
    const ref = p.channel?.external_ref as Record<string, unknown> | undefined;
    return ((ref?.folder_id ?? ref?.inbox_id) as string | undefined) ?? null;
  };
  const [currentFolderId, setCurrentFolderId] = createSignal<string | null>(initialFolder());
  const [folderHistory, setFolderHistory] = createSignal<Array<{ id: string; name: string }>>([]);

  const tokenReady = () => tokenStatus()?.kind === 'valid';

  const [files] = createResource(
    () => {
      const prov = provider();
      const fid = currentFolderId() ?? 'root';
      if (!prov || !isImplemented() || !tokenReady()) return null;
      return { prov, fid };
    },
    async (req) => {
      try {
        const impl = getDriveImpl(req.prov);
        return await impl.listFiles(req.fid, 50);
      } catch (err) {
        console.warn('DriveWidget listFiles:', err);
        return [];
      }
    },
  );

  const [subFolders] = createResource(
    () => {
      const prov = provider();
      const fid = currentFolderId();
      if (!prov || !isImplemented() || !tokenReady()) return null;
      return { prov, fid: fid ?? undefined };
    },
    async (req) => {
      try {
        const impl = getDriveImpl(req.prov);
        return await impl.listFolders(req.fid);
      } catch (err) {
        console.warn('DriveWidget listFolders:', err);
        return [];
      }
    },
  );

  const enterFolder = (folder: DriveFolder) => {
    setFolderHistory((h) => [...h, { id: currentFolderId() ?? 'root', name: 'zurueck' }]);
    setCurrentFolderId(folder.id);
  };

  const goUp = () => {
    setFolderHistory((h) => {
      const last = h[h.length - 1];
      if (last) {
        setCurrentFolderId(last.id === 'root' ? null : last.id);
        return h.slice(0, -1);
      }
      return h;
    });
  };

  // Drag-Source: User zieht eine File aus dem Widget — wir legen ein
  // Cell-Link-Atom an (lib/mutations.ts addCellAtomLink). Welle WV.D.5.c.
  const handleDragStart = async (e: DragEvent, file: DriveFile) => {
    if (!p.cellId || !wsId()) return;
    if (!e.dataTransfer) return;
    // V1: simple URL-payload + name. Native Drag-API.
    const url = file.viewUrl ?? '';
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/uri-list', url);
    e.dataTransfer.setData('text/plain', `${file.name}\n${url}`);
    e.dataTransfer.setData(
      'application/x-matrix-drive-file',
      JSON.stringify({
        provider: provider(),
        fileId: file.id,
        name: file.name,
        viewUrl: file.viewUrl,
      }),
    );
  };

  // Drop-Handler vom Cell-Container ruft das. V1 nur via „Verknuepfen"-
  // Click-Button im Widget — Cell-Drop-Target-Wiring kommt mit D.5.c.
  const handleLinkFile = async (file: DriveFile) => {
    if (!p.cellId || !wsId()) return;
    try {
      const url = file.viewUrl ?? (await getDriveImpl(provider() as never).getDownloadUrl(file.id));
      if (!url) {
        showToast('Datei hat keine zugaengliche URL.', 'error');
        return;
      }
      await addCellAtomLink({
        workspaceId: wsId() as string,
        cellId: p.cellId,
        url,
        label: file.name,
        provider: 'url',
      });
      showToast(`„${file.name}" als Link verknuepft.`, 'success');
    } catch (err) {
      console.error('DriveWidget link:', err);
      showToast(err instanceof Error ? err.message : 'Verknuepfen fehlgeschlagen.', 'error');
    }
  };

  return (
    <div class="drive-widget-body">
      <Show when={!p.channel}>
        <DriveEmptyHint
          editMode={p.editMode}
          onPickChannel={p.onPickChannel}
          message="Noch kein Drive verknuepft."
        />
      </Show>
      <Show when={p.channel}>
        {(channel) => (
          <>
            <Show when={!isImplemented()}>
              <DriveEmptyHint
                editMode={p.editMode}
                message={`${CHANNEL_PROVIDER_LABEL[channel().provider]}: Drive-Provider noch nicht implementiert (V1).`}
              />
            </Show>
            <Show when={isImplemented() && (!tokenStatus() || tokenStatus()?.kind === 'missing')}>
              <DriveTokenHint provider={channel().provider} workspaceId={wsId()} />
            </Show>
            <Show when={isImplemented() && tokenStatus()?.kind === 'expired'}>
              <DriveTokenHint provider={channel().provider} workspaceId={wsId()} expired />
            </Show>
            <Show when={tokenReady()}>
              <header class="drive-widget-head">
                <Show when={folderHistory().length > 0}>
                  <button
                    type="button"
                    class="btn-subtle btn-small"
                    onClick={goUp}
                    title="Eine Ebene hoch"
                  >
                    <Icon name="arrow-left" size={11} />
                    <span>Hoch</span>
                  </button>
                </Show>
                <span class="drive-widget-path">
                  {folderHistory().length === 0 ? 'Stamm' : `Ebene ${folderHistory().length}`}
                </span>
              </header>
              <Show when={(subFolders() ?? []).length > 0}>
                <ul class="drive-widget-folders">
                  <For each={subFolders() ?? []}>
                    {(folder) => (
                      <li class="drive-widget-folder">
                        <button
                          type="button"
                          class="drive-widget-folder-btn"
                          onClick={() => enterFolder(folder)}
                          title={folder.name}
                        >
                          <Icon name="folder" size={14} />
                          <span>{folder.name}</span>
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
              <Show when={files.loading}>
                <p class="drive-widget-hint">Lade Dateien…</p>
              </Show>
              <Show when={!files.loading && (files() ?? []).length === 0}>
                <p class="drive-widget-hint">Keine Dateien in diesem Ordner.</p>
              </Show>
              <ul class="drive-widget-files">
                <For each={files() ?? []}>
                  {(file) => (
                    <li class="drive-widget-file">
                      <div
                        class="drive-widget-file-main"
                        draggable={Boolean(p.cellId)}
                        onDragStart={(e) => void handleDragStart(e, file)}
                        title={file.name}
                      >
                        <Icon name="document-text" size={12} />
                        <span class="drive-widget-file-name">{file.name}</span>
                        <Show when={file.modifiedAt}>
                          {(ts) => (
                            <span class="drive-widget-file-time">
                              {new Date(ts()).toLocaleDateString('de-DE')}
                            </span>
                          )}
                        </Show>
                      </div>
                      <div class="drive-widget-file-actions">
                        <Show when={file.viewUrl}>
                          {(url) => (
                            <a
                              href={url()}
                              target="_blank"
                              rel="noopener noreferrer"
                              class="drive-widget-file-link"
                              title="Im Provider oeffnen"
                            >
                              <Icon name="arrow-top-right-on-square" size={10} />
                            </a>
                          )}
                        </Show>
                        <Show when={p.cellId}>
                          <button
                            type="button"
                            class="drive-widget-file-link"
                            onClick={() => void handleLinkFile(file)}
                            title="Als Link mit Cell verknuepfen"
                          >
                            <Icon name="link" size={10} />
                          </button>
                        </Show>
                      </div>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </>
        )}
      </Show>
    </div>
  );
};

const DriveEmptyHint: Component<{
  editMode?: boolean;
  message: string;
  onPickChannel?: () => void;
}> = (p) => (
  <div class="drive-widget-empty">
    <p class="drive-widget-hint">{p.message}</p>
    <Show when={p.editMode && p.onPickChannel}>
      <button type="button" class="btn-subtle btn-small" onClick={() => p.onPickChannel?.()}>
        <Icon name="plus" size={11} />
        <span>Drive waehlen</span>
      </button>
    </Show>
  </div>
);

const DriveTokenHint: Component<{
  provider: string;
  workspaceId?: string;
  expired?: boolean;
}> = (p) => {
  const settingsHref = () =>
    p.workspaceId ? `/w/${p.workspaceId}/settings/account/channels` : '/settings/account/channels';
  return (
    <div class="drive-widget-empty">
      <p class="drive-widget-hint">
        {p.expired ? 'Token abgelaufen.' : 'Drive-Provider noch nicht verbunden.'}
      </p>
      <A href={settingsHref()} class="btn-subtle btn-small">
        <Icon name="cog" size={11} />
        <span>{p.expired ? 'Neu verbinden' : 'Verbinden'}</span>
      </A>
    </div>
  );
};

export default DriveWidget;
