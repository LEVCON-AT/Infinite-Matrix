// Welle WV.B Stub §13.3 V2.H — Read-Helper fuer link-Atom-Renderer.
//
// Liest atom_manifestations(kind='pinned', atom_type='link',
// container_kind='cell', container_id=cellId) und joint client-seitig
// mit links (polymorpher Ref, kein PostgREST-Embed — architektur.md
// §1.6). Pattern analog lib/info-field-manifestations.ts.
//
// Konsumenten:
//   - components/CellInfoPage "Atom-Links (Welle B Vorschau)"-Section.

import type { AtomKind, AtomManifestationRow } from './atom-manifestations';
import { isNetworkError } from './mutation-queue';
import { type CacheTable, getByWorkspace } from './offline-cache';
import { markCacheFallback, markLiveSuccess } from './offline-state';
import { supabase } from './supabase';
import type { LinkRow } from './types';

const ATOM_MANIF_TABLE: CacheTable = 'atom_manifestations';
const LINKS_TABLE: CacheTable = 'links';
const LINK_ATOM_TYPE: AtomKind = 'link';

export type LinkManifestation = {
  manifestation: AtomManifestationRow;
  atom: LinkRow;
};

// Liefert alle link-Atom-Manifestations einer Cell (kind='pinned',
// container_kind='cell'), position-sortiert, mit dem zugehoerigen
// links-Atom verknuepft. Read-Pfad mit Cache-Fallback. Manifestations
// ohne korrespondierendes Atom (Realtime-Race, Backfill-Drift) werden
// ausgefiltert — Caller bekommt nur konsistente Paare.
export async function fetchLinkManifestationsForCell(
  workspaceId: string,
  cellId: string,
): Promise<LinkManifestation[]> {
  if (!workspaceId || !cellId) return [];

  let manifs: AtomManifestationRow[] = [];
  let atoms: LinkRow[] = [];

  try {
    const [manifRes, atomRes] = await Promise.all([
      supabase
        .from('atom_manifestations')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('kind', 'pinned')
        .eq('atom_type', LINK_ATOM_TYPE)
        .eq('container_kind', 'cell')
        .eq('container_id', cellId),
      supabase.from('links').select('*').eq('workspace_id', workspaceId),
    ]);
    if (manifRes.error) throw manifRes.error;
    if (atomRes.error) throw atomRes.error;
    manifs = (manifRes.data ?? []) as AtomManifestationRow[];
    atoms = (atomRes.data ?? []) as LinkRow[];
    markLiveSuccess();
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const cachedManifs = await getByWorkspace<AtomManifestationRow>(ATOM_MANIF_TABLE, workspaceId);
    const cachedAtoms = await getByWorkspace<LinkRow>(LINKS_TABLE, workspaceId);
    manifs = cachedManifs.filter(
      (m) =>
        m.kind === 'pinned' &&
        m.atom_type === LINK_ATOM_TYPE &&
        m.container_kind === 'cell' &&
        m.container_id === cellId,
    );
    atoms = cachedAtoms;
    markCacheFallback();
  }

  const atomById = new Map<string, LinkRow>();
  for (const a of atoms) atomById.set(a.id, a);

  const out: LinkManifestation[] = [];
  for (const m of manifs) {
    const atom = atomById.get(m.atom_id);
    if (!atom) continue;
    out.push({ manifestation: m, atom });
  }
  out.sort((a, b) => (a.manifestation.position ?? 0) - (b.manifestation.position ?? 0));
  return out;
}
