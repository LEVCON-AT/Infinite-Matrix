// Atom-Manifestations-Helper (Phase 4 T.AC.B + Q.1.b refactor).
//
// Polymorpher Layer ueber Migration 044's atom_manifestations-Tabelle.
// Heute: Drag-Drop von Link / Checklist (als Ganzes) in den Calendar
// erzeugt eine atom_manifestation mit atom_type='link' bzw. 'checklist'
// und kind='calendar'. Tasks gehen weiterhin den lib/tasks.ts-Pfad
// ueber task_manifestations — der Sync-Trigger aus 044 spiegelt sie
// in atom_manifestations. Q.2-Konsolidierung dreht das Verhaeltnis um.
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
import { type CacheTable, getById, getByWorkspace, mergeRows } from './offline-cache';
import { markCacheFallback, markLiveSuccess } from './offline-state';
import { runOptimisticDelete, runOptimisticInsert, runOptimisticUpdate } from './safe-mutation';
import { supabase } from './supabase';
import { showToast, showUndoToast } from './toasts';

export type AtomKind = 'task' | 'link' | 'doc' | 'checklist';
export type AtomManifestationKind = 'kanban' | 'checklist' | 'calendar' | 'standalone';

export type AtomManifestationRow = {
  id: string;
  atom_type: AtomKind;
  atom_id: string;
  workspace_id: string;
  kind: AtomManifestationKind;
  container_id: string | null;
  position: number;
  level: number | null;
  display_meta: Record<string, unknown>;
  created_at: string;
};

// Read-Side enriched: traegt Label + URL zusaetzlich, damit der Calendar
// nicht pro Event nochmal joinen muss.
export type EnrichedAtomManifestation = AtomManifestationRow & {
  label: string;
  url?: string | null; // nur fuer atom_type='link'
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
        ? supabase.from('links').select('id, label, url, type').in('id', linkIds)
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
  position?: number;
  level?: number | null;
  displayMeta?: Record<string, unknown>;
};

// Container-/Level-Constraint enforced auch hier (Defense-in-Depth vor
// dem DB-CHECK aus Migration 044): kanban/checklist brauchen
// container_id, calendar/standalone duerfen keinen haben; level ist
// strikt an kind='checklist' gebunden.
function validateAtomManifInput(input: AddAtomManifInput): void {
  if (input.kind === 'kanban' || input.kind === 'checklist') {
    if (!input.containerId) {
      throw new Error(`atom_manifestation kind='${input.kind}' braucht containerId`);
    }
  } else if (input.kind === 'calendar' || input.kind === 'standalone') {
    if (input.containerId) {
      throw new Error(`atom_manifestation kind='${input.kind}' darf keinen containerId haben`);
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
