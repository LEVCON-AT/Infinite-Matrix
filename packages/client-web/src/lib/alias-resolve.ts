// Alias-Quicknav-Resolver.
//
// Das Alt-Client-Vorbild haelt einen in-memory aliasIndex und kann
// ^kuerzel in O(1) aufloesen. Wir haben keinen in-memory Index; statt-
// dessen parallele ilike-Queries ueber die 5 Alias-Tabellen — guenstig
// genug (Alias wird nur bei expliziter Quicknav-Aktion geprueft).
//
// Rueckgabe: ein diskriminierendes Objekt, das der Caller per switch
// auf die passende Navigation abbildet. Nur Infos, die fuer das Ziel
// tatsaechlich noetig sind (Node-ID, Matrix-ID fuer Cell, Board-ID
// fuer Card, URL fuer Link).

import { isPlatformAdminCached } from './admin';
import { validateAliasFormat } from './alias';
import { supabase } from './supabase';

export type AliasResolveResult =
  | { kind: 'node'; nodeId: string; nodeType: 'matrix' | 'board'; label: string }
  | {
      kind: 'cell';
      cellId: string;
      matrixId: string;
      rowId: string;
      colId: string;
      features: string[];
      childMatrixId: string | null;
      boardId: string | null;
    }
  | { kind: 'card'; cardId: string; boardId: string; name: string }
  | { kind: 'checklist-board'; checklistId: string; boardId: string; label: string }
  | { kind: 'checklist-cell'; checklistId: string; cellId: string; matrixId: string; label: string }
  | { kind: 'link'; linkId: string; url: string; label: string }
  | { kind: 'doc'; docId: string; title: string }
  // Welle B B.0.B: reservierte Aliase werden vor der Format-Validation
  // abgefangen (siehe RESERVED_ROUTES). path ist ein absoluter Workspace-
  // unabhaengiger Pfad (z.B. '/admin'), label ist UI-Hinweis.
  | { kind: 'route'; path: string; label: string };

// Reservierte Route-Aliase. Werden in resolveAlias VOR validateAliasFormat
// abgefangen — RESERVED_ALIASES in lib/alias.ts blockiert dasselbe wort
// als User-Alias-Wert, damit kein Konflikt entsteht.
const RESERVED_ROUTES: Record<string, { path: string; label: string }> = {
  admin: { path: '/admin', label: 'Admin-Dashboard' },
};

export type AliasResolveOutcome =
  | { ok: true; result: AliasResolveResult; canonical: string }
  | { ok: false; msg: string };

// Strippt fuehrendes ^, validiert Format, sucht in allen 5 Tabellen
// parallel. Erstes non-null-Ergebnis gewinnt (Cross-Type-Konflikte
// sollten durch die Alias-Validierung beim Schreiben verhindert sein;
// falls doch einer existiert, priorisieren wir nodes > cells > cards >
// checklists > links — erste Quelle die trifft).
export async function resolveAlias(raw: string, workspaceId: string): Promise<AliasResolveOutcome> {
  const stripped = raw.trim().replace(/^\^+/, '');

  // Welle B B.0.B: reservierte Routen-Aliase short-circuit. validateAliasFormat
  // wuerde sie sonst als RESERVED_ALIASES ablehnen — wir prufen ZUERST.
  //
  // Welle B B.0.G: ^admin existiert nur fuer tatsaechliche Plattform-
  // Admins. Fuer Non-Admins sofort "Nicht gefunden" — kein RESERVED_-
  // ALIASES-Branch (wuerde "ist reserviert" sagen + die Existenz leaken).
  const lowered = stripped.toLowerCase();
  const reservedRoute = RESERVED_ROUTES[lowered];
  if (reservedRoute) {
    if (lowered === 'admin' && !isPlatformAdminCached()) {
      return { ok: false, msg: `Alias "^${stripped}" nicht gefunden.` };
    }
    return {
      ok: true,
      result: { kind: 'route', path: reservedRoute.path, label: reservedRoute.label },
      canonical: lowered,
    };
  }

  const fmt = validateAliasFormat(stripped);
  if (!fmt.ok) return { ok: false, msg: fmt.msg };
  if (!fmt.canonical) return { ok: false, msg: 'Alias ist leer.' };
  const a = fmt.canonical;
  // Wildcard-Hinweis: `a` ist garantiert ALIAS_RE-konform (^[a-z0-9]+$),
  // weil validateAliasFormat strikt durchfiltert. Damit sind die
  // ilike()-Queries unten ohne escape sicher — '%' und '_' koennen
  // nicht reinrutschen. Wenn jemand spaeter den Eingangs-Path lockert,
  // muss hier ein Wildcard-Escape rein.

  // Phase 4 T.1.D: Karten-Aliases leben in tasks.attrs.alias. Wir
  // suchen ueber attrs->>alias und holen anschliessend (lazy) die
  // Kanban-Manifestation fuer board_id, falls die Karte existiert.
  const [nodes, cells, cardTasks, checklists, links, docs] = await Promise.all([
    supabase
      .from('nodes')
      .select('id, type, label')
      .eq('workspace_id', workspaceId)
      .ilike('alias', a)
      .limit(1),
    supabase
      .from('cells')
      .select('id, matrix_id, row_id, col_id, features, child_matrix_id, board_id')
      .eq('workspace_id', workspaceId)
      .ilike('alias', a)
      .limit(1),
    supabase
      .from('tasks')
      .select('id, label, attrs')
      .eq('workspace_id', workspaceId)
      .ilike('attrs->>alias', a)
      .limit(1),
    supabase
      .from('checklists')
      .select('id, board_id, cell_id, label')
      .eq('workspace_id', workspaceId)
      .ilike('alias', a)
      .limit(1),
    supabase
      .from('links')
      .select('id, url, label')
      .eq('workspace_id', workspaceId)
      .ilike('alias', a)
      .limit(1),
    supabase
      .from('docs')
      .select('id, title')
      .eq('workspace_id', workspaceId)
      .ilike('alias', a)
      .limit(1),
  ]);

  // cardTasks → Kanban-Manifestation Lookup (board_id liegt in display_meta).
  let cards: { data: Array<{ id: string; board_id: string; name: string }> | null } = {
    data: null,
  };
  if (cardTasks.data && cardTasks.data.length > 0) {
    const t = cardTasks.data[0] as { id: string; label: string; attrs: Record<string, unknown> };
    const manif = await supabase
      .from('atom_manifestations')
      .select('display_meta')
      .eq('atom_type', 'task')
      .eq('atom_id', t.id)
      .eq('kind', 'kanban')
      .maybeSingle();
    const boardId = (
      (manif.data as { display_meta: Record<string, unknown> | null } | null)
        ?.display_meta as Record<string, unknown> | null
    )?.board_id as string | undefined;
    if (boardId) {
      cards = { data: [{ id: t.id, board_id: boardId, name: t.label }] };
    }
  }

  if (nodes.data && nodes.data.length > 0) {
    const n = nodes.data[0] as { id: string; type: 'matrix' | 'board'; label: string };
    return {
      ok: true,
      canonical: a,
      result: { kind: 'node', nodeId: n.id, nodeType: n.type, label: n.label },
    };
  }

  if (cells.data && cells.data.length > 0) {
    const c = cells.data[0] as {
      id: string;
      matrix_id: string;
      row_id: string;
      col_id: string;
      features: string[] | null;
      child_matrix_id: string | null;
      board_id: string | null;
    };
    return {
      ok: true,
      canonical: a,
      result: {
        kind: 'cell',
        cellId: c.id,
        matrixId: c.matrix_id,
        rowId: c.row_id,
        colId: c.col_id,
        features: Array.isArray(c.features) ? c.features : [],
        childMatrixId: c.child_matrix_id,
        boardId: c.board_id,
      },
    };
  }

  if (cards.data && cards.data.length > 0) {
    const c = cards.data[0] as { id: string; board_id: string; name: string };
    return {
      ok: true,
      canonical: a,
      result: { kind: 'card', cardId: c.id, boardId: c.board_id, name: c.name },
    };
  }

  if (checklists.data && checklists.data.length > 0) {
    const cl = checklists.data[0] as {
      id: string;
      board_id: string | null;
      cell_id: string | null;
      label: string;
    };
    if (cl.board_id) {
      return {
        ok: true,
        canonical: a,
        result: {
          kind: 'checklist-board',
          checklistId: cl.id,
          boardId: cl.board_id,
          label: cl.label,
        },
      };
    }
    if (cl.cell_id) {
      // Zell-Checkliste: brauchen die parent-matrix der Zelle fuer die Route.
      const cellRes = await supabase
        .from('cells')
        .select('matrix_id')
        .eq('id', cl.cell_id)
        .eq('workspace_id', workspaceId)
        .limit(1);
      const mid = cellRes.data?.[0]?.matrix_id as string | undefined;
      if (!mid) {
        return { ok: false, msg: 'Checkliste ohne auffindbare Parent-Zelle.' };
      }
      return {
        ok: true,
        canonical: a,
        result: {
          kind: 'checklist-cell',
          checklistId: cl.id,
          cellId: cl.cell_id,
          matrixId: mid,
          label: cl.label,
        },
      };
    }
    return { ok: false, msg: 'Checkliste ohne Parent (broken).' };
  }

  if (links.data && links.data.length > 0) {
    const l = links.data[0] as { id: string; url: string; label: string };
    return {
      ok: true,
      canonical: a,
      result: { kind: 'link', linkId: l.id, url: l.url, label: l.label },
    };
  }

  if (docs.data && docs.data.length > 0) {
    const d = docs.data[0] as { id: string; title: string };
    return {
      ok: true,
      canonical: a,
      result: { kind: 'doc', docId: d.id, title: d.title },
    };
  }

  return { ok: false, msg: `Alias "^${a}" nicht gefunden.` };
}
