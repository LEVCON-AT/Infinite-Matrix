// Welle WV.D.5.b — Google Drive Provider via Drive REST v3.
//
// Konzept §13.3 + plan-welle-d.md §4.3.
//
// Doku: https://developers.google.com/drive/api/v3/reference
// Endpoints (alle https://www.googleapis.com/drive/v3/...):
//   /files                                 — Liste Files+Folders mit q-Filter.
//   /files/{id}?fields=...                 — File-Detail.
//   /files/{id}?alt=media                  — Direkter Download (Binary).
//
// Auth: gleicher OAuth-Token-Pool wie gmail. Provider 'drive'.
// CORS: googleapis.com erlaubt browser-direkten Zugriff.
//
// V1: simple list-by-parent. Shared-Drives, Trash-Filter etc. deferred.

import type { DriveFile, DriveFolder, DriveProviderImpl } from './drive-types';
import { getBearerToken } from './token';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';

type GoogleDriveItem = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
  webContentLink?: string;
  parents?: string[];
  thumbnailLink?: string;
};

const FOLDER_MIME = 'application/vnd.google-apps.folder';

async function googleGet<T>(path: string, query?: Record<string, string>): Promise<T> {
  const token = await getBearerToken('drive');
  const url = new URL(`${DRIVE_API}${path}`);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`drive:${res.status}:${errBody.slice(0, 120)}`);
  }
  return (await res.json()) as T;
}

export const googleDriveProvider: DriveProviderImpl = {
  provider: 'drive',

  async listFolders(parentId?: string): Promise<DriveFolder[]> {
    const parent = parentId ?? 'root';
    const json = await googleGet<{ files: GoogleDriveItem[] }>('/files', {
      q: `'${parent}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
      fields: 'files(id,name,parents)',
      pageSize: '200',
      orderBy: 'name',
    });
    return (json.files ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      parentId: f.parents?.[0] ?? parentId ?? null,
    }));
  },

  async listFiles(folderId: string, limit?: number): Promise<DriveFile[]> {
    const effectiveLimit = limit ?? 50;
    const parent = folderId === 'root' ? 'root' : folderId;
    const json = await googleGet<{ files: GoogleDriveItem[] }>('/files', {
      q: `'${parent}' in parents and mimeType != '${FOLDER_MIME}' and trashed = false`,
      fields:
        'files(id,name,mimeType,size,modifiedTime,webViewLink,webContentLink,thumbnailLink,parents)',
      pageSize: String(Math.max(1, Math.min(200, effectiveLimit))),
      orderBy: 'modifiedTime desc',
    });
    return (json.files ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      sizeBytes: f.size ? Number.parseInt(f.size, 10) : undefined,
      modifiedAt: f.modifiedTime,
      viewUrl: f.webViewLink,
      thumbnailUrl: f.thumbnailLink,
      parentFolderId: f.parents?.[0] ?? folderId,
    }));
  },

  async getDownloadUrl(fileId: string): Promise<string | null> {
    // webContentLink ist direkt downloadbar (mit User-Auth-Cookie).
    // Alternativ: signierte URL via /files/{id}?alt=media — aber das
    // braucht ebenfalls Bearer im Request, ist also keine pre-signed URL.
    try {
      const json = await googleGet<GoogleDriveItem>(`/files/${fileId}`, {
        fields: 'webContentLink,webViewLink',
      });
      return json.webContentLink ?? json.webViewLink ?? null;
    } catch (err) {
      console.warn('drive getDownloadUrl:', err);
      return null;
    }
  },

  async testConnect(): Promise<{ ok: true; profileLabel: string } | { ok: false; reason: string }> {
    try {
      const json = await googleGet<{ user: { displayName?: string; emailAddress?: string } }>(
        '/about',
        { fields: 'user(displayName,emailAddress)' },
      );
      return {
        ok: true,
        profileLabel: json.user.emailAddress || json.user.displayName || 'unbekannt',
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: msg };
    }
  },
};
