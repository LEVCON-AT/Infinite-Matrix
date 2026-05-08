// Welle WV.B fortgesetzt — Favicon-Cache (IDB, TTL 30 Tage).
//
// Cacht Favicon-Bilder client-seitig in IndexedDB. Reduziert Round-
// Trips zum Google-s2-Service auf 1× pro Hostname pro 30 Tage.
//
// Konzept-Verankerung: §12.3.4 Resolution-Order #2 (Favicon-Fetch
// fuer link.provider='url'). SW-Cache war urspruenglich vorgesehen,
// aber IDB ist einfacher (keine SW-Registration-Aenderung) und bietet
// dieselbe Funktion.
//
// Cache-Schluessel: hostname (z.B. 'example.com'). Value: Object-URL
// auf einen Blob — vom Caller via URL.createObjectURL erstellt.
// Persistierung: ArrayBuffer + MIME im IDB. Beim Read regeneriert
// die Lib den Blob + Object-URL on-the-fly.
//
// API:
//   - getCachedFaviconUrl(hostname) → Promise<string | null>
//     Liefert Object-URL wenn Cache-Hit + nicht expired.
//   - setCachedFavicon(hostname, blob) → Promise<void>
//     Cacht Blob fuer 30 Tage.
//   - fetchAndCacheFavicon(rawUrl) → Promise<string | null>
//     Convenience: fetcht von Google-s2 oder serviert aus Cache.
//
// IDB Store: 'favicons' — separat von der Workspace-Cache-DB
// (offline-cache.ts), damit DB_VERSION-Bumps in offline-cache.ts
// nicht den Favicon-Cache wischen.

import { type DBSchema, openDB } from 'idb';

const DB_NAME = 'matrix-favicons';
const DB_VERSION = 1;
const STORE = 'favicons';
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 Tage

interface FaviconCacheSchema extends DBSchema {
  favicons: {
    key: string;
    value: {
      hostname: string;
      buffer: ArrayBuffer;
      mime: string;
      cachedAt: number;
    };
  };
}

let dbPromise: Promise<
  ReturnType<typeof openDB<FaviconCacheSchema>> extends Promise<infer T> ? T : never
> | null = null;

async function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<FaviconCacheSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'hostname' });
        }
      },
    });
  }
  return dbPromise;
}

// Aktive Object-URLs pro Hostname — Memory-Reuse, damit wir nicht
// fuer jeden Render einen neuen URL erzeugen (sonst leakt URL-Pool).
const liveObjectUrls = new Map<string, string>();

function hostnameOf(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function buildGoogleS2Url(hostname: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=32`;
}

export async function getCachedFaviconUrl(hostname: string): Promise<string | null> {
  if (!hostname) return null;
  const memoUrl = liveObjectUrls.get(hostname);
  if (memoUrl) return memoUrl;
  try {
    const db = await getDB();
    const row = await db.get(STORE, hostname);
    if (!row) return null;
    if (Date.now() - row.cachedAt > TTL_MS) {
      // Expired — async cleanup, return null damit Caller refetcht.
      void db.delete(STORE, hostname);
      return null;
    }
    const blob = new Blob([row.buffer], { type: row.mime || 'image/png' });
    const url = URL.createObjectURL(blob);
    liveObjectUrls.set(hostname, url);
    return url;
  } catch (err) {
    console.warn('favicon-cache read:', err);
    return null;
  }
}

export async function setCachedFavicon(hostname: string, blob: Blob): Promise<void> {
  if (!hostname) return;
  try {
    const db = await getDB();
    const buffer = await blob.arrayBuffer();
    await db.put(STORE, {
      hostname,
      buffer,
      mime: blob.type || 'image/png',
      cachedAt: Date.now(),
    });
    // Memory-Cache invalidieren — naechster Read regeneriert URL.
    const old = liveObjectUrls.get(hostname);
    if (old) {
      URL.revokeObjectURL(old);
      liveObjectUrls.delete(hostname);
    }
  } catch (err) {
    console.warn('favicon-cache write:', err);
  }
}

// Convenience: vom Raw-URL aus → entweder Cache-Hit oder Fetch+Cache.
// Caller (UI-Component) ruft das in einem createResource oder onMount.
// Bei Fetch-Fehler (CORS / Network / 404): null → Caller faellt auf
// Heroicon-Fallback zurueck.
export async function fetchAndCacheFavicon(rawUrl: string): Promise<string | null> {
  const hostname = hostnameOf(rawUrl);
  if (!hostname) return null;

  // Cache-Hit?
  const cached = await getCachedFaviconUrl(hostname);
  if (cached) return cached;

  // Fetch von Google-s2 + cachen.
  try {
    const res = await fetch(buildGoogleS2Url(hostname));
    if (!res.ok) return null;
    const blob = await res.blob();
    await setCachedFavicon(hostname, blob);
    return await getCachedFaviconUrl(hostname);
  } catch (err) {
    console.warn('fetchAndCacheFavicon:', err);
    return null;
  }
}

// Cleanup beim App-Shutdown — Object-URLs revocen damit Memory frei
// wird. Caller mountet das einmal im App-Root via window.beforeunload.
export function disposeFaviconCacheUrls(): void {
  for (const url of liveObjectUrls.values()) {
    URL.revokeObjectURL(url);
  }
  liveObjectUrls.clear();
}
