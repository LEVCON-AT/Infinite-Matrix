// Atom-Manifestations-Helper (Phase 4 T.AC.B).
//
// Polymorpher Layer ueber Migration 044's atom_manifestations-Tabelle.
// Heute: Drag-Drop von Link / Checklist (als Ganzes) in den Calendar
// erzeugt eine atom_manifestation mit atom_type='link' bzw. 'checklist'
// und kind='calendar'. Tasks gehen weiterhin den lib/tasks.ts-Pfad
// ueber task_manifestations — der Sync-Trigger aus 044 spiegelt sie
// in atom_manifestations.
//
// Read-Pfad: fetchAtomManifestationsForCalendar laedt nur die NICHT-
// task-Atoms und joint mit links/checklists, damit der Calendar eine
// fertige label kriegt. Tasks bleiben ueber den tasks-Pfad sichtbar.
//
// Spaeter (T.AC.A.2/A.3): saemtliche Manifestations laufen ueber
// atom_manifestations — dieses Modul wird dann zur Quelle der Wahrheit
// und task_manifestations wird zum View-Shim.

import { translateDbError } from './errors';
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

// ─── Read ──────────────────────────────────────────────────────
// Liefert NUR die nicht-task-Atoms (link / checklist / doc) im Workspace
// mit kind='calendar'. Mit Source-Join fuer den Label-Resolve.
export async function fetchAtomCalendarManifestations(
  workspaceId: string,
): Promise<EnrichedAtomManifestation[]> {
  // Wir laden in zwei Pass-Schritten: erst die atom_manifestations,
  // dann die Source-Tabellen (links/checklists). Ein einzelner
  // polymorpher JOIN ist in Postgres umstaendlich — zwei kleine Reads
  // sind klarer und nutzen die existierenden Indexes.
  const { data: manifs, error } = await supabase
    .from('atom_manifestations')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('kind', 'calendar')
    .neq('atom_type', 'task');
  if (error) throw error;
  const rows = (manifs ?? []) as AtomManifestationRow[];
  if (rows.length === 0) return [];

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

  const linkById = new Map(
    (linksRes.data ?? []).map((l) => [
      l.id as string,
      { label: l.label as string, url: l.url as string | null },
    ]),
  );
  const checklistById = new Map(
    (checklistsRes.data ?? []).map((c) => [c.id as string, c.label as string]),
  );

  return rows.map((r) => {
    if (r.atom_type === 'link') {
      const e = linkById.get(r.atom_id);
      return {
        ...r,
        label: e?.label ?? '(Link geloescht)',
        url: e?.url ?? null,
      };
    }
    if (r.atom_type === 'checklist') {
      return {
        ...r,
        label: checklistById.get(r.atom_id) ?? '(Liste geloescht)',
      };
    }
    return { ...r, label: '(Atom)' };
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

export async function addAtomManifestation(
  input: AddAtomManifInput,
): Promise<AtomManifestationRow> {
  const { data, error } = await supabase
    .from('atom_manifestations')
    .insert({
      atom_type: input.atomType,
      atom_id: input.atomId,
      workspace_id: input.workspaceId,
      kind: input.kind,
      container_id: input.containerId ?? null,
      position: input.position ?? Date.now(),
      level: input.level ?? null,
      display_meta: input.displayMeta ?? {},
    })
    .select()
    .single();
  if (error) throw error;
  return data as AtomManifestationRow;
}

export async function removeAtomManifestation(id: string): Promise<void> {
  const { error } = await supabase.from('atom_manifestations').delete().eq('id', id);
  if (error) throw error;
}

export async function updateAtomManifestation(
  id: string,
  patch: Partial<{
    display_meta: Record<string, unknown>;
    container_id: string | null;
    position: number;
  }>,
): Promise<AtomManifestationRow> {
  const { data, error } = await supabase
    .from('atom_manifestations')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as AtomManifestationRow;
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
  try {
    const created = await addAtomManifestation({
      workspaceId: args.workspaceId,
      atomType: args.atomType,
      atomId: args.atomId,
      kind: 'calendar',
      displayMeta: { start_date: args.newDate },
    });
    showUndoToast('Im Kalender eingetragen', () => {
      void removeAtomManifestation(created.id).catch(() => {});
    });
  } catch (err) {
    console.error('dropAtomOnDate (add):', err);
    showToast(translateDbError(err, 'Eintragen fehlgeschlagen.'), 'error');
  }
}
