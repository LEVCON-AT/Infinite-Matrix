// Welle WV.D.5.c — Nextcloud Provider via WebDAV.
//
// Konzept §13.3 + plan-welle-d.md §4.3.
//
// Nextcloud nutzt WebDAV (RFC4918) statt OAuth-Bearer-API. Per User
// braucht's nicht zwingend OAuth — App-Password reicht. V1: speichern
// wir ein Bearer-Token, das ist tatsaechlich „basic-Auth-User:App-Password
// base64-encoded" — der User pasted ihn manuell rein (auth_url +
// token_url leer im Slot).
//
// Endpoints (alle relativ zu nextcloud_base_url, configured in Slot):
//   PROPFIND /remote.php/dav/files/<user>/<path>  — Folder-Listing.
//   GET      /remote.php/dav/files/<user>/<path>  — File-Download.
//
// Slot-extra_config braucht: { base_url, username }. base_url z.B.
// https://cloud.example.com — username z.B. "alice".
//
// V1-Constraint: Token-Format „basicAuthBase64" (= btoa("user:app-pw")).
// Wird via Manual-Paste eingegeben. Header: Authorization: Basic <b64>.
//
// CORS: Nextcloud-Default blockiert browser-direkten Zugriff. User muss
// via app/files_external_cors o.ae. die CORS-Origins setzen, ODER Server-
// Side-Proxy nutzen (V2).
//
// V1-Status: Lib existiert + Listing funktioniert wenn CORS-konfig. Bei
// CORS-Fehler: User sieht „network"-Reason im Test-Connect.

import type { DriveFile, DriveFolder, DriveProviderImpl } from './drive-types';
import { getDecryptedOAuthToken } from './token';

type SlotExtra = {
  base_url?: string;
  username?: string;
};

async function getNextcloudCreds(): Promise<{
  baseUrl: string;
  username: string;
  basicAuth: string;
}> {
  // Token-Storage: pgp_sym_decrypt liefert hier den base64 basic-auth-string
  // (User hat im Setup-Modal „dGVzdDpwYXNzd29yZA==" o.ae. eingegeben).
  // base_url + username leben in oauth_provider_slots.extra_config.
  const tokenRow = await getDecryptedOAuthToken('nextcloud');
  if (!tokenRow || !tokenRow.accessToken) {
    throw new Error('nextcloud:not_connected');
  }
  // Slot lesen: extra_config aus oauth_provider_slots_safe-View. Aber
  // hier nutzen wir einen Trick: setOAuthToken speichert kein extra_config.
  // V1: extra_config muss separat aus slots-Resource geholt werden.
  // Wir lesen sie via direkter Slot-Query — aber das wuerde in der UI-
  // Schicht passieren (AccountChannels uebergibt es spaeter pro Call).
  //
  // V1-Workaround: das gespeicherte „token" ist `base64(user:pw)` UND
  // wir extrahieren username + base_url aus dem JSON-Body, den der User
  // beim Manual-Setup paste. Format:
  //   {"base_url": "...", "username": "...", "basic_auth": "..."}
  //
  // Wenn token.startsWith('{'): parse JSON. Sonst legacy: nur basic_auth.
  if (tokenRow.accessToken.startsWith('{')) {
    try {
      const obj = JSON.parse(tokenRow.accessToken) as SlotExtra & { basic_auth?: string };
      if (obj.base_url && obj.username && obj.basic_auth) {
        return {
          baseUrl: obj.base_url.replace(/\/$/, ''),
          username: obj.username,
          basicAuth: obj.basic_auth,
        };
      }
    } catch {
      // fall through
    }
  }
  throw new Error('nextcloud:invalid_credentials_format');
}

async function webdavPropfind(
  baseUrl: string,
  username: string,
  basicAuth: string,
  path: string,
): Promise<Element[]> {
  const url = `${baseUrl}/remote.php/dav/files/${encodeURIComponent(username)}/${path}`;
  const res = await fetch(url, {
    method: 'PROPFIND',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      Depth: '1',
      'Content-Type': 'application/xml',
    },
    body: `<?xml version="1.0"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:resourcetype/>
    <d:getlastmodified/>
    <d:getcontentlength/>
    <d:getcontenttype/>
    <d:displayname/>
  </d:prop>
</d:propfind>`,
  });
  if (!res.ok && res.status !== 207) {
    throw new Error(`nextcloud:webdav_${res.status}`);
  }
  const xml = await res.text();
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const responses = doc.getElementsByTagNameNS('DAV:', 'response');
  return Array.from(responses);
}

function parseHref(el: Element): string {
  const href = el.getElementsByTagNameNS('DAV:', 'href')[0]?.textContent ?? '';
  return decodeURIComponent(href);
}

function isCollection(el: Element): boolean {
  const collection = el.getElementsByTagNameNS('DAV:', 'collection');
  return collection.length > 0;
}

function getProp(el: Element, name: string): string | undefined {
  return el.getElementsByTagNameNS('DAV:', name)[0]?.textContent ?? undefined;
}

export const nextcloudProvider: DriveProviderImpl = {
  provider: 'nextcloud',

  async listFolders(parentId?: string): Promise<DriveFolder[]> {
    const { baseUrl, username, basicAuth } = await getNextcloudCreds();
    const path = parentId && parentId !== 'root' ? parentId : '';
    const responses = await webdavPropfind(baseUrl, username, basicAuth, path);
    const out: DriveFolder[] = [];
    const selfPrefix = `/remote.php/dav/files/${encodeURIComponent(username)}/${path}`;
    for (const el of responses) {
      const href = parseHref(el);
      // Skip self
      if (href.replace(/\/$/, '').endsWith(selfPrefix.replace(/\/$/, ''))) continue;
      if (!isCollection(el)) continue;
      // Path = href ohne baseUrl-Prefix.
      const subPath = href.split(`/files/${username}/`)[1] ?? '';
      const cleaned = subPath.replace(/\/$/, '');
      const name = cleaned.split('/').filter(Boolean).pop() ?? '/';
      out.push({
        id: cleaned,
        name,
        path: cleaned,
        parentId: parentId ?? null,
      });
    }
    return out;
  },

  async listFiles(folderId: string, limit?: number): Promise<DriveFile[]> {
    const { baseUrl, username, basicAuth } = await getNextcloudCreds();
    const path = folderId === 'root' ? '' : folderId;
    const responses = await webdavPropfind(baseUrl, username, basicAuth, path);
    const out: DriveFile[] = [];
    for (const el of responses) {
      if (isCollection(el)) continue;
      const href = parseHref(el);
      const subPath = href.split(`/files/${username}/`)[1] ?? '';
      const name = subPath.split('/').filter(Boolean).pop() ?? '';
      const sizeStr = getProp(el, 'getcontentlength');
      const modified = getProp(el, 'getlastmodified');
      out.push({
        id: subPath,
        name,
        sizeBytes: sizeStr ? Number.parseInt(sizeStr, 10) : undefined,
        modifiedAt: modified ? new Date(modified).toISOString() : undefined,
        mimeType: getProp(el, 'getcontenttype'),
        viewUrl: `${baseUrl}/index.php/apps/files/?dir=/${path}&openfile=${encodeURIComponent(name)}`,
        parentFolderId: folderId,
      });
    }
    return out.slice(0, limit ?? 50);
  },

  async getDownloadUrl(fileId: string): Promise<string | null> {
    try {
      const { baseUrl, username } = await getNextcloudCreds();
      // V1: WebDAV-URL ohne pre-signed-Token. Browser muss Bearer/Basic
      // mitsenden — funktioniert nur in fetch-Calls, nicht beim direkten
      // Download via Click. V2: WebDAV-Share via POST
      // /ocs/v2.php/apps/files_sharing/api/v1/shares fuer pre-signed.
      return `${baseUrl}/remote.php/dav/files/${encodeURIComponent(username)}/${fileId}`;
    } catch {
      return null;
    }
  },

  async testConnect(): Promise<{ ok: true; profileLabel: string } | { ok: false; reason: string }> {
    try {
      const { baseUrl, username } = await getNextcloudCreds();
      const responses = await webdavPropfind(
        baseUrl,
        username,
        (await getNextcloudCreds()).basicAuth,
        '',
      );
      if (responses.length === 0) {
        return { ok: false, reason: 'no_response' };
      }
      return { ok: true, profileLabel: `${username} @ ${new URL(baseUrl).host}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: msg };
    }
  },
};
