// Offline-Mutation-Queue (Plan-Phase 0g.2d).
//
// Verantwortung:
//   - Wenn eine Mutation wegen fehlender Netzwerkverbindung scheitert,
//     wird der Aufruf hier serialisiert + persistiert, damit er beim
//     naechsten Online-Moment automatisch nachgezogen wird.
//   - Bei Reconnect (oder manuellem "Sync"-Trigger) iteriert
//     replayQueue() durch alle pending Specs in created-Reihenfolge.
//   - Konflikte (Server hat veraltete Row, neuer Stand reicht) ergeben
//     einen Stale-Marker — der User bekommt einen Toast ("veraltet,
//     bitte neu laden"), der Eintrag bleibt zur Inspektion in der
//     Queue, kann aber per Hand verworfen werden.
//
// Nicht-Ziele V1:
//   - Optimistic-UI: lokal werden die Cache-Rows NICHT gepatcht. User
//     sieht Offline-Mutationen erst nach erfolgreichem Replay. Das ist
//     der UX-Trade-off von Phase 0g.2d.
//   - CRDT-Konfliktloesung: wir bleiben bei Last-Writer-Wins. Konflikte
//     fallen auf den User zurueck (per Stale-Toast).
//   - Multi-Step-Mutations (komplexe Transform-Operationen): sind nicht
//     queueable und schlagen weiterhin direkt fehl.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { createSignal } from 'solid-js';
import { supabase } from './supabase';

// MutationSpec: portabler Beschrieb einer Postgrest-Mutation. Wir
// halten die Shape so flach wie moeglich, damit serialize/deserialize
// trivial ist (JSON-stringify + back). Multi-Step-Operationen passen
// bewusst NICHT in dieses Format.
export type MutationSpec =
  | {
      kind: 'insert';
      table: string;
      values: Record<string, unknown> | Record<string, unknown>[];
    }
  | {
      kind: 'update';
      table: string;
      values: Record<string, unknown>;
      // Match-Bedingung als Equality-Map. .eq() pro Key.
      match: Record<string, string | number | boolean | null>;
    }
  | {
      kind: 'delete';
      table: string;
      match: Record<string, string | number | boolean | null>;
    }
  | {
      kind: 'upsert';
      table: string;
      values: Record<string, unknown> | Record<string, unknown>[];
      onConflict?: string;
    };

export type QueueEntryStatus = 'pending' | 'stale' | 'failed';

export type QueueEntry = {
  id: string;
  workspace_id: string;
  created_at: number;
  spec: MutationSpec;
  attempts: number;
  status: QueueEntryStatus;
  last_error: string | null;
  // Optionales User-Label fuer die UI ("Karte 'Foo' erledigen").
  label?: string;
};

interface QueueDbSchema extends DBSchema {
  mutation_queue: {
    key: string;
    value: QueueEntry;
    indexes: { by_workspace: string };
  };
}

const DB_NAME = 'matrix-mutation-queue';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<QueueDbSchema>> | null = null;

function db(): Promise<IDBPDatabase<QueueDbSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<QueueDbSchema>(DB_NAME, DB_VERSION, {
      upgrade(inst) {
        if (!inst.objectStoreNames.contains('mutation_queue')) {
          const store = inst.createObjectStore('mutation_queue', {
            keyPath: 'id',
          });
          store.createIndex('by_workspace', 'workspace_id');
        }
      },
    });
  }
  return dbPromise;
}

function newId(): string {
  return crypto.randomUUID();
}

// ─── Pending-Count-Signal ──────────────────────────────────────
// UI bindet sich an dieses Signal fuer das Badge "N Aenderungen
// pending". Wir aktualisieren es bei enqueue, remove, replay und
// initial nach openDb.
const [pendingCount, setPendingCount] = createSignal(0);

export function pendingMutationCount() {
  return pendingCount();
}

async function refreshPendingCount(workspaceId: string): Promise<void> {
  const inst = await db();
  const all = await inst.getAllFromIndex(
    'mutation_queue',
    'by_workspace',
    workspaceId,
  );
  const pending = all.filter((e) => e.status === 'pending').length;
  setPendingCount(pending);
}

// ─── API ───────────────────────────────────────────────────────

export async function enqueueMutation(args: {
  spec: MutationSpec;
  workspaceId: string;
  label?: string;
}): Promise<QueueEntry> {
  const entry: QueueEntry = {
    id: newId(),
    workspace_id: args.workspaceId,
    created_at: Date.now(),
    spec: args.spec,
    attempts: 0,
    status: 'pending',
    last_error: null,
    label: args.label,
  };
  const inst = await db();
  await inst.put('mutation_queue', entry);
  await refreshPendingCount(args.workspaceId);
  return entry;
}

export async function listForWorkspace(
  workspaceId: string,
): Promise<QueueEntry[]> {
  const inst = await db();
  const all = await inst.getAllFromIndex(
    'mutation_queue',
    'by_workspace',
    workspaceId,
  );
  return all.sort((a, b) => a.created_at - b.created_at);
}

export async function removeEntry(id: string, workspaceId: string): Promise<void> {
  const inst = await db();
  await inst.delete('mutation_queue', id);
  await refreshPendingCount(workspaceId);
}

export async function clearWorkspaceQueue(workspaceId: string): Promise<void> {
  const inst = await db();
  const all = await inst.getAllFromIndex(
    'mutation_queue',
    'by_workspace',
    workspaceId,
  );
  const tx = inst.transaction('mutation_queue', 'readwrite');
  for (const e of all) {
    await tx.store.delete(e.id);
  }
  await tx.done;
  await refreshPendingCount(workspaceId);
}

export async function refreshCountForWorkspace(
  workspaceId: string,
): Promise<void> {
  await refreshPendingCount(workspaceId);
}

// ─── Replay ────────────────────────────────────────────────────

// Lock gegen Doppel-Replay (online-Event + manueller Klick gleich-
// zeitig). Wenn replay laeuft, ignorieren wir weitere Aufrufe.
let replayInFlight = false;

export type ReplayResult = {
  succeeded: number;
  staled: number;
  failed: number;
  skippedBusy: boolean;
};

export async function replayQueue(workspaceId: string): Promise<ReplayResult> {
  if (replayInFlight) {
    return { succeeded: 0, staled: 0, failed: 0, skippedBusy: true };
  }
  replayInFlight = true;
  try {
    const inst = await db();
    const all = await inst.getAllFromIndex(
      'mutation_queue',
      'by_workspace',
      workspaceId,
    );
    const pending = all
      .filter((e) => e.status === 'pending')
      .sort((a, b) => a.created_at - b.created_at);
    let succeeded = 0;
    let staled = 0;
    let failed = 0;
    for (const entry of pending) {
      const result = await runSpec(entry.spec);
      if (result.ok) {
        await inst.delete('mutation_queue', entry.id);
        succeeded += 1;
      } else if (result.kind === 'stale') {
        // Postgrest hat 0 Zeilen geupdatet — Row weg oder seit Queue
        // veraendert. Markieren, nicht entfernen — User entscheidet.
        const next: QueueEntry = {
          ...entry,
          status: 'stale',
          last_error: result.error,
        };
        await inst.put('mutation_queue', next);
        staled += 1;
      } else if (result.kind === 'network') {
        // Netz nochmal weg. Nicht hochzaehlen — wir versuchen's beim
        // naechsten online-Event erneut. Replay-Loop abbrechen.
        break;
      } else {
        const next: QueueEntry = {
          ...entry,
          status: 'failed',
          attempts: entry.attempts + 1,
          last_error: result.error,
        };
        await inst.put('mutation_queue', next);
        failed += 1;
      }
    }
    await refreshPendingCount(workspaceId);
    return { succeeded, staled, failed, skippedBusy: false };
  } finally {
    replayInFlight = false;
  }
}

// ─── Spec-Runner ───────────────────────────────────────────────
// Mappt eine Spec auf einen Supabase-Call. Rueckgabe-Diskriminator:
//   ok=true  -> Replay durch
//   ok=false, kind='stale'    -> Row nicht gefunden (PGRST116) oder Update-Count=0
//   ok=false, kind='network'  -> Verbindungsfehler, retry spaeter
//   ok=false, kind='other'    -> echter Server-Fehler, attempts++

type RunResult =
  | { ok: true }
  | { ok: false; kind: 'stale' | 'network' | 'other'; error: string };

async function runSpec(spec: MutationSpec): Promise<RunResult> {
  try {
    if (spec.kind === 'insert') {
      const { error } = await supabase.from(spec.table).insert(spec.values);
      if (error) return classifyError(error);
      return { ok: true };
    }
    if (spec.kind === 'upsert') {
      const opts = spec.onConflict ? { onConflict: spec.onConflict } : undefined;
      const { error } = await supabase.from(spec.table).upsert(spec.values, opts);
      if (error) return classifyError(error);
      return { ok: true };
    }
    if (spec.kind === 'update') {
      // count: 'exact' im Update-Builder selbst — .select(opts) als
      // zweiter Schritt erlaubt das in supabase-js@2.45 nicht mehr.
      let q = supabase.from(spec.table).update(spec.values, { count: 'exact' });
      for (const [k, v] of Object.entries(spec.match)) {
        q = q.eq(k, v as never);
      }
      const { error, count } = await q;
      if (error) return classifyError(error);
      if ((count ?? 0) === 0) {
        return {
          ok: false,
          kind: 'stale',
          error: 'Keine passende Zeile mehr — der Eintrag wurde inzwischen entfernt oder geaendert.',
        };
      }
      return { ok: true };
    }
    if (spec.kind === 'delete') {
      let q = supabase.from(spec.table).delete();
      for (const [k, v] of Object.entries(spec.match)) {
        q = q.eq(k, v as never);
      }
      const { error } = await q;
      if (error) return classifyError(error);
      return { ok: true };
    }
    return { ok: false, kind: 'other', error: 'Unbekannter Spec-Typ.' };
  } catch (err) {
    return classifyError(err);
  }
}

function classifyError(err: unknown): RunResult {
  const msg = err instanceof Error ? err.message : String(err);
  // TypeError "Failed to fetch" / "NetworkError" ist Browser-Standard
  // bei abgerissenem Netz.
  if (
    err instanceof TypeError ||
    /failed to fetch|networkerror|network error|load failed/i.test(msg)
  ) {
    return { ok: false, kind: 'network', error: msg };
  }
  // Postgrest-Code PGRST116: Row nicht gefunden bei .single()-Style.
  // Bei plain update kommt eher nichts - wir nutzen count.
  if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'PGRST116'
  ) {
    return { ok: false, kind: 'stale', error: msg };
  }
  return { ok: false, kind: 'other', error: msg };
}

// Helper fuer den safe-mutation-Wrapper: ohne diese Klassifikation
// muesste der Wrapper die Logic duplizieren.
export function isNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    err instanceof TypeError ||
    /failed to fetch|networkerror|network error|load failed/i.test(msg)
  );
}
