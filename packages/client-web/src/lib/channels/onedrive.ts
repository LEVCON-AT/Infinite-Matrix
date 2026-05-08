// Welle WV.D.5 — OneDrive-Provider via Microsoft Graph.
//
// Konzept §13.3 + plan-welle-d.md §4.3.
//
// Endpoints (alle https://graph.microsoft.com/v1.0/me/drive/...):
//   /root/children                        — Root-Folders + Files.
//   /items/{id}/children                  — Sub-Folder-Inhalt.
//   /items/{id}?$select=@microsoft.graph.downloadUrl
//                                         — Pre-signed Download-URL.
//   /items/{id}/preview                   — Thumbnail (deferred V2).
//
// Auth: gleicher MS-OAuth-Token-Pool wie outlook/teams. Provider 'onedrive'
// hat eigenen Slot — User kann mit derselben MS-Identitaet alle drei
// verbinden, oder getrennt.

import type { DriveFile, DriveFolder, DriveProviderImpl } from './drive-types';
import { getBearerToken } from './token';

const GRAPH_API = 'https://graph.microsoft.com/v1.0/me/drive';

type GraphDriveItem = {
  id: string;
  name: string;
  size?: number;
  lastModifiedDateTime?: string;
  webUrl?: string;
  folder?: { childCount?: number };
  file?: { mimeType?: string };
  parentReference?: { id?: string; path?: string };
  // Microsoft Graph: pre-signed Download-URL. @microsoft.graph.downloadUrl
  // ist nur im Single-item-Read mit $select gesetzt — Listen geben keinen.
  '@microsoft.graph.downloadUrl'?: string;
};

async function graphGet<T>(path: string, query?: Record<string, string>): Promise<T> {
  const token = await getBearerToken('onedrive');
  const url = new URL(`${GRAPH_API}${path}`);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`onedrive:graph_${res.status}:${errBody.slice(0, 120)}`);
  }
  return (await res.json()) as T;
}

async function graphMeGet<T>(path: string): Promise<T> {
  const token = await getBearerToken('onedrive');
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`onedrive:graph_${res.status}:${errBody.slice(0, 120)}`);
  }
  return (await res.json()) as T;
}

export const onedriveProvider: DriveProviderImpl = {
  provider: 'onedrive',

  async listFolders(parentId?: string): Promise<DriveFolder[]> {
    const path = parentId ? `/items/${parentId}/children` : '/root/children';
    const json = await graphGet<{ value: GraphDriveItem[] }>(path, {
      $top: '200',
      $select: 'id,name,folder,parentReference',
    });
    return (json.value ?? [])
      .filter((it) => it.folder)
      .map((it) => ({
        id: it.id,
        name: it.name,
        path: it.parentReference?.path,
        parentId: it.parentReference?.id ?? parentId ?? null,
      }));
  },

  async listFiles(folderId: string, limit?: number): Promise<DriveFile[]> {
    const effectiveLimit = limit ?? 50;
    const path = folderId === 'root' ? '/root/children' : `/items/${folderId}/children`;
    const json = await graphGet<{ value: GraphDriveItem[] }>(path, {
      $top: String(Math.max(1, Math.min(200, effectiveLimit))),
      $select: 'id,name,size,lastModifiedDateTime,webUrl,file,folder,parentReference',
      $orderby: 'lastModifiedDateTime desc',
    });
    return (json.value ?? [])
      .filter((it) => it.file)
      .map((it) => ({
        id: it.id,
        name: it.name,
        mimeType: it.file?.mimeType,
        sizeBytes: it.size,
        modifiedAt: it.lastModifiedDateTime,
        viewUrl: it.webUrl,
        parentFolderId: it.parentReference?.id ?? folderId,
      }));
  },

  async getDownloadUrl(fileId: string): Promise<string | null> {
    try {
      const json = await graphGet<GraphDriveItem>(`/items/${fileId}`, {
        $select: '@microsoft.graph.downloadUrl',
      });
      return json['@microsoft.graph.downloadUrl'] ?? null;
    } catch (err) {
      console.warn('onedrive getDownloadUrl:', err);
      return null;
    }
  },

  async testConnect(): Promise<{ ok: true; profileLabel: string } | { ok: false; reason: string }> {
    try {
      const me = await graphMeGet<{
        displayName: string;
        userPrincipalName?: string;
        mail?: string;
      }>('/me');
      return { ok: true, profileLabel: me.mail || me.userPrincipalName || me.displayName };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: msg };
    }
  },
};
