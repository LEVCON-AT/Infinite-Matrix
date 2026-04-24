import { supabase } from './supabase';
import type {
  BoardContent,
  CellChecklistsContent,
  CellFeature,
  CellRow,
  ChecklistItemRow,
  ChecklistRow,
  ColRow,
  DocRow,
  KbCardRow,
  KbColRow,
  LinkRow,
  MatrixContent,
  NodeRow,
  RowRow,
  TreeEntry,
  TreeNode,
  WorkspaceWithRole,
} from './types';

// ─── Workspaces ──────────────────────────────────────────────────
// Gibt alle Workspaces zurueck, in denen der aktuelle User Mitglied ist.
// RLS-Query: memberships.user_id = auth.uid() greift automatisch.
export async function fetchMyWorkspaces(): Promise<WorkspaceWithRole[]> {
  const { data, error } = await supabase
    .from('memberships')
    .select('role, workspace:workspaces(*)')
    .order('role', { ascending: true });

  if (error) throw error;
  if (!data) return [];

  return data
    .filter((m) => m.workspace != null)
    .map((m) => {
      const ws = m.workspace as unknown as {
        id: string;
        name: string;
        owner_id: string;
        created_at: string;
        updated_at: string;
      };
      return { ...ws, role: m.role };
    });
}

// ─── Nodes + Cells fuer Tree-Aufbau ──────────────────────────────
export async function fetchNodesForWorkspace(workspaceId: string): Promise<NodeRow[]> {
  const { data, error } = await supabase
    .from('nodes')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data ?? []) as NodeRow[];
}

export async function fetchCellsForWorkspace(workspaceId: string): Promise<CellRow[]> {
  const { data, error } = await supabase
    .from('cells')
    .select('*')
    .eq('workspace_id', workspaceId);

  if (error) throw error;
  return (data ?? []) as CellRow[];
}

export async function fetchRowsForWorkspace(workspaceId: string): Promise<RowRow[]> {
  const { data, error } = await supabase
    .from('rows')
    .select('*')
    .eq('workspace_id', workspaceId);
  if (error) throw error;
  return (data ?? []) as RowRow[];
}

export async function fetchColsForWorkspace(workspaceId: string): Promise<ColRow[]> {
  const { data, error } = await supabase
    .from('cols')
    .select('*')
    .eq('workspace_id', workspaceId);
  if (error) throw error;
  return (data ?? []) as ColRow[];
}

// Laedt alle Karten der angegebenen Boards in einem Query. Genutzt
// von der Aggregat-Sektion (Intervallmatrix / Aufgabenuebersicht),
// um alle Karten im Subtree einer Matrix zu holen.
export async function fetchCardsForBoards(
  boardIds: string[],
  workspaceId: string,
): Promise<KbCardRow[]> {
  if (boardIds.length === 0) return [];
  const { data, error } = await supabase
    .from('kb_cards')
    .select('*')
    .in('board_id', boardIds)
    .eq('workspace_id', workspaceId);
  if (error) throw error;
  return (data ?? []) as KbCardRow[];
}

// ─── Matrix-Inhalt (rows + cols + cells) ─────────────────────────
// Laedt alle drei Tabellen parallel, gefiltert auf die Matrix. RLS
// blockiert Fremd-Workspaces automatisch; workspace_id ist zusaetzlich
// als Guard gesetzt, damit ein falscher Param nicht versehentlich
// Zeilen anderer Matrizen durchschmuggelt.
export async function fetchMatrixContent(
  matrixId: string,
  workspaceId: string,
): Promise<MatrixContent> {
  const [rowsRes, colsRes, cellsRes] = await Promise.all([
    supabase
      .from('rows')
      .select('*')
      .eq('matrix_id', matrixId)
      .eq('workspace_id', workspaceId)
      .order('position', { ascending: true }),
    supabase
      .from('cols')
      .select('*')
      .eq('matrix_id', matrixId)
      .eq('workspace_id', workspaceId)
      .order('position', { ascending: true }),
    supabase
      .from('cells')
      .select('*')
      .eq('matrix_id', matrixId)
      .eq('workspace_id', workspaceId),
  ]);

  if (rowsRes.error) throw rowsRes.error;
  if (colsRes.error) throw colsRes.error;
  if (cellsRes.error) throw cellsRes.error;

  return {
    rows: (rowsRes.data ?? []) as RowRow[],
    cols: (colsRes.data ?? []) as ColRow[],
    cells: (cellsRes.data ?? []) as CellRow[],
  };
}

// ─── Board-Inhalt (Kanban-Spalten + Karten + Checklisten + Links) ─
// 4 parallele Queries. checklist_items werden via in-Filter auf die
// Board-Checklisten eingeschraenkt — nicht via RLS-only, weil es sonst
// alle items ueber den Workspace laedt.
export async function fetchBoardContent(
  boardId: string,
  workspaceId: string,
): Promise<BoardContent> {
  const [colsRes, cardsRes, checklistsRes, linksRes] = await Promise.all([
    supabase
      .from('kb_cols')
      .select('*')
      .eq('board_id', boardId)
      .eq('workspace_id', workspaceId)
      .order('position', { ascending: true }),
    supabase
      .from('kb_cards')
      .select('*')
      .eq('board_id', boardId)
      .eq('workspace_id', workspaceId)
      .order('position', { ascending: true }),
    supabase
      .from('checklists')
      .select('*')
      .eq('board_id', boardId)
      .eq('workspace_id', workspaceId)
      .order('position', { ascending: true }),
    supabase
      .from('links')
      .select('*')
      .eq('board_id', boardId)
      .eq('workspace_id', workspaceId)
      .order('position', { ascending: true }),
  ]);

  if (colsRes.error) throw colsRes.error;
  if (cardsRes.error) throw cardsRes.error;
  if (checklistsRes.error) throw checklistsRes.error;
  if (linksRes.error) throw linksRes.error;

  const checklists = (checklistsRes.data ?? []) as ChecklistRow[];

  let checklistItems: ChecklistItemRow[] = [];
  if (checklists.length > 0) {
    const ids = checklists.map((c) => c.id);
    const itemsRes = await supabase
      .from('checklist_items')
      .select('*')
      .in('checklist_id', ids)
      .eq('workspace_id', workspaceId)
      .order('position', { ascending: true });
    if (itemsRes.error) throw itemsRes.error;
    checklistItems = (itemsRes.data ?? []) as ChecklistItemRow[];
  }

  return {
    kbCols: (colsRes.data ?? []) as KbColRow[],
    kbCards: (cardsRes.data ?? []) as KbCardRow[],
    checklists,
    checklistItems,
    links: (linksRes.data ?? []) as LinkRow[],
  };
}

// ─── Cell-Checklisten (cell_id=X, board_id=NULL) ──────────────────
// Wie der Board-Pfad, aber gefiltert auf eine Zelle. RLS + workspace_id
// als Guard.
export async function fetchCellChecklists(
  cellId: string,
  workspaceId: string,
): Promise<CellChecklistsContent> {
  const { data: clData, error: clErr } = await supabase
    .from('checklists')
    .select('*')
    .eq('cell_id', cellId)
    .eq('workspace_id', workspaceId)
    .order('position', { ascending: true });
  if (clErr) throw clErr;

  const checklists = (clData ?? []) as ChecklistRow[];
  let checklistItems: ChecklistItemRow[] = [];
  if (checklists.length > 0) {
    const ids = checklists.map((c) => c.id);
    const { data: itData, error: itErr } = await supabase
      .from('checklist_items')
      .select('*')
      .in('checklist_id', ids)
      .eq('workspace_id', workspaceId)
      .order('position', { ascending: true });
    if (itErr) throw itErr;
    checklistItems = (itData ?? []) as ChecklistItemRow[];
  }

  return { checklists, checklistItems };
}

// ─── Node-Leer-Probe (fuer Confirm-vor-Delete) ────────────────────
// Gibt true zurueck, wenn der Node weder strukturelle Kinder (rows/cols
// bzw. kb_cols/kb_cards/checklists/links) hat. Ein leerer Sub-Node
// kann ohne Rueckfrage geloescht werden — User hat nichts zu verlieren.
export async function isNodeEmpty(
  nodeId: string,
  nodeType: 'matrix' | 'board',
): Promise<boolean> {
  if (nodeType === 'matrix') {
    const [r, c] = await Promise.all([
      supabase
        .from('rows')
        .select('id', { head: true, count: 'exact' })
        .eq('matrix_id', nodeId),
      supabase
        .from('cols')
        .select('id', { head: true, count: 'exact' })
        .eq('matrix_id', nodeId),
    ]);
    return (r.count ?? 0) === 0 && (c.count ?? 0) === 0;
  }
  const [cards, cols, cls, links] = await Promise.all([
    supabase
      .from('kb_cards')
      .select('id', { head: true, count: 'exact' })
      .eq('board_id', nodeId),
    supabase
      .from('kb_cols')
      .select('id', { head: true, count: 'exact' })
      .eq('board_id', nodeId),
    supabase
      .from('checklists')
      .select('id', { head: true, count: 'exact' })
      .eq('board_id', nodeId),
    supabase
      .from('links')
      .select('id', { head: true, count: 'exact' })
      .eq('board_id', nodeId),
  ]);
  return [cards, cols, cls, links].every((res) => (res.count ?? 0) === 0);
}

// ─── Tree-Aufbau ─────────────────────────────────────────────────
// Jede Node kann einen parent_cell_id haben (= die Zelle in der sie als
// Sub-Feature lebt). Diese Zelle selbst gehoert zu einer anderen Matrix
// (= der Parent-Node). Fuer den Sidebar-Tree brauchen wir also die Kette:
//   child-node.parent_cell_id -> cell.matrix_id -> parent-node.id
//
// Legacy-Variante, liefert nur Matrix/Board-Nodes flach-rekursiv. Bleibt
// fuer Alt-Aufrufer (Breadcrumb-Walking, Export) gewuenscht.
export function buildTree(nodes: NodeRow[], cells: CellRow[]): TreeNode[] {
  const cellToMatrix = new Map<string, string>();
  for (const c of cells) cellToMatrix.set(c.id, c.matrix_id);

  const nodeById = new Map<string, TreeNode>();
  for (const n of nodes) {
    nodeById.set(n.id, { kind: 'node', id: n.id, node: n, children: [] });
  }

  const roots: TreeNode[] = [];

  for (const tn of nodeById.values()) {
    const parentCellId = tn.node.parent_cell_id;
    if (!parentCellId) {
      roots.push(tn);
      continue;
    }
    const parentMatrixId = cellToMatrix.get(parentCellId);
    const parent = parentMatrixId ? nodeById.get(parentMatrixId) : undefined;
    if (parent) (parent.children as TreeNode[]).push(tn);
    else roots.push(tn); // verwaiste Node (parent in anderem Workspace / geloescht)
  }

  return roots;
}

// Erweiterte Variante fuer den Sidebar: Matrix-Nodes zeigen ihre Zellen
// (mit Features oder mit child-node), und die Sub-Nodes (Board, Matrix)
// haengen unter der jeweiligen Cell. Leere Zellen werden ausgefiltert —
// eine Zelle qualifiziert, wenn:
//   - sie mindestens ein Feature hat,        ODER
//   - ein Child-Node (Board/Matrix) an ihr haengt (parent_cell_id match).
// Zell-Label ist "rowLabel / colLabel"; wenn Row/Col fehlen (orphaned),
// wird die Zelle ausgelassen.
export function buildSidebarTree(
  nodes: NodeRow[],
  cells: CellRow[],
  rows: RowRow[],
  cols: ColRow[],
): TreeEntry[] {
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const colById = new Map(cols.map((c) => [c.id, c]));
  const cellsByMatrix = new Map<string, CellRow[]>();
  for (const cell of cells) {
    const arr = cellsByMatrix.get(cell.matrix_id) ?? [];
    arr.push(cell);
    cellsByMatrix.set(cell.matrix_id, arr);
  }
  const childNodesByCell = new Map<string, NodeRow[]>();
  for (const n of nodes) {
    if (!n.parent_cell_id) continue;
    const arr = childNodesByCell.get(n.parent_cell_id) ?? [];
    arr.push(n);
    childNodesByCell.set(n.parent_cell_id, arr);
  }

  function buildNode(node: NodeRow): TreeEntry {
    const entry: TreeEntry = {
      kind: 'node',
      id: node.id,
      node,
      children: [],
    };
    if (node.type !== 'matrix') return entry;

    const myCells = cellsByMatrix.get(node.id) ?? [];
    // Sort cells: zeilenweise, innerhalb Zeile nach Spalten-Position.
    // Beides ueber position-Feld der Row/Col, Fallback 0.
    const decorated = myCells
      .map((c) => {
        const r = rowById.get(c.row_id);
        const col = colById.get(c.col_id);
        return { cell: c, row: r, col };
      })
      .filter((d) => d.row && d.col);
    decorated.sort((a, b) => {
      const ra = a.row!.position ?? 0;
      const rb = b.row!.position ?? 0;
      if (ra !== rb) return ra - rb;
      const ca = a.col!.position ?? 0;
      const cb = b.col!.position ?? 0;
      return ca - cb;
    });

    // Feature-Reihenfolge bewusst fix: matrix -> info -> board -> checklists.
    // So sieht jede Cell im Sidebar-Tree gleich strukturiert aus; User
    // entwickelt eine stabile Ortserwartung.
    const FEATURE_ORDER: CellFeature[] = [
      'matrix',
      'info',
      'board',
      'checklists',
    ];

    for (const { cell, row, col } of decorated) {
      const kids = childNodesByCell.get(cell.id) ?? [];
      const features = (cell.features ?? []) as CellFeature[];
      const hasFeatures = features.length > 0;
      if (!hasFeatures && kids.length === 0) continue;

      // Pro Feature ein Child der Cell-Row aufbauen, in FEATURE_ORDER.
      // Structural Features (matrix/board) haengen ihren Sub-Node
      // DIREKT unter der Cell — keine Zwischen-Feature-Row, damit
      // der User nicht einen Klick extra bis zur Sub-Matrix braucht.
      // Flag-Features (info/checklists) bekommen eine Feature-Row,
      // weil sie keinen eigenen Sub-Node haben und die Row die
      // Feature-Seite repraesentiert.
      const featureChildren: TreeEntry[] = [];
      for (const feat of FEATURE_ORDER) {
        if (!features.includes(feat)) continue;
        if (feat === 'matrix' && cell.child_matrix_id) {
          const childNode = kids.find((k) => k.id === cell.child_matrix_id);
          if (childNode) featureChildren.push(buildNode(childNode));
        } else if (feat === 'board' && cell.board_id) {
          const childNode = kids.find((k) => k.id === cell.board_id);
          if (childNode) featureChildren.push(buildNode(childNode));
        } else if (feat === 'info' || feat === 'checklists') {
          featureChildren.push({
            kind: 'feature',
            id: `feat-${cell.id}-${feat}`,
            cellId: cell.id,
            feature: feat,
            children: [],
          });
        }
      }

      // Waisen-Child-Nodes, die keinen FK-Match gefunden haben
      // (parent_cell_id zeigt auf diese Cell, aber weder cell.board_id
      // noch cell.child_matrix_id verweist zurueck — Dateninkonsistenz).
      // Trotzdem sichtbar als lose Children der Cell-Row, damit sie
      // nicht verschwinden.
      const attachedNodeIds = new Set<string>(
        featureChildren
          .filter((fc): fc is Extract<TreeEntry, { kind: 'node' }> => fc.kind === 'node')
          .map((fc) => fc.id),
      );
      const orphanKids = kids.filter((k) => !attachedNodeIds.has(k.id));

      const cellEntry: TreeEntry = {
        kind: 'cell',
        id: cell.id,
        cell,
        rowLabel: row!.label || '(Zeile)',
        colLabel: col!.label || '(Spalte)',
        children: [...featureChildren, ...orphanKids.map(buildNode)],
      };
      (entry.children as TreeEntry[]).push(cellEntry);
    }

    return entry;
  }

  const roots: TreeEntry[] = [];
  for (const n of nodes) {
    if (n.parent_cell_id) continue;
    roots.push(buildNode(n));
  }
  return roots;
}

// ─── Dokumentation ─────────────────────────────────────────────
// Laedt die n zuletzt geaenderten Docs (Recent-Liste im Popup).
// Sort nach updated_at DESC, Limit einstellbar (default 20 — genug
// fuer die sichtbare Recent-Sektion ohne Scroll).
export async function fetchDocsRecent(
  workspaceId: string,
  limit = 20,
): Promise<DocRow[]> {
  const { data, error } = await supabase
    .from('docs')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as DocRow[];
}

// Einzel-Doc fetch — fuer Tab-Restore via ^alias.
export async function fetchDocById(
  docId: string,
  workspaceId: string,
): Promise<DocRow | null> {
  const { data, error } = await supabase
    .from('docs')
    .select('*')
    .eq('id', docId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (error) throw error;
  return (data as DocRow | null) ?? null;
}

// Alle Dokus, die an eine bestimmte Zelle angehaengt sind. Fuer die
// Cell-Info/Checklists-Pages — zeigt dem User "welche Dokus liegen
// hier". Sort nach updated_at DESC (zuletzt geaenderte zuerst, wie
// im Alt-Client-Vorbild).
export async function fetchDocsForCell(
  cellId: string,
  workspaceId: string,
): Promise<DocRow[]> {
  const { data, error } = await supabase
    .from('docs')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('attached_cell_id', cellId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as DocRow[];
}

// Set der cell_ids, an denen mindestens eine Doku haengt. Fuer die
// derived Doku-Pill in der Matrix-Ansicht. Eine einzelne Query, wir
// filtern workspace-weit und deduplizieren client-seitig. Erwartete
// Groesse: wenige hundert Rows selbst bei grossen Workspaces —
// tragbar ohne Paging.
export async function fetchCellIdsWithDocs(
  workspaceId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('docs')
    .select('attached_cell_id')
    .eq('workspace_id', workspaceId)
    .not('attached_cell_id', 'is', null);
  if (error) throw error;
  const set = new Set<string>();
  for (const row of (data ?? []) as Array<{ attached_cell_id: string | null }>) {
    if (row.attached_cell_id) set.add(row.attached_cell_id);
  }
  return set;
}
