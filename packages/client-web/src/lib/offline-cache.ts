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

import { type DBSchema, type IDBPDatabase, openDB } from 'idb';

// DB-Schema: ein Store pro User-Tabelle. Alle Rows tragen workspace_id
// (Supabase-RLS-Konvention) — daher der gemeinsame Index. Key bleibt
// der Row-Primary-Key (uuid-String).
//
// Neue Tabellen spaeter: hier ergaenzen, DB_VERSION hochdrehen, im
// upgrade()-Callback den neuen Store anlegen.
type CacheRow = { id: string; workspace_id: string } & Record<string, unknown>;

// Tabellen-Liste als const-Tuple, damit wir sowohl die Typ-Union als
// auch die Runtime-Iteration aus einer Quelle bekommen.
//
// T.1.J (DB_VERSION=6): kb_cards + checklist_items entfernt — Daten
// leben nur noch in tasks + task_manifestations. Der upgrade()-Callback
// loescht die alten Stores aus IDB-Installations < V6.
//
// Q.1.a (DB_VERSION=7): atom_manifestations ergaenzt — Single-Source
// fuer alle polymorphen Manifestations.
//
// Q.2 (DB_VERSION=8): task_manifestations entfernt — Daten leben jetzt
// in atom_manifestations mit atom_type='task'. Der upgrade()-Callback
// loescht den obsoleten Store.
//
// Welle I (DB_VERSION=9): external_calendars + external_events fuer
// Calendar-Inbound. external_events ist die Source-Tabelle fuer
// atom_type='imported_event' (Migration 059).
const TABLES = [
  'nodes',
  'cells',
  'rows',
  'cols',
  'kb_cols',
  'checklists',
  'links',
  'docs',
  'invites',
  // AU-B1 K11c.1 (B1-B-010 / B1-H-006 / CC7): Object-Layer-Stores. Damit
  // resolverMaps in Workspace.tsx auch offline funktioniert (vorher:
  // {row.object}/{column.object}-Templates rendered als "(ohne Label)").
  'objects',
  'object_tags',
  'groups',
  'group_members',
  // T.1.C — Task-Layer Cache. tasks (Layer 0) leben hier weiter; ihre
  // Manifestations ziehen via atom_manifestations (Q.2).
  'tasks',
  // T.AC.A + Q.2 — polymorphe Manifestations (Layer 1). Single-Source
  // fuer alle Atom-Typen (task/link/checklist/doc/imported_event).
  'atom_manifestations',
  // Welle I — Calendar-Inbound. external_calendars sind user-scoped
  // (workspace_id ist denormalisiert), external_events sind die
  // Source-Tabelle fuer atom_type='imported_event'.
  'external_calendars',
  'external_events',
  // Welle N — In-App-Notifications. Self-only RLS, workspace_id-Index.
  'notifications',
  // Welle D — Tag-System. workspace_tags ist die Tag-Registry;
  // atom_tags die Junction. (atom_pins seit WV.WV.1 in
  // atom_manifestations(kind='pinned') konsolidiert — Migration 066.)
  'workspace_tags',
  'atom_tags',
  // Welle WV.A.1 — Vorlagen-Foundation (Migration 067). Alle drei
  // Tabellen sind workspace-scope (Plattform-Vorlagen denormalisiert
  // mit workspace_id NULL — werden im Cache pro Workspace nicht
  // mit gespiegelt, sondern via separater Lade-Funktion).
  'feature_templates',
  'template_sections',
  'template_widgets',
  // Welle WV.A.2 — Cell ↔ Vorlage-Junction + Sparse-Overrides
  // (Migration 068).
  'cell_template_instances',
  'cell_widget_overrides',
  // Welle WV.A.3 — Hotkey-Slot-Belegung pro Workspace + User-Override
  // (Migration 069).
  'workspace_hotkey_slots',
  'user_hotkey_slots',
  // Welle WV.A.4 — wiederverwendbare Filter-Definitionen pro
  // atom_kind (Migration 070, body folgt lib/atom-filter-attrs.ts).
  'saved_filters',
  // Welle WV.B.1 — typed Cell-Info-Felder (Migration 072).
  'info_fields',
  // Welle WV.B.3 — User-Markierungen an Atomen (Migration 074).
  'atom_markers',
  // Welle WV.D.1 — Widget zu externem Provider-Ref (Migration 077).
  // user_oauth_tokens cachen wir NICHT (sensible Daten, sollen nicht
  // in IDB liegen).
  'widget_external_channels',
  // T.3 — Task-Dependencies (Migration 089, ECS Layer 2).
  'task_dependencies',
  // Welle E.1 — Wiki/Doku-Seiten (Migration 090). Plattform-Pages
  // werden mit workspace_id='' im Cache abgelegt (Sonderwert).
  'wiki_pages',
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
  checklists: StoreDef;
  links: StoreDef;
  docs: StoreDef;
  invites: StoreDef;
  objects: StoreDef;
  object_tags: StoreDef;
  groups: StoreDef;
  group_members: StoreDef;
  tasks: StoreDef;
  atom_manifestations: StoreDef;
  external_calendars: StoreDef;
  external_events: StoreDef;
  notifications: StoreDef;
  workspace_tags: StoreDef;
  atom_tags: StoreDef;
  feature_templates: StoreDef;
  template_sections: StoreDef;
  template_widgets: StoreDef;
  cell_template_instances: StoreDef;
  cell_widget_overrides: StoreDef;
  workspace_hotkey_slots: StoreDef;
  user_hotkey_slots: StoreDef;
  saved_filters: StoreDef;
  info_fields: StoreDef;
  atom_markers: StoreDef;
  widget_external_channels: StoreDef;
  task_dependencies: StoreDef;
  wiki_pages: StoreDef;
}

const DB_NAME = 'matrix-cache';
// V2: docs-Store. V3: invites-Store. V4 (AU-B1 K11c.1): objects-Layer
// (objects, object_tags, groups, group_members). V5 (T.1.C): task-Layer
// (tasks, task_manifestations). V6 (T.1.J): kb_cards + checklist_items
// Stores entfernt — Daten leben nur noch in tasks + task_manifestations.
// V7 (Q.1.a): atom_manifestations als Polymorph-Store ergaenzt.
// V8 (Q.2): task_manifestations entfernt — atom_manifestations ist
// Single-Source. Der `contains(t)`-Guard im Loop laesst alte Installs
// die fehlenden Stores idempotent nachzufuegt bekommen; der zweite
// Block loescht die obsoleten Stores.
// V9 (Welle I): external_calendars + external_events Stores fuer
// Calendar-Inbound (Migration 059). Polymorphe Atom-Quelle
// 'imported_event' wird ebenfalls in atom_manifestations gemirrored.
// V10 (Welle N): notifications-Store fuer In-App-Benachrichtigungen.
// V11 (Welle D): atom_pins + workspace_tags + atom_tags fuer Atom-Pin-
// Relation + globales Tag-System. docs.attached_cell_id wurde dabei
// gedroppt (Migration 063), aber der `docs`-Store traegt das eh nicht
// strukturell — die Spalte verschwindet einfach aus den Row-Keys.
// V12 (WV.WV.1): atom_pins-Konsolidierung in atom_manifestations
// (Migration 066). atom_pins-Store wird obsolet — atom_manifestations
// haelt jetzt auch kind='pinned'-Rows mit container_kind ∈ {cell, atom,
// node}. workspace_tags + atom_tags bleiben unveraendert.
// V13 (WV.A.1): feature_templates + template_sections + template_widgets
// Stores fuer die Vorlagen-Foundation (Migration 067). Plattform-
// Vorlagen werden separat geladen — die Stores spiegeln pro Workspace
// die sichtbaren Templates (Workspace-shared + User-privat).
// V14 (WV.A.2): cell_template_instances + cell_widget_overrides
// (Migration 068) — Junction Cell ↔ Vorlage + sparse User-Overrides.
// V15 (WV.A.3): workspace_hotkey_slots + user_hotkey_slots
// (Migration 069) — Slot-Belegung 1-9 pro Workspace + User-Override.
// V16 (WV.A.4): saved_filters (Migration 070) — wiederverwendbare
// Filter-Definitionen pro atom_kind, body folgt SavedFilterBody-
// Format aus lib/atom-filter-attrs.ts (WV.Y).
// V17 (WV.B.1+B.3): info_fields + atom_markers (Migrations 072 + 074)
// — typed Cell-Info-Felder + User-Markierungen.
// V18 (WV.D.1): widget_external_channels (Migration 077) — Widget zu
// externem Provider-Ref. user_oauth_tokens bleibt OUT-OF-CACHE (sensibel).
// V19 (T.3): task_dependencies (Migration 089) — Vorgaenger-Beziehung
// Blocker → Blocked zwischen Tasks im gleichen Workspace.
// V20 (E.1): wiki_pages (Migration 090) — hierarchische Doku-Seiten,
// Plattform + Workspace-scoped.
const DB_VERSION = 20;
const OBSOLETE_STORES = [
  'kb_cards',
  'checklist_items',
  'task_manifestations',
  'atom_pins',
] as const;

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
        // T.1.J: V<6-Installs hatten kb_cards + checklist_items als
        // eigene Stores. Nach dem Schema-Sweep sind sie obsolet —
        // explizit deleteObjectStore, sonst bleiben sie als toter
        // Ballast in der IDB-Datei und der naechste Schema-Drift
        // koennte sie versehentlich wieder ansprechen. Cast ueber
        // DOMStringList weil das Schema-Type die Store-Namen nicht
        // mehr kennt.
        const stores = inst.objectStoreNames as unknown as DOMStringList;
        for (const obsolete of OBSOLETE_STORES) {
          if (stores.contains(obsolete)) {
            (inst as unknown as { deleteObjectStore(name: string): void }).deleteObjectStore(
              obsolete,
            );
          }
        }
      },
      blocked() {
        // Anderer Tab haelt eine aeltere Version offen — wir loggen es
        // und machen trotzdem weiter, damit die App nicht haengt.
        console.warn('[offline-cache] upgrade blocked by other tab');
        // AU-B1 K11d (B1-H-016): User-sichtbare Meldung — sonst sieht
        // der User nur einen weissen "Lade..."-Screen ohne Erklaerung.
        // import dynamisch um Module-Cycle zu vermeiden (toasts → ?).
        void import('./toasts')
          .then(({ showToast }) =>
            showToast(
              'Bitte andere Matrix-Tabs schliessen oder neu laden, damit der Cache aktualisiert werden kann.',
              'error',
            ),
          )
          .catch(() => {
            /* import failed — bleibt bei console.warn */
          });
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
        throw new Error(`[offline-cache] row workspace_id mismatch in ${table}`);
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
export async function deleteOne(table: CacheTable, id: string): Promise<void> {
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
