// Welle D — Atom-Pin Helper.
//
// atom_pins ist die generische "Atom A ist an Parent P gepinnt"-Relation.
// Loest docs.attached_cell_id ab und erweitert auf alle Atom-Typen +
// Parent-Kinds (cell/atom/node; manifestation V2-deferred).
//
// Read-Pfad: fetchAtomPinsByWorkspace + getByWorkspace-IDB-Fallback.
// Write-Pfad: runOptimistic*-Wrapper. RPCs aus Migration 064 fuer
// atomare INSERTs (create_atom_pin, pin_doc_with_create) damit Server-
// side parent-existence + RLS-Check sauber laufen.

import type { AtomKind } from './atom-manifestations';
import { isNetworkError } from './mutation-queue';
import { type CacheTable, getByWorkspace, mergeRows, putOne } from './offline-cache';
import { markCacheFallback, markLiveSuccess } from './offline-state';
import { runOptimisticDelete, runOptimisticInsert, runOptimisticUpdate } from './safe-mutation';
import { supabase } from './supabase';
import { showToast } from './toasts';
import type { AtomParentKind, AtomPin } from './types';

const TABLE: CacheTable = 'atom_pins';

// ─── Read ──────────────────────────────────────────────────────
export async function fetchAtomPinsByWorkspace(workspaceId: string): Promise<AtomPin[]> {
  if (!workspaceId) return [];
  try {
    const { data, error } = await supabase
      .from('atom_pins')
      .select('*')
      .eq('workspace_id', workspaceId);
    if (error) throw error;
    const rows = (data ?? []) as AtomPin[];
    void mergeRows(TABLE, rows).catch(() => {});
    markLiveSuccess();
    return rows;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const cached = await getByWorkspace<AtomPin>(TABLE, workspaceId);
    markCacheFallback();
    return cached;
  }
}

// Filter-Helper auf der Cache-Liste — der Workspace laedt eh alle
// atom_pins, gefiltert wird im Memory-Set damit der Realtime-Subscriber
// weniger Round-Trips macht.
export function filterPinsForParent(
  pins: AtomPin[],
  parentKind: AtomParentKind,
  parentId: string,
): AtomPin[] {
  return pins.filter((p) => p.parent_kind === parentKind && p.parent_id === parentId);
}

export function filterPinsForAtom(pins: AtomPin[], atomType: AtomKind, atomId: string): AtomPin[] {
  return pins.filter((p) => p.atom_type === atomType && p.atom_id === atomId);
}

// ─── Write ─────────────────────────────────────────────────────
// Welle D.X.O: RPCs werden durch safe-mutation gewrappt — RPC im Live-
// Pfad (atomare parent-existence + can_write_workspace-Checks),
// direkter atom_pins-INSERT im Replay-Pfad (RLS uebernimmt die Pruefung,
// FK-Violation bei nicht-existentem parent ergibt stale-Marker).
export async function createAtomPin(args: {
  workspaceId: string;
  atomType: AtomKind;
  atomId: string;
  parentKind: AtomParentKind;
  parentId: string;
  position?: number;
}): Promise<AtomPin> {
  return runOptimisticInsert<AtomPin>({
    table: TABLE,
    workspaceId: args.workspaceId,
    label: 'Pin anlegen',
    run: async () => {
      const { data, error } = await supabase.rpc('create_atom_pin', {
        p_workspace_id: args.workspaceId,
        p_atom_type: args.atomType,
        p_atom_id: args.atomId,
        p_parent_kind: args.parentKind,
        p_parent_id: args.parentId,
        p_position: args.position ?? 0,
      });
      if (error) throw error;
      return data as AtomPin;
    },
    buildOffline: (id) => ({
      id,
      workspace_id: args.workspaceId,
      atom_type: args.atomType,
      atom_id: args.atomId,
      parent_kind: args.parentKind,
      parent_id: args.parentId,
      position: args.position ?? 0,
      created_at: new Date().toISOString(),
    }),
  });
}

export async function deleteAtomPin(id: string): Promise<void> {
  await runOptimisticDelete({
    table: TABLE,
    id,
    label: 'Pin entfernen',
    run: async () => {
      const { error } = await supabase.rpc('delete_atom_pin', { p_id: id });
      if (error) throw error;
    },
  });
}

export async function moveAtomPin(args: {
  id: string;
  newParentKind: AtomParentKind;
  newParentId: string;
  newPosition?: number;
}): Promise<AtomPin> {
  const patch = {
    parent_kind: args.newParentKind,
    parent_id: args.newParentId,
    position: args.newPosition ?? 0,
  };
  return runOptimisticUpdate<AtomPin>({
    table: TABLE,
    id: args.id,
    patch,
    label: 'Pin verschieben',
    run: async () => {
      const { data, error } = await supabase.rpc('move_atom_pin', {
        p_id: args.id,
        p_new_parent_kind: args.newParentKind,
        p_new_parent_id: args.newParentId,
        p_new_position: args.newPosition ?? 0,
      });
      if (error) throw error;
      return data as AtomPin;
    },
  });
}

// ─── Compat: single-Cell-Attach (Bridge zu existing DocsPopup-UX) ─
// Existing UX: ein Doc hat hoechstens eine angeheftete Zelle. Multi-
// Pin kommt in D.6 mit der Pin-Row. Bis dahin: alte Cell-Pins fuer
// diesen Doc loeschen, dann optional einen neuen anlegen.
//
// Welle D.X.O: Multi-Step (delete + insert) durch deleteAtomPin +
// createAtomPin (beide bereits offline-tauglich). Der initial select
// laeuft online — bei NetworkError wird auf den IDB-Cache gefiltert.
export async function setDocSingleCellPin(args: {
  workspaceId: string;
  docId: string;
  cellId: string | null;
}): Promise<AtomPin | null> {
  // Existierende Cell-Pins fuer diesen Doc finden — bevorzugt online,
  // bei Network-Loss aus dem IDB-Cache.
  let existing: Array<{ id: string }> = [];
  try {
    const { data, error } = await supabase
      .from('atom_pins')
      .select('id')
      .eq('workspace_id', args.workspaceId)
      .eq('atom_type', 'doc')
      .eq('atom_id', args.docId)
      .eq('parent_kind', 'cell');
    if (error) throw error;
    existing = (data ?? []) as Array<{ id: string }>;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const cachedPins = await getByWorkspace<AtomPin>(TABLE, args.workspaceId);
    existing = cachedPins
      .filter((p) => p.atom_type === 'doc' && p.atom_id === args.docId && p.parent_kind === 'cell')
      .map((p) => ({ id: p.id }));
  }
  // Existing-Pins via wrapper loeschen (offline-tauglich).
  for (const row of existing) {
    await deleteAtomPin(row.id);
  }
  if (args.cellId == null) return null;
  return await createAtomPin({
    workspaceId: args.workspaceId,
    atomType: 'doc',
    atomId: args.docId,
    parentKind: 'cell',
    parentId: args.cellId,
  });
}

// ─── Bundled RPC: pin_doc_with_create ──────────────────────────
// Atomic: erstellt Doc-Row + atom_pins-Eintrag in einer Transaktion.
// Frontend ruft das im DocsPopup-Pending-Tab beim ersten Save.
//
// Welle D.X.O: Multi-Step Live-RPC + offline-Fallback ueber zwei
// Insert-Specs (docs + atom_pins). Atomicity-Verlust offline akzeptabel
// — der Replay-FIFO behaelt die Reihenfolge, FK-Violation auf atom_pins
// (Doc nicht angelegt) ergibt stale-Marker.
//
// Returns das vollstaendige doc-Object plus optional pin (NULL wenn
// kein Parent angegeben — Standalone-Doku).
export async function pinDocWithCreate(args: {
  workspaceId: string;
  title: string;
  content?: string;
  alias?: string | null;
  sourceAlias?: string | null;
  parentKind?: AtomParentKind | null;
  parentId?: string | null;
}): Promise<{
  doc: Record<string, unknown>;
  pin: AtomPin | null;
}> {
  try {
    const { data, error } = await supabase.rpc('pin_doc_with_create', {
      p_workspace_id: args.workspaceId,
      p_title: args.title,
      p_content: args.content ?? '<p></p>',
      p_alias: args.alias ?? null,
      p_source_alias: args.sourceAlias ?? null,
      p_parent_kind: args.parentKind ?? null,
      p_parent_id: args.parentId ?? null,
    });
    if (error) throw error;
    const result = data as { doc: Record<string, unknown>; pin: AtomPin | null };
    if (result.pin) {
      void putOne(TABLE, result.pin).catch(() => {});
    }
    if (result.doc) {
      void putOne('docs', result.doc as { id: string; workspace_id: string }).catch(() => {});
    }
    return result;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    // Offline-Fallback: synth Doc + synth Pin separat queueen. Replay-
    // FIFO garantiert Doc-vor-Pin-Reihenfolge.
    const docId = crypto.randomUUID();
    const now = new Date().toISOString();
    const docRow = {
      id: docId,
      workspace_id: args.workspaceId,
      title: args.title,
      title_template: args.title,
      content: args.content ?? '<p></p>',
      alias: args.alias ?? null,
      source_alias: args.sourceAlias ?? null,
      created_at: now,
      updated_at: now,
    } as Record<string, unknown>;
    await putOne('docs', docRow as { id: string; workspace_id: string });
    const { enqueueMutation } = await import('./mutation-queue');
    await enqueueMutation({
      spec: { kind: 'insert', table: 'docs', values: docRow },
      workspaceId: args.workspaceId,
      label: 'Doku anlegen',
    });
    showToast('Offline angelegt: Doku. Wird beim Reconnect synchronisiert.', 'info');
    let pin: AtomPin | null = null;
    if (args.parentKind && args.parentId) {
      pin = await createAtomPin({
        workspaceId: args.workspaceId,
        atomType: 'doc',
        atomId: docId,
        parentKind: args.parentKind,
        parentId: args.parentId,
      });
    }
    return { doc: docRow, pin };
  }
}

// ─── Hilfs-Toast bei RPC-Errors ────────────────────────────────
export function reportPinError(err: unknown, contextLabel: string): void {
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = String((err as { message: unknown }).message);
    if (msg.includes('parent_not_found')) {
      showToast('Doku konnte nicht angeheftet werden — Ziel existiert nicht.', 'error');
      return;
    }
    if (msg.includes('forbidden')) {
      showToast('Du hast keine Schreib-Rechte fuer diesen Workspace.', 'error');
      return;
    }
  }
  showToast(`${contextLabel} fehlgeschlagen.`, 'error');
}
