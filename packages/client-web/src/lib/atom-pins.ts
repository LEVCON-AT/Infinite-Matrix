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

import { isNetworkError } from './mutation-queue';
import { type CacheTable, deleteOne, getByWorkspace, mergeRows, putOne } from './offline-cache';
import { markCacheFallback, markLiveSuccess } from './offline-state';
import { runOptimisticDelete } from './safe-mutation';
import { supabase } from './supabase';
import { showToast } from './toasts';
import type { AtomParentKind, AtomPin } from './types';
import type { AtomKind } from './atom-manifestations';

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

export function filterPinsForAtom(
  pins: AtomPin[],
  atomType: AtomKind,
  atomId: string,
): AtomPin[] {
  return pins.filter((p) => p.atom_type === atomType && p.atom_id === atomId);
}

// ─── Write ─────────────────────────────────────────────────────
// create_atom_pin RPC — atomic + parent-existence-checked. Wir nutzen
// die RPC statt direkter atom_pins.insert weil der Server beide
// Parent-Existenz + can_write_workspace synchron pruefen muss.
export async function createAtomPin(args: {
  workspaceId: string;
  atomType: AtomKind;
  atomId: string;
  parentKind: AtomParentKind;
  parentId: string;
  position?: number;
}): Promise<AtomPin> {
  const { data, error } = await supabase.rpc('create_atom_pin', {
    p_workspace_id: args.workspaceId,
    p_atom_type: args.atomType,
    p_atom_id: args.atomId,
    p_parent_kind: args.parentKind,
    p_parent_id: args.parentId,
    p_position: args.position ?? 0,
  });
  if (error) throw error;
  const row = data as AtomPin;
  // IDB-Cache-Update damit Realtime-Echo nicht doppelt rendert.
  void putOne(TABLE, row).catch(() => {});
  return row;
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
  const { data, error } = await supabase.rpc('move_atom_pin', {
    p_id: args.id,
    p_new_parent_kind: args.newParentKind,
    p_new_parent_id: args.newParentId,
    p_new_position: args.newPosition ?? 0,
  });
  if (error) throw error;
  const row = data as AtomPin;
  void putOne(TABLE, row).catch(() => {});
  return row;
}

// ─── Compat: single-Cell-Attach (Bridge zu existing DocsPopup-UX) ─
// Existing UX: ein Doc hat hoechstens eine angeheftete Zelle. Multi-
// Pin kommt in D.6 mit der Pin-Row. Bis dahin: alte Cell-Pins fuer
// diesen Doc loeschen, dann optional einen neuen anlegen.
export async function setDocSingleCellPin(args: {
  workspaceId: string;
  docId: string;
  cellId: string | null;
}): Promise<AtomPin | null> {
  // Existierende Cell-Pins fuer diesen Doc finden + loeschen.
  const { data: existing, error: selErr } = await supabase
    .from('atom_pins')
    .select('id')
    .eq('workspace_id', args.workspaceId)
    .eq('atom_type', 'doc')
    .eq('atom_id', args.docId)
    .eq('parent_kind', 'cell');
  if (selErr) throw selErr;
  for (const row of (existing ?? []) as Array<{ id: string }>) {
    const { error: delErr } = await supabase.rpc('delete_atom_pin', { p_id: row.id });
    if (delErr) throw delErr;
    void deleteOne(TABLE, row.id).catch(() => {});
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
  return result;
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
