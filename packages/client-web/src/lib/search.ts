// Global-Search ueber den kompletten Workspace — Nodes, Cells, Karten,
// Checklisten. Parallele ilike-Queries, begrenzt pro Typ. Kein Volltext-
// Index: wir zaehlen auf ilike + RLS workspace_id-Filter. Reicht fuer
// kleine bis mittlere Workspaces (<< 10k Entities). Scalierung via
// tsvector + GIN spaeter, wenn ein User mehr braucht.
//
// Rueckgabe: flache Result-Liste mit diskriminiertem Typ — der Caller
// kann danach sortieren/gruppieren/rendern wie er mag. Navigation-Info
// (nodeId/matrixId/boardId/rowId/colId) steckt im Result, damit
// Dispatch ohne weiteren Round-Trip laeuft.
//
// Mindestlaenge 2 — sonst wuerden single-char-Queries ganze Workspaces
// ilike'n und das PostgREST-Result aufblaehen.

import { supabase } from './supabase';

export type SearchResult =
  | {
      kind: 'node';
      nodeId: string;
      nodeType: 'matrix' | 'board';
      title: string;
      alias: string | null;
    }
  | {
      kind: 'cell';
      cellId: string;
      matrixId: string;
      rowId: string;
      colId: string;
      title: string;
      alias: string | null;
      features: string[];
      childMatrixId: string | null;
      boardId: string | null;
    }
  | {
      kind: 'card';
      cardId: string;
      boardId: string;
      title: string;
      alias: string | null;
      note: string;
      tags: string[];
    }
  | {
      kind: 'checklist-board';
      checklistId: string;
      boardId: string;
      title: string;
      alias: string | null;
    }
  | {
      kind: 'checklist-cell';
      checklistId: string;
      cellId: string;
      matrixId: string;
      title: string;
      alias: string | null;
    };

// Escaped den User-Input fuer ilike: % und _ sind Wildcards in SQL,
// die der User in der Suche nicht als Wildcards meinen koennte.
// Backslash-Escape fuer beide.
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, '\\$&');
}

// PostgREST .or() trennt Filter per Komma — ein Komma im Pattern
// wuerde das zerschneiden. Fix: Pattern in doppelte Anfuehrungszeichen
// einpacken und vorhandene " escapen. PostgREST unquotes das dann
// vor dem SQL-Dispatch.
function quoteForOr(pattern: string): string {
  return `"${pattern.replace(/"/g, '\\"')}"`;
}

// Kleines Helper: schneidet Text auf max N Zeichen, haengt ... an.
// Nur fuer Excerpt-Display, kein Business-Logik.
export function clip(s: string, max = 120): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}

export async function searchWorkspace(
  rawQuery: string,
  workspaceId: string,
  perTypeLimit = 20,
): Promise<SearchResult[]> {
  const q = rawQuery.trim();
  if (q.length < 2) return [];
  const pat = `%${escapeLike(q)}%`;
  const qpat = quoteForOr(pat);

  const [nodesRes, cellsRes, cardsRes, checklistsRes] = await Promise.all([
    supabase
      .from('nodes')
      .select('id, type, label, alias')
      .eq('workspace_id', workspaceId)
      .or(`label.ilike.${qpat},alias.ilike.${qpat}`)
      .limit(perTypeLimit),
    supabase
      .from('cells')
      .select('id, matrix_id, row_id, col_id, alias, features, child_matrix_id, board_id')
      .eq('workspace_id', workspaceId)
      .ilike('alias', pat)
      .limit(perTypeLimit),
    supabase
      .from('kb_cards')
      .select('id, board_id, name, alias, note, tags')
      .eq('workspace_id', workspaceId)
      .or(`name.ilike.${qpat},alias.ilike.${qpat},note.ilike.${qpat}`)
      .limit(perTypeLimit),
    supabase
      .from('checklists')
      .select('id, board_id, cell_id, label, alias')
      .eq('workspace_id', workspaceId)
      .or(`label.ilike.${qpat},alias.ilike.${qpat}`)
      .limit(perTypeLimit),
  ]);

  const results: SearchResult[] = [];

  if (nodesRes.data) {
    for (const n of nodesRes.data as Array<{
      id: string;
      type: 'matrix' | 'board';
      label: string;
      alias: string | null;
    }>) {
      results.push({
        kind: 'node',
        nodeId: n.id,
        nodeType: n.type,
        title: n.label || '(ohne Label)',
        alias: n.alias,
      });
    }
  }

  if (cellsRes.data) {
    for (const c of cellsRes.data as Array<{
      id: string;
      matrix_id: string;
      row_id: string;
      col_id: string;
      alias: string | null;
      features: string[] | null;
      child_matrix_id: string | null;
      board_id: string | null;
    }>) {
      results.push({
        kind: 'cell',
        cellId: c.id,
        matrixId: c.matrix_id,
        rowId: c.row_id,
        colId: c.col_id,
        title: c.alias ? `^${c.alias}` : '(Zelle)',
        alias: c.alias,
        features: Array.isArray(c.features) ? c.features : [],
        childMatrixId: c.child_matrix_id,
        boardId: c.board_id,
      });
    }
  }

  if (cardsRes.data) {
    for (const c of cardsRes.data as Array<{
      id: string;
      board_id: string;
      name: string;
      alias: string | null;
      note: string | null;
      tags: string[] | null;
    }>) {
      results.push({
        kind: 'card',
        cardId: c.id,
        boardId: c.board_id,
        title: c.name || '(ohne Name)',
        alias: c.alias,
        note: typeof c.note === 'string' ? c.note : '',
        tags: Array.isArray(c.tags) ? c.tags : [],
      });
    }
  }

  // Cell-Checklists brauchen die matrix_id der Parent-Zelle fuer die
  // Navigation. Statt pro Ergebnis einen Extra-Round-Trip: einmal batch-
  // laden via `in(...)` Filter. Board-Checklists haben board_id direkt,
  // brauchen keinen Extra-Lookup.
  if (checklistsRes.data) {
    type ClRow = {
      id: string;
      board_id: string | null;
      cell_id: string | null;
      label: string;
      alias: string | null;
    };
    const rows = checklistsRes.data as ClRow[];
    const cellIds = Array.from(
      new Set(rows.filter((r) => !r.board_id && r.cell_id).map((r) => r.cell_id as string)),
    );
    let cellIdToMatrixId = new Map<string, string>();
    if (cellIds.length > 0) {
      const cellsLookup = await supabase
        .from('cells')
        .select('id, matrix_id')
        .eq('workspace_id', workspaceId)
        .in('id', cellIds);
      if (cellsLookup.data) {
        for (const r of cellsLookup.data as Array<{ id: string; matrix_id: string }>) {
          cellIdToMatrixId.set(r.id, r.matrix_id);
        }
      }
    }

    for (const cl of rows) {
      if (cl.board_id) {
        results.push({
          kind: 'checklist-board',
          checklistId: cl.id,
          boardId: cl.board_id,
          title: cl.label || '(ohne Label)',
          alias: cl.alias,
        });
      } else if (cl.cell_id) {
        const mid = cellIdToMatrixId.get(cl.cell_id);
        if (!mid) continue; // Broken — keine matrix_id auffindbar
        results.push({
          kind: 'checklist-cell',
          checklistId: cl.id,
          cellId: cl.cell_id,
          matrixId: mid,
          title: cl.label || '(ohne Label)',
          alias: cl.alias,
        });
      }
    }
  }

  return results;
}
