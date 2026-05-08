// Welle WV.D.5.b — Dropbox Provider via Dropbox API v2.
//
// Konzept §13.3 + plan-welle-d.md §4.3.
//
// Doku: https://www.dropbox.com/developers/documentation/http/documentation
// Endpoints (alle https://api.dropboxapi.com/2/files/...):
//   POST /list_folder        — Liste Folder-Inhalt.
//   POST /get_metadata       — File-Detail.
//   POST /get_temporary_link — Pre-signed Download-URL (4h gueltig).
//
// Auth: `Authorization: Bearer <oauth-token>`. POST-Body json mit
// {"path": "..."}. Path-Format: "/Foldername" (von root) oder "" fuer
// root. Im Response: id (Server-ID), path_lower (full path).
//
// CORS: api.dropboxapi.com erlaubt browser-direkten Zugriff.

import type { DriveFile, DriveFolder, DriveProviderImpl } from './drive-types';
import { getBearerToken } from './token';

const API = 'https://api.dropboxapi.com/2';

type DropboxFolder = {
  '.tag': 'folder';
  id: string;
  name: string;
  path_lower?: string;
};

type DropboxFile = {
  '.tag': 'file';
  id: string;
  name: string;
  path_lower?: string;
  size?: number;
  client_modified?: string;
  server_modified?: string;
  content_hash?: string;
};

type DropboxEntry = DropboxFolder | DropboxFile;

async function dropboxPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const token = await getBearerToken('dropbox');
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`dropbox:${res.status}:${errBody.slice(0, 120)}`);
  }
  return (await res.json()) as T;
}

// Dropbox unterscheidet Path (root-relativ z.B. "/Documents") vs.
// Path-ID (Server-ID z.B. "id:abc123"). list_folder akzeptiert beides.
// Wir normalisieren: "" fuer root, sonst id-string oder slash-Pfad.
function normalizePath(folderId: string | undefined): string {
  if (!folderId || folderId === 'root') return '';
  // Wenn id-Format (mit Doppelpunkt) → unveraendert. Sonst Pfad mit Slash.
  if (folderId.startsWith('id:')) return folderId;
  return folderId.startsWith('/') ? folderId : `/${folderId}`;
}

export const dropboxProvider: DriveProviderImpl = {
  provider: 'dropbox',

  async listFolders(parentId?: string): Promise<DriveFolder[]> {
    const json = await dropboxPost<{ entries: DropboxEntry[] }>('/files/list_folder', {
      path: normalizePath(parentId),
    });
    return (json.entries ?? [])
      .filter((e): e is DropboxFolder => e['.tag'] === 'folder')
      .map((f) => ({
        id: f.id,
        name: f.name,
        path: f.path_lower,
        parentId: parentId ?? null,
      }));
  },

  async listFiles(folderId: string, limit?: number): Promise<DriveFile[]> {
    const effectiveLimit = limit ?? 50;
    const json = await dropboxPost<{ entries: DropboxEntry[] }>('/files/list_folder', {
      path: normalizePath(folderId),
      limit: Math.max(1, Math.min(2000, effectiveLimit)),
    });
    return (json.entries ?? [])
      .filter((e): e is DropboxFile => e['.tag'] === 'file')
      .map((f) => ({
        id: f.id,
        name: f.name,
        sizeBytes: f.size,
        modifiedAt: f.client_modified ?? f.server_modified,
        parentFolderId: folderId,
        // Dropbox hat keine direkten Web-Links auf File-Metadata.
        // get_temporary_link liefert pre-signed URL (4h). On-demand
        // im Click-Handler via getDownloadUrl.
      }));
  },

  async getDownloadUrl(fileId: string): Promise<string | null> {
    try {
      const json = await dropboxPost<{ link: string }>('/files/get_temporary_link', {
        path: fileId,
      });
      return json.link;
    } catch (err) {
      console.warn('dropbox getDownloadUrl:', err);
      return null;
    }
  },

  async testConnect(): Promise<{ ok: true; profileLabel: string } | { ok: false; reason: string }> {
    try {
      const json = await dropboxPost<{
        email: string;
        name?: { display_name?: string };
      }>('/users/get_current_account', {});
      return { ok: true, profileLabel: json.email || json.name?.display_name || 'unbekannt' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: msg };
    }
  },
};
