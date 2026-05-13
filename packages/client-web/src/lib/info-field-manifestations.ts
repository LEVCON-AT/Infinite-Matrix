// Welle WV.B Stub — Read-Helper fuer info_field-Atom-Renderer.
//
// Liest atom_manifestations(kind='info', container_kind='cell',
// atom_type='info_field', container_id=cellId) und joint client-
// seitig mit info_fields (polymorpher Ref, kein PostgREST-Embed —
// atom_manifestations.atom_id hat keinen FK; architektur.md §1.6).
//
// Konsumenten:
//   - components/CellInfoPage "Atom-Felder (Welle B Vorschau)"-Section.
//   - kuenftige Form-Widget-Renderer im Vorlagen-Modell (Welle WV.A.6).

import type { AtomKind, AtomManifestationRow } from './atom-manifestations';
import { isNetworkError } from './mutation-queue';
import { type CacheTable, getByWorkspace } from './offline-cache';
import { markCacheFallback, markLiveSuccess } from './offline-state';
import { supabase } from './supabase';
import type { InfoFieldRow } from './types';

const ATOM_MANIF_TABLE: CacheTable = 'atom_manifestations';
const INFO_FIELDS_TABLE: CacheTable = 'info_fields';
const INFO_FIELD_ATOM_TYPE: AtomKind = 'info_field';

export type InfoFieldManifestation = {
  manifestation: AtomManifestationRow;
  atom: InfoFieldRow;
};

// Liefert alle info_field-Atom-Manifestations einer Cell, position-
// sortiert, mit dem zugehoerigen info_fields-Atom verknuepft. Read-
// Pfad mit Cache-Fallback. Manifestations ohne korrespondierendes Atom
// (Realtime-Race, Backfill-Drift) werden ausgefiltert — Caller bekommt
// nur konsistente Paare.
export async function fetchInfoManifestationsForCell(
  workspaceId: string,
  cellId: string,
): Promise<InfoFieldManifestation[]> {
  if (!workspaceId || !cellId) return [];

  let manifs: AtomManifestationRow[] = [];
  let atoms: InfoFieldRow[] = [];

  try {
    const [manifRes, atomRes] = await Promise.all([
      supabase
        .from('atom_manifestations')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('kind', 'info')
        .eq('atom_type', INFO_FIELD_ATOM_TYPE)
        .eq('container_kind', 'cell')
        .eq('container_id', cellId),
      supabase.from('info_fields').select('*').eq('workspace_id', workspaceId),
    ]);
    if (manifRes.error) throw manifRes.error;
    if (atomRes.error) throw atomRes.error;
    manifs = (manifRes.data ?? []) as AtomManifestationRow[];
    atoms = (atomRes.data ?? []) as InfoFieldRow[];
    markLiveSuccess();
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const cachedManifs = await getByWorkspace<AtomManifestationRow>(ATOM_MANIF_TABLE, workspaceId);
    const cachedAtoms = await getByWorkspace<InfoFieldRow>(INFO_FIELDS_TABLE, workspaceId);
    manifs = cachedManifs.filter(
      (m) =>
        m.kind === 'info' &&
        m.atom_type === INFO_FIELD_ATOM_TYPE &&
        m.container_kind === 'cell' &&
        m.container_id === cellId,
    );
    atoms = cachedAtoms;
    markCacheFallback();
  }

  const atomById = new Map<string, InfoFieldRow>();
  for (const a of atoms) atomById.set(a.id, a);

  const out: InfoFieldManifestation[] = [];
  for (const m of manifs) {
    const atom = atomById.get(m.atom_id);
    if (!atom) continue;
    out.push({ manifestation: m, atom });
  }
  out.sort((a, b) => (a.manifestation.position ?? 0) - (b.manifestation.position ?? 0));
  return out;
}
