// IndexedDB-gestuetzter Offline-Read-Cache (Plan-Phase 0g.2c).
//
// Verantwortung:
//   - Nach jedem erfolgreichen Workspace-Read werden die Rows hier
//     persistiert, damit der Client beim naechsten Start (oder
//     Offline-Case) sofort mit dem letzten bekannten Stand arbeiten
//     kann.
//   - withCache(table, wsId, fetch) ist der Wrapper fuer Query-
//     Funktionen: ruft fetch auf, schreibt bei Erfolg den Cache + gibt
//     das Ergebnis zurueck. Bei Fehler (Netz weg, 5xx) liefert er die
//     zuletzt gespeicherten Rows und markiert den Workspace als
//     "offline-fallback".
//
// Nicht hier:
//   - Write-Queue (die ist 0g.2d, kommt separat).
//   - Fine-grained Updates ueber Realtime (der Realtime-Subscriber
//     ruft weiterhin die Refetch-Pfade auf — die schreiben dann hier
//     in den Cache nach).
//
// Warum idb statt nativer IDB-API:
//   - Promise-basiert, keine `onupgradeneeded`-Callback-Suppe.
//   - Typisiert, +3 kB gz. Ausreichend klein fuer den Wert.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

// DB-Schema: ein Store pro User-Tabelle. Alle Rows tragen workspace_id
// (Supabase-RLS-Konvention) — daher der gemeinsame Index. Key bleibt
// der Row-Primary-Key (uuid-String).
//
// Neue Tabellen spaeter: hier ergaenzen, DB_VERSION hochdrehen, im
// upgrade()-Callback den neuen Store anlegen.
type CacheRow = { id: string; workspace_id: string } & Record<
  string,
  unknown
>;

// Tabellen-Liste als const-Tuple, damit wir sowohl die Typ-Union als
// auch die Runtime-Iteration aus einer Quelle bekommen.
const TABLES = [
  'nodes',
  'cells',
  'rows',
  'cols',
  'kb_cols',
  'kb_cards',
  'checklists',
  'checklist_items',
  'links',
  'docs',
] as const;

export type CacheTable = (typeof TABLES)[number];

type StoreDef = {
  key: string;
  value: CacheRow;
  indexes: { by_workspace: string };
};

interface MatrixCacheSchema extends DBSchema {
  nodes: StoreDef;
  cells: StoreDef;
  rows: StoreDef;
  cols: StoreDef;
  kb_cols: StoreDef;
  kb_cards: StoreDef;
  checklists: StoreDef;
  checklist_items: StoreDef;
  links: StoreDef;
  docs: StoreDef;
}

const DB_NAME = 'matrix-cache';
// V2 ergaenzt den `docs`-Store, der mit Migration 007 ins Schema kam.
// V1-Installs (alle Browser-Tabs vor 0g.2c) haben den Store nie angelegt
// — ohne Version-Bump bekommt das `upgrade()`-Callback nie wieder Aufruf,
// und `putAll('docs', ...)` faellt mit "ObjectStore not found" silent.
// Der idempotente `contains(t)`-Guard im Loop legt nur Fehlendes an.
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<MatrixCacheSchema>> | null = null;

function db(): Promise<IDBPDatabase<MatrixCacheSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<MatrixCacheSchema>(DB_NAME, DB_VERSION, {
      upgrade(inst) {
        for (const t of TABLES) {
          if (!inst.objectStoreNames.contains(t)) {
            const store = inst.createObjectStore(t, { keyPath: 'id' });
            store.createIndex('by_workspace', 'workspace_id');
          }
        }
      },
      blocked() {
        // Anderer Tab haelt eine aeltere Version offen — wir loggen es
        // und machen trotzdem weiter, damit die App nicht haengt.
        console.warn('[offline-cache] upgrade blocked by other tab');
      },
    });
  }
  return dbPromise;
}

// Ersetzt den Workspace-Anteil eines Stores: alle bisherigen Rows
// dieses Workspaces loeschen, dann die neuen in einer Transaktion
// einfuegen. Andere Workspaces bleiben unberuehrt.
export async function putAll<T extends CacheRow>(
  table: CacheTable,
  rows: readonly T[],
  workspaceId: string,
): Promise<void> {
  if (rows.length > 0) {
    // Guard: sichergehen, dass alle Rows dem angegebenen Workspace
    // gehoeren. RLS sollte das gewaehrleisten; hier als Safety-Net
    // gegen falschen Aufruf.
    for (const r of rows) {
      if (r.workspace_id !== workspaceId) {
        throw new Error(
          `[offline-cache] row workspace_id mismatch in ${table}`,
        );
      }
    }
  }
  const inst = await db();
  const tx = inst.transaction(table, 'readwrite');
  const store = tx.store;
  const idx = store.index('by_workspace');
  // Bestehende Keys dieses Workspaces einsammeln + einzeln loeschen.
  // delete()-by-cursor waere idiomatischer, aber das Key-Array ist
  // klein (User-Scope) und spart uns das Cursor-Handling.
  const existing = await idx.getAllKeys(workspaceId);
  for (const k of existing) {
    await store.delete(k);
  }
  for (const r of rows) {
    await store.put(r);
  }
  await tx.done;
}

export async function getByWorkspace<T extends CacheRow = CacheRow>(
  table: CacheTable,
  workspaceId: string,
): Promise<T[]> {
  const inst = await db();
  const rows = await inst.getAllFromIndex(table, 'by_workspace', workspaceId);
  return rows as T[];
}

export async function getById<T extends CacheRow = CacheRow>(
  table: CacheTable,
  id: string,
): Promise<T | null> {
  const inst = await db();
  const row = (await inst.get(table, id)) as T | undefined;
  return row ?? null;
}

// Schreibt eine einzelne Row in den Cache (Insert oder Replace via
// keyPath=id). Verwendet von runOptimisticInsert + Optimistic-Patch
// nach erfolgreichem Replay.
export async function putOne<T extends CacheRow = CacheRow>(
  table: CacheTable,
  row: T,
): Promise<void> {
  const inst = await db();
  await inst.put(table, row);
}

// Merge-Variante zu putAll: schreibt die uebergebenen Rows ohne den
// bestehenden Workspace-Anteil zu loeschen. Brauchen wir fuer board-/
// cell-scoped Reads, die nur einen Teil des Workspaces laden — sonst
// wuerde jeder Board-Refetch die kb_cards anderer Boards aus dem
// Cache werfen.
export async function mergeRows<T extends CacheRow>(
  table: CacheTable,
  rows: readonly T[],
): Promise<void> {
  if (rows.length === 0) return;
  const inst = await db();
  const tx = inst.transaction(table, 'readwrite');
  for (const r of rows) {
    await tx.store.put(r);
  }
  await tx.done;
}

// Loescht eine Row aus dem Cache. Verwendet von runOptimisticDelete.
// No-op wenn die Row nicht existiert.
export async function deleteOne(
  table: CacheTable,
  id: string,
): Promise<void> {
  const inst = await db();
  await inst.delete(table, id);
}

// Patcht eine einzelne Row im Cache. Gemerged wird flach (Object.
// assign-Stil). Liefert die fertige Row zurueck — Aufrufer kann sie
// als Optimistic-Result an die UI durchreichen. Wenn die Row noch
// nicht im Cache ist, passiert nichts (kein Insert ohne workspace_id).
export async function patchRow<T extends CacheRow = CacheRow>(
  table: CacheTable,
  id: string,
  patch: Record<string, unknown>,
): Promise<T | null> {
  const inst = await db();
  const tx = inst.transaction(table, 'readwrite');
  const existing = (await tx.store.get(id)) as T | undefined;
  if (!existing) {
    await tx.done;
    return null;
  }
  const next = { ...existing, ...patch } as T;
  await tx.store.put(next);
  await tx.done;
  return next;
}

export async function clearWorkspace(workspaceId: string): Promise<void> {
  const inst = await db();
  const tx = inst.transaction(TABLES, 'readwrite');
  await Promise.all(
    TABLES.map(async (t) => {
      const store = tx.objectStore(t);
      const idx = store.index('by_workspace');
      const keys = await idx.getAllKeys(workspaceId);
      for (const k of keys) {
        await store.delete(k);
      }
    }),
  );
  await tx.done;
}

export async function clearAll(): Promise<void> {
  const inst = await db();
  const tx = inst.transaction(TABLES, 'readwrite');
  await Promise.all(TABLES.map((t) => tx.objectStore(t).clear()));
  await tx.done;
}

// Wrapper: fetch ausfuehren, bei Erfolg cachen, bei Fehler aus Cache.
// Gibt zusaetzlich zurueck, ob der Fallback gegriffen hat — Aufrufer
// koennen damit den Offline-Indicator triggern.
export type CacheResult<T> = {
  rows: T[];
  fromCache: boolean;
};

export async function withCache<T extends CacheRow>(
  table: CacheTable,
  workspaceId: string,
  fetch: () => Promise<T[]>,
): Promise<CacheResult<T>> {
  try {
    const rows = await fetch();
    // Fire-and-forget: Cache-Write soll die Query nicht blockieren.
    // Fehler im Cache-Write (Quota, InvalidState) loggen wir, aber
    // der Caller bekommt den Live-Load normal zurueck.
    void putAll(table, rows, workspaceId).catch((err) => {
      console.warn(`[offline-cache] putAll(${table}) failed`, err);
    });
    return { rows, fromCache: false };
  } catch (err) {
    // Fallback. Wenn auch der Cache leer ist, reichen wir den
    // Original-Fehler weiter — der Toast-Pfad greift im Caller.
    try {
      const cached = await getByWorkspace<T>(table, workspaceId);
      if (cached.length > 0) {
        return { rows: cached, fromCache: true };
      }
    } catch {
      // Cache kaputt — Original-Fehler gewinnt.
    }
    throw err;
  }
}
