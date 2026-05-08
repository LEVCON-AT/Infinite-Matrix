// Atom-Manifestations-Helper (Phase 4 T.AC.B + Q.1.b refactor).
//
// Polymorpher Layer ueber Migration 044's atom_manifestations-Tabelle.
// Single-Source seit Q.2 (Migration 049): atom_manifestations haelt
// alle Manifestations aller Atom-Typen (task/link/checklist/doc).
// Tasks-spezifische Reads/Writes laufen ueber lib/tasks.ts — diese
// Datei kuemmert sich um die nicht-task Atoms (Link/Checklist im
// Calendar) plus den polymorphen Drop-Handler.
//
// Read-Pfad: fetchAtomCalendarManifestations laedt nur die NICHT-
// task-Atoms und joint mit links/checklists, damit der Calendar eine
// fertige label kriegt. Tasks bleiben ueber den tasks-Pfad sichtbar.
//
// Write-Pfade laufen alle ueber runOptimistic*-Wrapper aus
// lib/safe-mutation.ts — gleiches Offline-First-Pattern wie
// lib/tasks.ts und lib/objects.ts. atom_manifestations ist ab
// DB_VERSION=7 als IDB-Store registriert.

import { translateDbError } from './errors';
import { isNetworkError } from './mutation-queue';
import { type CacheTable, getById, getByWorkspace, mergeRows, putOne } from './offline-cache';
import { markCacheFallback, markLiveSuccess } from './offline-state';
import { runOptimisticDelete, runOptimisticInsert, runOptimisticUpdate } from './safe-mutation';
import { supabase } from './supabase';
import { showToast, showUndoToast } from './toasts';

// Welle I: 'imported_event' als 5. atom_type. Source-Tabelle external_events.
// WV.B.1: 'info_field' als 6. atom_type. Source-Tabelle info_fields (Migration 072).
export type AtomKind = 'task' | 'link' | 'doc' | 'checklist' | 'imported_event' | 'info_field';
// WV.WV.1: 'pinned' als 5. kind (atom_pins-Konsolidierung, Migration 066).
// WV.B.1: 'info' als 6. kind (Cell-Info-Section-Manifestation, Migration 072).
export type AtomManifestationKind =
  | 'kanban'
  | 'checklist'
  | 'calendar'
  | 'standalone'
  | 'pinned'
  | 'info';

// WV.WV.1: container_kind fuer kind='pinned' diskriminiert das Container-Target.
// 'manifestation' war als parent_kind in atom_pins V2-deferred (Migration 064:62-64
// raised feature_not_supported); im atom_manifestations-Modell faellt es ersatzlos weg.
export type AtomContainerKind = 'cell' | 'atom' | 'node';

export type AtomManifestationRow = {
  id: string;
  atom_type: AtomKind;
  atom_id: string;
  workspace_id: string;
  kind: AtomManifestationKind;
  container_id: string | null;
  // WV.WV.1: 'cell' | 'atom' | 'node' bei kind='pinned'; NULL sonst (kanban/
  // checklist haben Container implizit aus kind ableitbar; calendar/standalone
  // haben keinen Container).
  container_kind: AtomContainerKind | null;
  position: number;
  level: number | null;
  display_meta: Record<string, unknown>;
  created_at: string;
};

// Read-Side enriched: traegt Label + URL zusaetzlich, damit der Calendar
// nicht pro Event nochmal joinen muss.
export type EnrichedAtomManifestation = AtomManifestationRow & {
  label: string;
  url?: string | null; // fuer atom_type='link' bzw. imported_event
  // Welle I: nur fuer imported_event gesetzt — Provider-Kind + Farbe
  // fuer Visual-Discrimination im Calendar-Chip.
  source_provider?: string | null;
  source_color?: string | null;
};

const ATOM_MANIF_TABLE: CacheTable = 'atom_manifestations';

// ─── Read ──────────────────────────────────────────────────────
// Workspace-scoped Liste mit IDB-Cache-Fallback. Wird vom Realtime-
// Subscriber + initial Workspace-Load gerufen.
export async function fetchAtomManifestationsByWorkspace(
  workspaceId: string,
): Promise<AtomManifestationRow[]> {
  if (!workspaceId) return [];
  try {
    const { data, error } = await supabase
      .from('atom_manifestations')
      .select('*')
      .eq('workspace_id', workspaceId);
    if (error) throw error;
    const rows = (data ?? []) as AtomManifestationRow[];
    void mergeRows(ATOM_MANIF_TABLE, rows).catch(() => {});
    markLiveSuccess();
    return rows;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const cached = await getByWorkspace<AtomManifestationRow>(ATOM_MANIF_TABLE, workspaceId);
    markCacheFallback();
    return cached;
  }
}

// Liefert NUR die nicht-task-Atoms (link / checklist / doc) im Workspace
// mit kind='calendar'. Mit Source-Join fuer den Label-Resolve. Bei
// Network-Loss faellt der Read auf den IDB-Cache zurueck und nutzt
// die display_meta-Snapshots als Label/URL — der Calendar bleibt
// renderbar, auch wenn Source-Tabellen nicht erreichbar sind.
export async function fetchAtomCalendarManifestations(
  workspaceId: string,
): Promise<EnrichedAtomManifestation[]> {
  if (!workspaceId) return [];
  // Wir laden in zwei Pass-Schritten: erst die atom_manifestations,
  // dann die Source-Tabellen (links/checklists). Ein einzelner
  // polymorpher JOIN ist in Postgres umstaendlich — zwei kleine Reads
  // sind klarer und nutzen die existierenden Indexes.
  let rows: AtomManifestationRow[];
  let liveRead = true;
  try {
    const { data: manifs, error } = await supabase
      .from('atom_manifestations')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('kind', 'calendar')
      .neq('atom_type', 'task');
    if (error) throw error;
    rows = (manifs ?? []) as AtomManifestationRow[];
    void mergeRows(ATOM_MANIF_TABLE, rows).catch(() => {});
    markLiveSuccess();
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const cached = await getByWorkspace<AtomManifestationRow>(ATOM_MANIF_TABLE, workspaceId);
    rows = cached.filter((r) => r.kind === 'calendar' && r.atom_type !== 'task');
    liveRead = false;
    markCacheFallback();
  }
  if (rows.length === 0) return [];

  // Bei Cache-Fallback ueberspringen wir die Source-Joins (waeren ohnehin
  // ein Network-Call) und nutzen ausschliesslich die display_meta-
  // Snapshots. Die Calendar-UI hat dann ggf. "(Link geloescht)" als
  // Fallback-Label — gleiches Verhalten wie bei tatsaechlich
  // geloeschten Sources.
  const linkById = new Map<string, { label: string; url: string | null }>();
  const checklistById = new Map<string, string>();

  if (liveRead) {
    const linkIds = rows.filter((r) => r.atom_type === 'link').map((r) => r.atom_id);
    const checklistIds = rows.filter((r) => r.atom_type === 'checklist').map((r) => r.atom_id);

    const [linksRes, checklistsRes] = await Promise.all([
      linkIds.length > 0
        ? supabase.from('links').select('id, label, url, provider').in('id', linkIds)
        : Promise.resolve({ data: [], error: null } as const),
      checklistIds.length > 0
        ? supabase.from('checklists').select('id, label').in('id', checklistIds)
        : Promise.resolve({ data: [], error: null } as const),
    ]);
    if (linksRes.error) throw linksRes.error;
    if (checklistsRes.error) throw checklistsRes.error;

    for (const l of linksRes.data ?? []) {
      linkById.set(l.id as string, {
        label: l.label as string,
        url: l.url as string | null,
      });
    }
    for (const c of checklistsRes.data ?? []) {
      checklistById.set(c.id as string, c.label as string);
    }
  }

  return rows.map((r) => {
    // Snapshot-First: wenn display_meta.label gesetzt ist, bevorzugen
    // wir den (InfoLinks haben kein FK-Pendant in den Source-Tabellen,
    // ihre Label leben nur im Snapshot).
    const dm = r.display_meta ?? {};
    const snapLabel = (dm as Record<string, unknown>).label as string | undefined;
    const snapUrl = (dm as Record<string, unknown>).url as string | undefined;
    if (r.atom_type === 'link') {
      const e = linkById.get(r.atom_id);
      return {
        ...r,
        label: snapLabel ?? e?.label ?? '(Link geloescht)',
        url: snapUrl ?? e?.url ?? null,
      };
    }
    if (r.atom_type === 'checklist') {
      return {
        ...r,
        label: snapLabel ?? checklistById.get(r.atom_id) ?? '(Liste geloescht)',
      };
    }
    if (r.atom_type === 'imported_event') {
      // Welle I: imported_event-Mirror-Trigger schreibt label + url +
      // source_provider + source_color in display_meta. Source-Join
      // (external_events) ist nicht noetig — alles ist im Snapshot.
      return {
        ...r,
        label: snapLabel ?? '(Importierter Termin)',
        url: snapUrl ?? null,
        source_provider:
          ((dm as Record<string, unknown>).source_provider as string | undefined) ?? null,
        source_color: ((dm as Record<string, unknown>).source_color as string | undefined) ?? null,
      };
    }
    return { ...r, label: snapLabel ?? '(Atom)' };
  });
}

// ─── Write ─────────────────────────────────────────────────────
type AddAtomManifInput = {
  workspaceId: string;
  atomType: AtomKind;
  atomId: string;
  kind: AtomManifestationKind;
  containerId?: string | null;
  containerKind?: AtomContainerKind | null;
  position?: number;
  level?: number | null;
  displayMeta?: Record<string, unknown>;
};

// Container-/Level-Constraint enforced auch hier (Defense-in-Depth vor
// dem DB-CHECK aus Migration 044 + 066): kanban/checklist brauchen
// container_id (container_kind NULL — implizit aus kind);
// calendar/standalone keinen Container; pinned braucht container_id +
// container_kind ∈ {cell, atom, node}. Level ist strikt an
// kind='checklist' gebunden.
function validateAtomManifInput(input: AddAtomManifInput): void {
  if (input.kind === 'kanban' || input.kind === 'checklist') {
    if (!input.containerId) {
      throw new Error(`atom_manifestation kind='${input.kind}' braucht containerId`);
    }
    if (input.containerKind != null) {
      throw new Error(
        `atom_manifestation kind='${input.kind}' darf kein containerKind haben (implizit aus kind)`,
      );
    }
  } else if (input.kind === 'calendar') {
    // Standalone-Calendar: kein Container. Auto-Mirror aus
    // info_field(value_type='date') (WV.E #37): container_id + cell.
    if (input.containerId && input.containerKind !== 'cell') {
      throw new Error(
        "atom_manifestation kind='calendar' mit containerId braucht containerKind='cell'",
      );
    }
    if (!input.containerId && input.containerKind != null) {
      throw new Error(
        "atom_manifestation kind='calendar' ohne containerId darf kein containerKind haben",
      );
    }
  } else if (input.kind === 'standalone') {
    if (input.containerId) {
      throw new Error("atom_manifestation kind='standalone' darf keinen containerId haben");
    }
    if (input.containerKind != null) {
      throw new Error("atom_manifestation kind='standalone' darf kein containerKind haben");
    }
  } else if (input.kind === 'info') {
    // WV.B.1 + WV.E #37: Cell-Info-Section-Manifestation.
    if (!input.containerId) {
      throw new Error("atom_manifestation kind='info' braucht containerId");
    }
    if (
      input.containerKind !== 'cell' &&
      input.containerKind !== 'atom' &&
      input.containerKind !== 'node'
    ) {
      throw new Error("atom_manifestation kind='info' braucht containerKind ∈ {cell, atom, node}");
    }
  } else if (input.kind === 'pinned') {
    if (!input.containerId) {
      throw new Error("atom_manifestation kind='pinned' braucht containerId");
    }
    if (
      input.containerKind !== 'cell' &&
      input.containerKind !== 'atom' &&
      input.containerKind !== 'node'
    ) {
      throw new Error(
        "atom_manifestation kind='pinned' braucht containerKind ∈ {cell, atom, node}",
      );
    }
  }
  if (input.kind === 'checklist') {
    if (input.level == null || input.level < 0 || input.level > 2) {
      throw new Error("atom_manifestation kind='checklist' braucht level 0..2");
    }
  } else if (input.level != null) {
    throw new Error(`atom_manifestation kind='${input.kind}' darf kein level haben`);
  }
}

export async function addAtomManifestation(
  input: AddAtomManifInput,
): Promise<AtomManifestationRow> {
  validateAtomManifInput(input);
  const containerId = input.containerId ?? null;
  const containerKind = input.containerKind ?? null;
  const level = input.level ?? null;
  const displayMeta = input.displayMeta ?? {};
  const position = input.position ?? 0;

  return runOptimisticInsert<AtomManifestationRow>({
    table: ATOM_MANIF_TABLE,
    workspaceId: input.workspaceId,
    label: 'Atom-Sicht hinzufuegen',
    run: async () => {
      const { data, error } = await supabase
        .from('atom_manifestations')
        .insert({
          atom_type: input.atomType,
          atom_id: input.atomId,
          workspace_id: input.workspaceId,
          kind: input.kind,
          container_id: containerId,
          container_kind: containerKind,
          position,
          level,
          display_meta: displayMeta,
        })
        .select()
        .single();
      if (error) throw error;
      return data as AtomManifestationRow;
    },
    buildOffline: (id) => ({
      id,
      atom_type: input.atomType,
      atom_id: input.atomId,
      workspace_id: input.workspaceId,
      kind: input.kind,
      container_id: containerId,
      container_kind: containerKind,
      position,
      level,
      display_meta: displayMeta,
      created_at: new Date().toISOString(),
    }),
  });
}

export type AtomManifPatch = Partial<{
  display_meta: Record<string, unknown>;
  container_id: string | null;
  container_kind: AtomContainerKind | null;
  position: number;
  level: number | null;
}>;

export async function updateAtomManifestation(
  id: string,
  patch: AtomManifPatch,
): Promise<AtomManifestationRow> {
  return runOptimisticUpdate<AtomManifestationRow>({
    table: ATOM_MANIF_TABLE,
    id,
    patch: patch as Record<string, unknown>,
    label: 'Atom-Sicht aendern',
    run: async () => {
      const { data, error } = await supabase
        .from('atom_manifestations')
        .update(patch)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as AtomManifestationRow;
    },
  });
}

export async function removeAtomManifestation(id: string): Promise<void> {
  // WV.E #37: Auto-Manifestations (display_meta.auto=true) sind System-
  // gepflegt — Manual-Delete waere wirkungslos (Trigger re-creates beim
  // naechsten info_field-Update). Wir blocken den Delete und toasten
  // dem User stattdessen den richtigen Pfad: info_field aendern oder
  // Vorlage-Toggle.
  const cached = await getById<AtomManifestationRow>(ATOM_MANIF_TABLE, id);
  if (cached?.display_meta && (cached.display_meta as Record<string, unknown>).auto === true) {
    showToast(
      'Diese Calendar-Anzeige wird automatisch aus dem Datums-Feld erzeugt. Aendere das Feld direkt oder schalte den Auto-Calendar-Toggle in der Vorlage aus.',
      'info',
    );
    return;
  }

  // workspace_id wird aus dem Cache gezogen (runOptimisticDelete-API);
  // fuer Replay-Korrektheit bei Offline-Delete koennten wir explizit
  // vorher den Row laden, aber der Cache-Lookup deckt das ab.
  await runOptimisticDelete({
    table: ATOM_MANIF_TABLE,
    id,
    label: 'Atom-Sicht entfernen',
    run: async () => {
      const { error } = await supabase.from('atom_manifestations').delete().eq('id', id);
      if (error) throw error;
    },
  });
}

// Synchroner Cache-Lookup fuer Aufrufer, die ohne Network-Roundtrip eine
// vorhandene Manifestation pruefen wollen (z.B. Idempotenz-Check vor
// Insert in dropAtomOnDate). Returnt null wenn der Cache leer ist —
// Caller faellt dann auf den existing-Array-Pfad zurueck.
export async function findCachedAtomManifestation(
  id: string,
): Promise<AtomManifestationRow | null> {
  return await getById<AtomManifestationRow>(ATOM_MANIF_TABLE, id);
}

// ─── Drop-Handler ──────────────────────────────────────────────
// Drop eines Link/Checklist auf einen Calendar-Tag → Idempotent:
// wenn schon eine kind='calendar'-Manifestation existiert, wird
// nur das start_date aktualisiert (Move). Sonst neu angelegt (Add).
type DropAtomOnDateArgs = {
  workspaceId: string;
  atomType: AtomKind;
  atomId: string;
  atomLabel?: string;
  // Snapshot fuer InfoLinks (cell.data.links jsonb, kein FK auf links-
  // Tabelle). Wir schreiben Label + URL ins display_meta, damit das
  // Calendar-Event self-contained bleibt — egal ob die Quelle eine
  // Tabelle oder eine jsonb-Position ist.
  atomUrl?: string;
  newDate: string;
  // Bestand fuer Idempotenz.
  existing: AtomManifestationRow[];
};

export async function dropAtomOnDate(args: DropAtomOnDateArgs): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.newDate)) {
    showToast('Ungueltiges Datum.', 'error');
    return;
  }
  const ex = args.existing.find(
    (m) => m.atom_type === args.atomType && m.atom_id === args.atomId && m.kind === 'calendar',
  );
  if (ex) {
    const oldMeta = ex.display_meta;
    const oldStart = (oldMeta as Record<string, unknown>).start_date as string | undefined;
    if (oldStart === args.newDate) {
      showToast('Schon an diesem Tag.', 'info');
      return;
    }
    try {
      await updateAtomManifestation(ex.id, {
        display_meta: { ...oldMeta, start_date: args.newDate },
      });
      showUndoToast('Termin verschoben', () => {
        void updateAtomManifestation(ex.id, { display_meta: oldMeta }).catch(() => {});
      });
    } catch (err) {
      console.error('dropAtomOnDate (update):', err);
      showToast(translateDbError(err, 'Verschieben fehlgeschlagen.'), 'error');
    }
    return;
  }
  // Snapshot: label + url ins display_meta. So bleibt das Event auch
  // sichtbar, wenn die Source-Tabelle kein passendes Row hat (InfoLinks).
  const meta: Record<string, unknown> = { start_date: args.newDate };
  if (args.atomLabel) meta.label = args.atomLabel;
  if (args.atomUrl) meta.url = args.atomUrl;
  try {
    const created = await addAtomManifestation({
      workspaceId: args.workspaceId,
      atomType: args.atomType,
      atomId: args.atomId,
      kind: 'calendar',
      displayMeta: meta,
    });
    showUndoToast('Im Kalender eingetragen', () => {
      void removeAtomManifestation(created.id).catch(() => {});
    });
  } catch (err) {
    console.error('dropAtomOnDate (add):', err);
    showToast(translateDbError(err, 'Eintragen fehlgeschlagen.'), 'error');
  }
}

// ─── Pinned-Manifestations (WV.WV.1 — atom_pins-Konsolidierung) ──
// Migration 066 hat atom_pins in atom_manifestations(kind='pinned')
// ueberfuehrt. Die RPCs (create_atom_pin / delete_atom_pin /
// move_atom_pin / pin_doc_with_create) bleiben Tool-stable
// (Bridge-Schema unveraendert). Ihr jsonb-Output traegt die alten
// parent_kind/parent_id-Keys; das Frontend mappt sie hier auf
// AtomManifestationRow.container_kind/container_id.

// RPC-Response-Shape (Migration 066:357-365 / :487-495 / :577-585).
type PinnedRpcRow = {
  id: string;
  atom_type: AtomKind;
  atom_id: string;
  workspace_id: string;
  parent_kind: AtomContainerKind;
  parent_id: string;
  position: number;
  created_at: string;
};

function pinnedRpcToManifestation(row: PinnedRpcRow): AtomManifestationRow {
  return {
    id: row.id,
    atom_type: row.atom_type,
    atom_id: row.atom_id,
    workspace_id: row.workspace_id,
    kind: 'pinned',
    container_id: row.parent_id,
    container_kind: row.parent_kind,
    position: row.position,
    level: null,
    display_meta: {},
    created_at: row.created_at,
  };
}

// Filter-Helper auf einer atom_manifestations-Liste (typisch der
// IDB-Cache aus Workspace.tsx). Pendant zu den vormaligen
// filterPinsForParent / filterPinsForAtom aus dem urspruenglichen
// lib/atom-pins.ts (entfaellt mit WV.WV.1).
export function filterPinnedForContainer(
  manifs: AtomManifestationRow[],
  containerKind: AtomContainerKind,
  containerId: string,
): AtomManifestationRow[] {
  return manifs.filter(
    (m) =>
      m.kind === 'pinned' && m.container_kind === containerKind && m.container_id === containerId,
  );
}

export function filterPinnedForAtom(
  manifs: AtomManifestationRow[],
  atomType: AtomKind,
  atomId: string,
): AtomManifestationRow[] {
  return manifs.filter(
    (m) => m.kind === 'pinned' && m.atom_type === atomType && m.atom_id === atomId,
  );
}

// ─── Pin-CRUD ─────────────────────────────────────────────────
// RPC im Live-Pfad (atomare parent-existence + can_write_workspace-
// Checks); direkter atom_manifestations-INSERT im Replay-Pfad (RLS
// uebernimmt die Pruefung). Pattern aus lib/safe-mutation.ts.

export async function createAtomPin(args: {
  workspaceId: string;
  atomType: AtomKind;
  atomId: string;
  containerKind: AtomContainerKind;
  containerId: string;
  position?: number;
}): Promise<AtomManifestationRow> {
  return runOptimisticInsert<AtomManifestationRow>({
    table: ATOM_MANIF_TABLE,
    workspaceId: args.workspaceId,
    label: 'Pin anlegen',
    run: async () => {
      const { data, error } = await supabase.rpc('create_atom_pin', {
        p_workspace_id: args.workspaceId,
        p_atom_type: args.atomType,
        p_atom_id: args.atomId,
        p_parent_kind: args.containerKind,
        p_parent_id: args.containerId,
        p_position: args.position ?? 0,
      });
      if (error) throw error;
      return pinnedRpcToManifestation(data as PinnedRpcRow);
    },
    buildOffline: (id) => ({
      id,
      atom_type: args.atomType,
      atom_id: args.atomId,
      workspace_id: args.workspaceId,
      kind: 'pinned',
      container_id: args.containerId,
      container_kind: args.containerKind,
      position: args.position ?? 0,
      level: null,
      display_meta: {},
      created_at: new Date().toISOString(),
    }),
  });
}

export async function deleteAtomPin(id: string): Promise<void> {
  await runOptimisticDelete({
    table: ATOM_MANIF_TABLE,
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
  newContainerKind: AtomContainerKind;
  newContainerId: string;
  newPosition?: number;
}): Promise<AtomManifestationRow> {
  const patch: AtomManifPatch = {
    container_kind: args.newContainerKind,
    container_id: args.newContainerId,
    position: args.newPosition ?? 0,
  };
  return runOptimisticUpdate<AtomManifestationRow>({
    table: ATOM_MANIF_TABLE,
    id: args.id,
    patch: patch as Record<string, unknown>,
    label: 'Pin verschieben',
    run: async () => {
      const { data, error } = await supabase.rpc('move_atom_pin', {
        p_id: args.id,
        p_new_parent_kind: args.newContainerKind,
        p_new_parent_id: args.newContainerId,
        p_new_position: args.newPosition ?? 0,
      });
      if (error) throw error;
      return pinnedRpcToManifestation(data as PinnedRpcRow);
    },
  });
}

// ─── Compat: single-Cell-Attach (Bridge zu existing DocsPopup-UX) ─
// Existing UX: ein Doc hat hoechstens eine angeheftete Zelle.
// Multi-Pin per Pin-Row kommt spaeter. Bis dahin: alte Cell-Pins
// fuer diesen Doc loeschen, dann optional einen neuen anlegen.
//
// Multi-Step (delete + insert) durch deleteAtomPin + createAtomPin
// (beide bereits offline-tauglich). Der initial select laeuft online —
// bei NetworkError wird auf den IDB-Cache gefiltert.
export async function setDocSingleCellPin(args: {
  workspaceId: string;
  docId: string;
  cellId: string | null;
}): Promise<AtomManifestationRow | null> {
  let existing: Array<{ id: string }> = [];
  try {
    const { data, error } = await supabase
      .from('atom_manifestations')
      .select('id')
      .eq('workspace_id', args.workspaceId)
      .eq('atom_type', 'doc')
      .eq('atom_id', args.docId)
      .eq('kind', 'pinned')
      .eq('container_kind', 'cell');
    if (error) throw error;
    existing = (data ?? []) as Array<{ id: string }>;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const cached = await getByWorkspace<AtomManifestationRow>(ATOM_MANIF_TABLE, args.workspaceId);
    existing = cached
      .filter(
        (m) =>
          m.kind === 'pinned' &&
          m.atom_type === 'doc' &&
          m.atom_id === args.docId &&
          m.container_kind === 'cell',
      )
      .map((m) => ({ id: m.id }));
  }
  for (const row of existing) {
    await deleteAtomPin(row.id);
  }
  if (args.cellId == null) return null;
  return await createAtomPin({
    workspaceId: args.workspaceId,
    atomType: 'doc',
    atomId: args.docId,
    containerKind: 'cell',
    containerId: args.cellId,
  });
}

// ─── Bundled RPC: pin_doc_with_create ──────────────────────────
// Atomic: erstellt Doc-Row + atom_manifestations(kind='pinned')-Eintrag
// in einer Transaktion. Frontend ruft das im DocsPopup-Pending-Tab
// beim ersten Save.
//
// Multi-Step Live-RPC + offline-Fallback ueber zwei Insert-Specs
// (docs + atom_manifestations). Atomicity-Verlust offline akzeptabel —
// der Replay-FIFO behaelt die Reihenfolge, FK-Violation auf
// atom_manifestations (Doc nicht angelegt) ergibt stale-Marker.
//
// Returns das vollstaendige doc-Object plus optional pin (NULL wenn
// kein Parent angegeben — Standalone-Doku).
export async function pinDocWithCreate(args: {
  workspaceId: string;
  title: string;
  content?: string;
  alias?: string | null;
  sourceAlias?: string | null;
  containerKind?: AtomContainerKind | null;
  containerId?: string | null;
}): Promise<{
  doc: Record<string, unknown>;
  pin: AtomManifestationRow | null;
}> {
  try {
    const { data, error } = await supabase.rpc('pin_doc_with_create', {
      p_workspace_id: args.workspaceId,
      p_title: args.title,
      p_content: args.content ?? '<p></p>',
      p_alias: args.alias ?? null,
      p_source_alias: args.sourceAlias ?? null,
      p_parent_kind: args.containerKind ?? null,
      p_parent_id: args.containerId ?? null,
    });
    if (error) throw error;
    const result = data as { doc: Record<string, unknown>; pin: PinnedRpcRow | null };
    const pin = result.pin ? pinnedRpcToManifestation(result.pin) : null;
    if (pin) {
      void putOne(ATOM_MANIF_TABLE, pin).catch(() => {});
    }
    if (result.doc) {
      void putOne('docs', result.doc as { id: string; workspace_id: string }).catch(() => {});
    }
    return { doc: result.doc, pin };
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
    let pin: AtomManifestationRow | null = null;
    if (args.containerKind && args.containerId) {
      pin = await createAtomPin({
        workspaceId: args.workspaceId,
        atomType: 'doc',
        atomId: docId,
        containerKind: args.containerKind,
        containerId: args.containerId,
      });
    }
    return { doc: docRow, pin };
  }
}

// ─── Hilfs-Toast bei Pin-RPC-Errors ───────────────────────────
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

// ─── Generic-Drop-Helper (WV.WV.2 — §9.A.3 Goldlösung) ────────
// Polymorphe Drops fuer alle 5 Atom-Typen (task / link / doc /
// checklist / imported_event) auf jedes Drop-Target. Idempotent:
// existing Manifestation desselben Kinds + Atoms wird verschoben
// (Move) statt dupliziert.
//
// Heutige task-only Pendants in lib/manifestation-cross-view.ts
// (dropOnKanbanCol / dropOnChecklist) bleiben fuer Welle-D-Caller
// (BoardView / ChecklistPanel) erhalten — Card-Polymorphie (WV.WV.6)
// schaltet die Caller spaeter um auf die generischen Helper.

// Polymorphes Pendant zu lib/tasks.ts.nextManifestationPosition.
// Filter ohne atom_type-Constraint, damit Drops aller 5 Atom-Typen
// am Container-Ende einsortiert werden ohne Position-Kollision mit
// existing Task-Manifestations.
export async function nextAtomManifestationPosition(
  containerId: string,
  kind: AtomManifestationKind,
): Promise<number> {
  if (!containerId) return 0;
  try {
    const { data, error } = await supabase
      .from('atom_manifestations')
      .select('position')
      .eq('container_id', containerId)
      .eq('kind', kind)
      .order('position', { ascending: false })
      .limit(1);
    if (error) throw error;
    const top = data && data.length > 0 ? (data[0] as { position: number }).position : -1;
    markLiveSuccess();
    return top + 1;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    // Cache-Fallback: alle Manifestations laden, client-seitig
    // filtern. Workspace-loser Lookup geht weil wir den Index
    // by_workspace nicht brauchen — IDB-Scan ist klein.
    const all = await getByWorkspace<AtomManifestationRow>(ATOM_MANIF_TABLE, '');
    const filtered = all.filter((m) => m.container_id === containerId && m.kind === kind);
    markCacheFallback();
    if (filtered.length === 0) return 0;
    return filtered.reduce((m, r) => Math.max(m, r.position ?? -1), -1) + 1;
  }
}

type DropAtomOnContainerArgs = {
  workspaceId: string;
  atomType: AtomKind;
  atomId: string;
  atomLabel?: string;
  targetContainerId: string;
  targetPosition?: number;
  level?: number; // nur fuer kind='checklist' relevant
  // Bestaende fuer Idempotenz/Move-Detect — Caller filtert pro Atom.
  existingForAtom: AtomManifestationRow[];
};

// Generic Kanban-Col-Drop: prueft ob das Atom schon eine kanban-
// Manifestation hat. Move statt Add wenn ja, sonst Add.
export async function dropAtomOnKanbanCol(args: DropAtomOnContainerArgs): Promise<void> {
  const existingKanban = args.existingForAtom.find((m) => m.kind === 'kanban');
  if (existingKanban && existingKanban.container_id === args.targetContainerId) {
    showToast('Schon in dieser Spalte.', 'info');
    return;
  }
  if (existingKanban) {
    const oldContainer = existingKanban.container_id;
    const oldPosition = existingKanban.position;
    try {
      const pos =
        args.targetPosition ??
        (await nextAtomManifestationPosition(args.targetContainerId, 'kanban'));
      await updateAtomManifestation(existingKanban.id, {
        container_id: args.targetContainerId,
        position: pos,
      });
      showUndoToast('Karte verschoben', () => {
        void updateAtomManifestation(existingKanban.id, {
          container_id: oldContainer,
          position: oldPosition,
        }).catch(() => {});
      });
    } catch (err) {
      console.error('dropAtomOnKanbanCol (move):', err);
      showToast(translateDbError(err, 'Verschieben fehlgeschlagen.'), 'error');
    }
    return;
  }
  try {
    const pos =
      args.targetPosition ??
      (await nextAtomManifestationPosition(args.targetContainerId, 'kanban'));
    const created = await addAtomManifestation({
      workspaceId: args.workspaceId,
      atomType: args.atomType,
      atomId: args.atomId,
      kind: 'kanban',
      containerId: args.targetContainerId,
      position: pos,
    });
    showUndoToast('Als Karte hinzugefuegt', () => {
      void removeAtomManifestation(created.id).catch(() => {});
    });
  } catch (err) {
    console.error('dropAtomOnKanbanCol (add):', err);
    showToast(translateDbError(err, 'Hinzufuegen fehlgeschlagen.'), 'error');
  }
}

// Generic Checklist-Drop: analog Kanban, plus level (default 0).
export async function dropAtomOnChecklist(args: DropAtomOnContainerArgs): Promise<void> {
  const level = args.level ?? 0;
  const existingChecklist = args.existingForAtom.find((m) => m.kind === 'checklist');
  if (existingChecklist && existingChecklist.container_id === args.targetContainerId) {
    showToast('Schon in dieser Checkliste.', 'info');
    return;
  }
  if (existingChecklist) {
    const oldContainer = existingChecklist.container_id;
    const oldPosition = existingChecklist.position;
    try {
      const pos =
        args.targetPosition ??
        (await nextAtomManifestationPosition(args.targetContainerId, 'checklist'));
      await updateAtomManifestation(existingChecklist.id, {
        container_id: args.targetContainerId,
        position: pos,
      });
      showUndoToast('Eintrag verschoben', () => {
        void updateAtomManifestation(existingChecklist.id, {
          container_id: oldContainer,
          position: oldPosition,
        }).catch(() => {});
      });
    } catch (err) {
      console.error('dropAtomOnChecklist (move):', err);
      showToast(translateDbError(err, 'Verschieben fehlgeschlagen.'), 'error');
    }
    return;
  }
  try {
    const pos =
      args.targetPosition ??
      (await nextAtomManifestationPosition(args.targetContainerId, 'checklist'));
    const created = await addAtomManifestation({
      workspaceId: args.workspaceId,
      atomType: args.atomType,
      atomId: args.atomId,
      kind: 'checklist',
      containerId: args.targetContainerId,
      position: pos,
      level,
    });
    showUndoToast('Als Checklisten-Punkt hinzugefuegt', () => {
      void removeAtomManifestation(created.id).catch(() => {});
    });
  } catch (err) {
    console.error('dropAtomOnChecklist (add):', err);
    showToast(translateDbError(err, 'Hinzufuegen fehlgeschlagen.'), 'error');
  }
}

// Generic Pin-Drops auf Cell / Atom / Node — Wrapper um createAtomPin
// (idempotent via DB-UNIQUE-Index, kein Move-vs-Add-Branch noetig).
type DropAtomOnPinArgs = {
  workspaceId: string;
  atomType: AtomKind;
  atomId: string;
  atomLabel?: string;
  targetId: string;
  position?: number;
};

export async function dropAtomOnCell(args: DropAtomOnPinArgs): Promise<void> {
  try {
    const created = await createAtomPin({
      workspaceId: args.workspaceId,
      atomType: args.atomType,
      atomId: args.atomId,
      containerKind: 'cell',
      containerId: args.targetId,
      position: args.position,
    });
    showUndoToast('An Zelle gepinnt', () => {
      void deleteAtomPin(created.id).catch(() => {});
    });
  } catch (err) {
    console.error('dropAtomOnCell:', err);
    reportPinError(err, 'An Zelle pinnen');
  }
}

export async function dropAtomOnAtom(args: DropAtomOnPinArgs): Promise<void> {
  try {
    const created = await createAtomPin({
      workspaceId: args.workspaceId,
      atomType: args.atomType,
      atomId: args.atomId,
      containerKind: 'atom',
      containerId: args.targetId,
      position: args.position,
    });
    showUndoToast('Am Atom gepinnt', () => {
      void deleteAtomPin(created.id).catch(() => {});
    });
  } catch (err) {
    console.error('dropAtomOnAtom:', err);
    reportPinError(err, 'Am Atom pinnen');
  }
}

export async function dropAtomOnNode(args: DropAtomOnPinArgs): Promise<void> {
  try {
    const created = await createAtomPin({
      workspaceId: args.workspaceId,
      atomType: args.atomType,
      atomId: args.atomId,
      containerKind: 'node',
      containerId: args.targetId,
      position: args.position,
    });
    showUndoToast('Am Node gepinnt', () => {
      void deleteAtomPin(created.id).catch(() => {});
    });
  } catch (err) {
    console.error('dropAtomOnNode:', err);
    reportPinError(err, 'Am Node pinnen');
  }
}
