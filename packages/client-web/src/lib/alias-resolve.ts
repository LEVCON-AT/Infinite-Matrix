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

import { supabase } from './supabase';
import { validateAliasFormat } from './alias';

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
  | { kind: 'link'; url: string; label: string };

export type AliasResolveOutcome =
  | { ok: true; result: AliasResolveResult; canonical: string }
  | { ok: false; msg: string };

// Strippt fuehrendes ^, validiert Format, sucht in allen 5 Tabellen
// parallel. Erstes non-null-Ergebnis gewinnt (Cross-Type-Konflikte
// sollten durch die Alias-Validierung beim Schreiben verhindert sein;
// falls doch einer existiert, priorisieren wir nodes > cells > cards >
// checklists > links — erste Quelle die trifft).
export async function resolveAlias(
  raw: string,
  workspaceId: string,
): Promise<AliasResolveOutcome> {
  const stripped = raw.trim().replace(/^\^+/, '');
  const fmt = validateAliasFormat(stripped);
  if (!fmt.ok) return { ok: false, msg: fmt.msg };
  if (!fmt.canonical) return { ok: false, msg: 'Alias ist leer.' };
  const a = fmt.canonical;

  const [nodes, cells, cards, checklists, links] = await Promise.all([
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
      .from('kb_cards')
      .select('id, board_id, name')
      .eq('workspace_id', workspaceId)
      .ilike('alias', a)
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
  ]);

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
      result: { kind: 'link', url: l.url, label: l.label },
    };
  }

  return { ok: false, msg: `Alias "^${a}" nicht gefunden.` };
}
