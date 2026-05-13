// Welle WV.B.3 — Atom-Marker Mutations + Reads.
//
// CRUD fuer atom_markers (Migration 074). Polymorphe User-Markierungen.
// Zwei Kinds:
//   - star: Workspace-shared (alle Member sehen + Counter)
//   - eye:  User-privat (nur Owner sieht — RLS filtert auf user_id=auth.uid())
//
// Toggle-Pattern: setMarker / unsetMarker statt INSERT/UPDATE/DELETE,
// damit die UI als one-click-Action funktioniert.

import { isNetworkError } from './mutation-queue';
import { type CacheTable, getByWorkspace, mergeRows } from './offline-cache';
import { markCacheFallback, markLiveSuccess } from './offline-state';
import { runOptimisticDelete, runOptimisticInsert } from './safe-mutation';
import { supabase } from './supabase';
import type { AtomMarkerKind, AtomMarkerRow } from './types';

const ATOM_MARKERS_TABLE: CacheTable = 'atom_markers';

// ─── Reads ─────────────────────────────────────────────────────

// Holt alle fuer den User sichtbaren Marker im Workspace.
// RLS filtert: alle stars + eigene eye-Marker.
export async function fetchAtomMarkersForWorkspace(workspaceId: string): Promise<AtomMarkerRow[]> {
  if (!workspaceId) return [];
  try {
    const { data, error } = await supabase
      .from('atom_markers')
      .select('*')
      .eq('workspace_id', workspaceId);
    if (error) throw error;
    const rows = (data ?? []) as AtomMarkerRow[];
    void mergeRows(ATOM_MARKERS_TABLE, rows).catch(() => {});
    markLiveSuccess();
    return rows;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const cached = await getByWorkspace<AtomMarkerRow>(ATOM_MARKERS_TABLE, workspaceId);
    markCacheFallback();
    return cached;
  }
}

// ─── Mutations ─────────────────────────────────────────────────

export type SetMarkerInput = {
  workspaceId: string;
  userId: string;
  kind: AtomMarkerKind;
  atomType: AtomMarkerRow['atom_type'];
  atomId: string;
};

// Idempotent: existing Markierung wird per UNIQUE-Constraint
// abgewiesen — wir fangen den Konflikt-Fehler ab und liefern die
// existing Row zurueck.
export async function setAtomMarker(input: SetMarkerInput): Promise<AtomMarkerRow> {
  return runOptimisticInsert<AtomMarkerRow>({
    table: ATOM_MARKERS_TABLE,
    workspaceId: input.workspaceId,
    label: input.kind === 'star' ? 'Star setzen' : 'Beobachten',
    run: async () => {
      const { data, error } = await supabase
        .from('atom_markers')
        .upsert(
          {
            workspace_id: input.workspaceId,
            user_id: input.userId,
            kind: input.kind,
            atom_type: input.atomType,
            atom_id: input.atomId,
          },
          { onConflict: 'user_id,atom_type,atom_id,kind' },
        )
        .select()
        .single();
      if (error) throw error;
      return data as AtomMarkerRow;
    },
    buildOffline: (id) => ({
      id,
      workspace_id: input.workspaceId,
      user_id: input.userId,
      kind: input.kind,
      atom_type: input.atomType,
      atom_id: input.atomId,
      created_at: new Date().toISOString(),
    }),
  });
}

export async function unsetAtomMarker(id: string): Promise<void> {
  await runOptimisticDelete({
    table: ATOM_MARKERS_TABLE,
    id,
    label: 'Markierung entfernen',
    run: async () => {
      const { error } = await supabase.from('atom_markers').delete().eq('id', id);
      if (error) throw error;
    },
  });
}

// ─── Aggregator-Helper ────────────────────────────────────────
// Counter pro Atom (kind=star), plus Self-Marker-Detection.

export function starCountForAtom(
  rows: ReadonlyArray<AtomMarkerRow>,
  atomType: AtomMarkerRow['atom_type'],
  atomId: string,
): number {
  return rows.filter((r) => r.kind === 'star' && r.atom_type === atomType && r.atom_id === atomId)
    .length;
}

// §13.3 V2-Polish (2026-05-13) — Star-Marker pro Atom, sortiert nach
// created_at ASC fuer die Hover-Tooltip-Liste „Wer hat gestartet?".
// Caller filtert auf workspace_members fuer Display-Info.
export function starMarkersForAtom(
  rows: ReadonlyArray<AtomMarkerRow>,
  atomType: AtomMarkerRow['atom_type'],
  atomId: string,
): AtomMarkerRow[] {
  return rows
    .filter((r) => r.kind === 'star' && r.atom_type === atomType && r.atom_id === atomId)
    .slice()
    .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''));
}

export function selfStarMarker(
  rows: ReadonlyArray<AtomMarkerRow>,
  userId: string,
  atomType: AtomMarkerRow['atom_type'],
  atomId: string,
): AtomMarkerRow | undefined {
  return rows.find(
    (r) =>
      r.kind === 'star' && r.user_id === userId && r.atom_type === atomType && r.atom_id === atomId,
  );
}

export function selfEyeMarker(
  rows: ReadonlyArray<AtomMarkerRow>,
  userId: string,
  atomType: AtomMarkerRow['atom_type'],
  atomId: string,
): AtomMarkerRow | undefined {
  return rows.find(
    (r) =>
      r.kind === 'eye' && r.user_id === userId && r.atom_type === atomType && r.atom_id === atomId,
  );
}
