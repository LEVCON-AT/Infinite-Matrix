import { isNetworkError } from './mutation-queue';
import { getById, getByWorkspace, mergeRows, withCache } from './offline-cache';
import { markCacheFallback, markLiveSuccess } from './offline-state';
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
//
// Offline-Cache: localStorage statt IDB — die Liste ist klein, aendert
// sich selten, und wir brauchen sie schon beim ersten Render (vor IDB-
// open). LS reicht voellig.
const WS_LIST_LS_KEY = 'matrix:workspaces:cache';

function readWorkspacesFromLS(): WorkspaceWithRole[] | null {
  try {
    const raw = localStorage.getItem(WS_LIST_LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed as WorkspaceWithRole[];
  } catch {
    return null;
  }
}

function writeWorkspacesToLS(rows: WorkspaceWithRole[]): void {
  try {
    localStorage.setItem(WS_LIST_LS_KEY, JSON.stringify(rows));
  } catch {
    // Quota oder Disabled-Storage — schlucken, der Online-Pfad
    // funktioniert weiter.
  }
}

export async function fetchMyWorkspaces(): Promise<WorkspaceWithRole[]> {
  try {
    // user_id-Filter explizit setzen — die memberships_select-RLS-
    // Policy zeigt allen Workspace-Members auch die anderen
    // Memberships im selben Workspace ("wer ist sonst noch da"). Hier
    // wollen wir aber nur die EIGENEN Memberships, sonst doppeln sich
    // Workspaces im Switcher (siehe 2026-04-25-Bug).
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr) throw userErr;
    const userId = userData.user?.id;
    if (!userId) throw new Error('Keine aktive Auth-Session.');

    const { data, error } = await supabase
      .from('memberships')
      .select('role, workspace:workspaces(*)')
      .eq('user_id', userId)
      .order('role', { ascending: true });

    if (error) throw error;

    const baseRows = (data ?? [])
      .filter((m) => m.workspace != null)
      .map((m) => {
        const ws = m.workspace as unknown as {
          id: string;
          name: string;
          owner_id: string;
          created_at: string;
          updated_at: string;
        };
        return { ...ws, role: m.role, owner_email: null as string | null };
      });

    // Owner-Email per RPC nachladen, nur fuer Workspaces, in denen der
    // Caller NICHT selber Owner ist (eigene Workspaces brauchen den
    // Hinweis nicht). Failure ist non-fatal — Switcher zeigt dann eben
    // keinen Owner-Sub-Label.
    const foreignIds = baseRows.filter((r) => r.role !== 'owner').map((r) => r.id);
    if (foreignIds.length > 0) {
      try {
        const { data: ownersData } = await supabase.rpc('get_workspace_owners', {
          p_workspace_ids: foreignIds,
        });
        if (Array.isArray(ownersData)) {
          const ownerMap = new Map<string, string>();
          for (const row of ownersData as { workspace_id: string; owner_email: string }[]) {
            ownerMap.set(row.workspace_id, row.owner_email);
          }
          for (const r of baseRows) {
            if (ownerMap.has(r.id)) r.owner_email = ownerMap.get(r.id) ?? null;
          }
        }
      } catch {
        // Owner-Email-Lookup ist Bonus-Info — fail silent.
      }
    }

    writeWorkspacesToLS(baseRows);
    markLiveSuccess();
    return baseRows;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const cached = readWorkspacesFromLS();
    if (!cached || cached.length === 0) throw err;
    markCacheFallback();
    return cached;
  }
}

// ─── Nodes + Cells fuer Tree-Aufbau ──────────────────────────────
//
// Alle vier workspace-weiten Fetches laufen durch withCache: bei
// Erfolg wandern die Rows in den IDB-Store, bei Netz-Fehler liefert
// der Cache die zuletzt bekannten Daten. Das hebt den Sidebar-Tree +
// Stack-Navigation auch offline.
async function cachedList<T extends { id: string; workspace_id: string }>(
  table:
    | 'nodes'
    | 'cells'
    | 'rows'
    | 'cols'
    | 'kb_cols'
    | 'kb_cards'
    | 'checklists'
    | 'checklist_items'
    | 'links'
    | 'docs',
  workspaceId: string,
  fetch: () => Promise<T[]>,
): Promise<T[]> {
  const res = await withCache<T>(table, workspaceId, fetch);
  if (res.fromCache) markCacheFallback();
  else markLiveSuccess();
  return res.rows;
}

export async function fetchNodesForWorkspace(workspaceId: string): Promise<NodeRow[]> {
  return cachedList<NodeRow>('nodes', workspaceId, async () => {
    const { data, error } = await supabase
      .from('nodes')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []) as NodeRow[];
  });
}

export async function fetchCellsForWorkspace(workspaceId: string): Promise<CellRow[]> {
  return cachedList<CellRow>('cells', workspaceId, async () => {
    const { data, error } = await supabase
      .from('cells')
      .select('*')
      .eq('workspace_id', workspaceId);
    if (error) throw error;
    return (data ?? []) as CellRow[];
  });
}

export async function fetchRowsForWorkspace(workspaceId: string): Promise<RowRow[]> {
  return cachedList<RowRow>('rows', workspaceId, async () => {
    const { data, error } = await supabase.from('rows').select('*').eq('workspace_id', workspaceId);
    if (error) throw error;
    return (data ?? []) as RowRow[];
  });
}

export async function fetchColsForWorkspace(workspaceId: string): Promise<ColRow[]> {
  return cachedList<ColRow>('cols', workspaceId, async () => {
    const { data, error } = await supabase.from('cols').select('*').eq('workspace_id', workspaceId);
    if (error) throw error;
    return (data ?? []) as ColRow[];
  });
}

// Laedt alle Karten der angegebenen Boards in einem Query. Genutzt
// von der Aggregat-Sektion (Intervallmatrix / Aufgabenuebersicht),
// um alle Karten im Subtree einer Matrix zu holen.
export async function fetchCardsForBoards(
  boardIds: string[],
  workspaceId: string,
): Promise<KbCardRow[]> {
  if (boardIds.length === 0) return [];
  try {
    const { data, error } = await supabase
      .from('kb_cards')
      .select('*')
      .in('board_id', boardIds)
      .eq('workspace_id', workspaceId);
    if (error) throw error;
    const rows = (data ?? []) as KbCardRow[];
    void mergeRows('kb_cards', rows).catch(() => {});
    markLiveSuccess();
    return rows;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const set = new Set(boardIds);
    const all = await getByWorkspace<KbCardRow>('kb_cards', workspaceId);
    const filtered = all.filter((c) => set.has(c.board_id));
    markCacheFallback();
    return filtered;
  }
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
  try {
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
      supabase.from('cells').select('*').eq('matrix_id', matrixId).eq('workspace_id', workspaceId),
    ]);

    if (rowsRes.error) throw rowsRes.error;
    if (colsRes.error) throw colsRes.error;
    if (cellsRes.error) throw cellsRes.error;

    const rows = (rowsRes.data ?? []) as RowRow[];
    const cols = (colsRes.data ?? []) as ColRow[];
    const cells = (cellsRes.data ?? []) as CellRow[];
    // Merge in den Cache, damit Drill-Down beim naechsten Offline
    // Stand verfuegbar bleibt. mergeRows ueberschreibt vorhandene
    // Rows mit gleicher id (Last-Read-Wins).
    void mergeRows('rows', rows).catch(() => {});
    void mergeRows('cols', cols).catch(() => {});
    void mergeRows('cells', cells).catch(() => {});
    markLiveSuccess();
    return { rows, cols, cells };
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    // Offline-Fallback: workspace-weite Caches filtern auf matrix_id.
    const [allRows, allCols, allCells] = await Promise.all([
      getByWorkspace<RowRow>('rows', workspaceId),
      getByWorkspace<ColRow>('cols', workspaceId),
      getByWorkspace<CellRow>('cells', workspaceId),
    ]);
    markCacheFallback();
    return {
      rows: allRows
        .filter((r) => r.matrix_id === matrixId)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
      cols: allCols
        .filter((c) => c.matrix_id === matrixId)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
      cells: allCells.filter((c) => c.matrix_id === matrixId),
    };
  }
}

// ─── Board-Inhalt (Kanban-Spalten + Karten + Checklisten + Links) ─
// 4 parallele Queries. checklist_items werden via in-Filter auf die
// Board-Checklisten eingeschraenkt — nicht via RLS-only, weil es sonst
// alle items ueber den Workspace laedt.
export async function fetchBoardContent(
  boardId: string,
  workspaceId: string,
): Promise<BoardContent> {
  try {
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

    const kbCols = (colsRes.data ?? []) as KbColRow[];
    const kbCards = (cardsRes.data ?? []) as KbCardRow[];
    const checklists = (checklistsRes.data ?? []) as ChecklistRow[];
    const links = (linksRes.data ?? []) as LinkRow[];

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

    void mergeRows('kb_cols', kbCols).catch(() => {});
    void mergeRows('kb_cards', kbCards).catch(() => {});
    void mergeRows('checklists', checklists).catch(() => {});
    void mergeRows('links', links).catch(() => {});
    void mergeRows('checklist_items', checklistItems).catch(() => {});
    markLiveSuccess();

    return { kbCols, kbCards, checklists, checklistItems, links };
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    // Offline: workspace-weite Caches filtern auf board_id.
    const [allCols, allCards, allCl, allLinks, allItems] = await Promise.all([
      getByWorkspace<KbColRow>('kb_cols', workspaceId),
      getByWorkspace<KbCardRow>('kb_cards', workspaceId),
      getByWorkspace<ChecklistRow>('checklists', workspaceId),
      getByWorkspace<LinkRow>('links', workspaceId),
      getByWorkspace<ChecklistItemRow>('checklist_items', workspaceId),
    ]);
    const checklists = allCl
      .filter((c) => c.board_id === boardId)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const clIds = new Set(checklists.map((c) => c.id));
    markCacheFallback();
    return {
      kbCols: allCols
        .filter((c) => c.board_id === boardId)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
      kbCards: allCards
        .filter((c) => c.board_id === boardId)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
      checklists,
      checklistItems: allItems
        .filter((it) => clIds.has(it.checklist_id))
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
      links: allLinks
        .filter((l) => l.board_id === boardId)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    };
  }
}

// AU-B1 K2 (B1-D-001): Card-Drop-Helper.
// Liefert die erste Spalte eines Boards + die hoechste Position
// in deren Card-Liste. Wird vom NodeTree-Drop-Handler benoetigt
// um Karten ans Top der ersten Spalte zu schieben. Online-Pfad mit
// IDB-Fallback analog zu fetchBoardContent.
export async function fetchBoardCardDropTarget(
  boardId: string,
  workspaceId: string,
): Promise<{ firstColId: string; topPosition: number } | null> {
  try {
    const colsRes = await supabase
      .from('kb_cols')
      .select('id, position')
      .eq('board_id', boardId)
      .eq('workspace_id', workspaceId)
      .order('position', { ascending: true })
      .limit(1);
    if (colsRes.error) throw colsRes.error;
    const firstCol = (colsRes.data ?? [])[0] as { id: string; position: number } | undefined;
    if (!firstCol) return null;

    const posRes = await supabase
      .from('kb_cards')
      .select('position')
      .eq('col_id', firstCol.id)
      .eq('workspace_id', workspaceId)
      .order('position', { ascending: false })
      .limit(1);
    if (posRes.error) throw posRes.error;
    const topPos =
      posRes.data && posRes.data.length > 0
        ? (posRes.data[0] as { position: number }).position
        : -1;
    markLiveSuccess();
    return { firstColId: firstCol.id, topPosition: topPos + 1 };
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const [allCols, allCards] = await Promise.all([
      getByWorkspace<KbColRow>('kb_cols', workspaceId),
      getByWorkspace<KbCardRow>('kb_cards', workspaceId),
    ]);
    const cols = allCols
      .filter((c) => c.board_id === boardId)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const firstCol = cols[0];
    if (!firstCol) {
      markCacheFallback();
      return null;
    }
    const colCards = allCards
      .filter((c) => c.col_id === firstCol.id)
      .sort((a, b) => (b.position ?? 0) - (a.position ?? 0));
    const topPos = colCards.length > 0 ? (colCards[0].position ?? 0) : -1;
    markCacheFallback();
    return { firstColId: firstCol.id, topPosition: topPos + 1 };
  }
}

// ─── Cell-Checklisten (cell_id=X, board_id=NULL) ──────────────────
// Wie der Board-Pfad, aber gefiltert auf eine Zelle. RLS + workspace_id
// als Guard.
export async function fetchCellChecklists(
  cellId: string,
  workspaceId: string,
): Promise<CellChecklistsContent> {
  try {
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

    void mergeRows('checklists', checklists).catch(() => {});
    void mergeRows('checklist_items', checklistItems).catch(() => {});
    markLiveSuccess();
    return { checklists, checklistItems };
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const [allCl, allItems] = await Promise.all([
      getByWorkspace<ChecklistRow>('checklists', workspaceId),
      getByWorkspace<ChecklistItemRow>('checklist_items', workspaceId),
    ]);
    const checklists = allCl
      .filter((c) => c.cell_id === cellId)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const clIds = new Set(checklists.map((c) => c.id));
    markCacheFallback();
    return {
      checklists,
      checklistItems: allItems
        .filter((it) => clIds.has(it.checklist_id))
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    };
  }
}

// ─── Phase 3 O.8.N.1: existing Templates pro Cell laden ──────────
// Liefert pro nameable Feature der Cell den aktuellen Template +
// Ziel-Row-ID, damit der NewCellWizard im Edit-Modus den Cycle auf
// die vorhandene Position vorbelegen und ein Rename atomar
// schreiben kann (label_template + label).
//
// Nameable-Feature-Map:
//  - 'matrix' → nodes(child_matrix_id).label_template
//  - 'board'  → nodes(board_id).label_template
//  - 'checklists' → checklists(cell_id).label_template (sortiert nach
//                   position; erste/aktive)
//  - 'doc'    → docs(attached_cell_id).title_template (sortiert nach
//                   updated_at DESC; juengstes Doku)
//
// Online-only (fetch-on-open). Bei Network-Error liefert die Map
// leer — der Wizard faellt dann auf Pos 1 / Plain-Default zurueck.
export type ExistingNameableTarget =
  | { kind: 'node'; id: string }
  | { kind: 'checklist'; id: string }
  | { kind: 'doc'; id: string };

export type ExistingNameableInfo = {
  template: string;
  target: ExistingNameableTarget;
};

export async function fetchCellExistingTemplates(
  cell: CellRow,
  workspaceId: string,
): Promise<Map<string, ExistingNameableInfo>> {
  const out = new Map<string, ExistingNameableInfo>();
  const tasks: Promise<void>[] = [];

  if (cell.child_matrix_id) {
    const id = cell.child_matrix_id;
    tasks.push(
      (async () => {
        const { data } = await supabase
          .from('nodes')
          .select('label_template')
          .eq('id', id)
          .single();
        const tpl = (data as { label_template?: string } | null)?.label_template ?? '';
        out.set('matrix', { template: tpl, target: { kind: 'node', id } });
      })(),
    );
  }
  if (cell.board_id) {
    const id = cell.board_id;
    tasks.push(
      (async () => {
        const { data } = await supabase
          .from('nodes')
          .select('label_template')
          .eq('id', id)
          .single();
        const tpl = (data as { label_template?: string } | null)?.label_template ?? '';
        out.set('board', { template: tpl, target: { kind: 'node', id } });
      })(),
    );
  }
  if ((cell.features ?? []).includes('checklists')) {
    tasks.push(
      (async () => {
        const { data } = await supabase
          .from('checklists')
          .select('id,label_template')
          .eq('workspace_id', workspaceId)
          .eq('cell_id', cell.id)
          .order('position', { ascending: true })
          .limit(1);
        const row = (data ?? [])[0] as { id: string; label_template?: string } | undefined;
        if (row) {
          out.set('checklists', {
            template: row.label_template ?? '',
            target: { kind: 'checklist', id: row.id },
          });
        }
      })(),
    );
  }
  // Doku: prueft NICHT cell.features (Doku haengt ueber attached_cell_id,
  // kein Feature-Flag in cells.features). Wir laden alle Docs der Cell
  // und nehmen das juengste — falls keine, bleibt 'doc' aus der Map.
  tasks.push(
    (async () => {
      const { data } = await supabase
        .from('docs')
        .select('id,title_template')
        .eq('workspace_id', workspaceId)
        .eq('attached_cell_id', cell.id)
        .order('updated_at', { ascending: false })
        .limit(1);
      const row = (data ?? [])[0] as { id: string; title_template?: string } | undefined;
      if (row) {
        out.set('doc', {
          template: row.title_template ?? '',
          target: { kind: 'doc', id: row.id },
        });
      }
    })(),
  );

  try {
    await Promise.all(tasks);
  } catch {
    // Network/RLS-Error: Map bleibt teil-/leer. Wizard faellt dann
    // auf Pos-1-Default zurueck — keine Regression gegen O.8.M.
  }
  return out;
}

// ─── Node-Leer-Probe (fuer Confirm-vor-Delete) ────────────────────
// Gibt true zurueck, wenn der Node weder strukturelle Kinder (rows/cols
// bzw. kb_cols/kb_cards/checklists/links) hat. Ein leerer Sub-Node
// kann ohne Rueckfrage geloescht werden — User hat nichts zu verlieren.
export async function isNodeEmpty(nodeId: string, nodeType: 'matrix' | 'board'): Promise<boolean> {
  if (nodeType === 'matrix') {
    const [r, c] = await Promise.all([
      supabase.from('rows').select('id', { head: true, count: 'exact' }).eq('matrix_id', nodeId),
      supabase.from('cols').select('id', { head: true, count: 'exact' }).eq('matrix_id', nodeId),
    ]);
    return (r.count ?? 0) === 0 && (c.count ?? 0) === 0;
  }
  const [cards, cols, cls, links] = await Promise.all([
    supabase.from('kb_cards').select('id', { head: true, count: 'exact' }).eq('board_id', nodeId),
    supabase.from('kb_cols').select('id', { head: true, count: 'exact' }).eq('board_id', nodeId),
    supabase.from('checklists').select('id', { head: true, count: 'exact' }).eq('board_id', nodeId),
    supabase.from('links').select('id', { head: true, count: 'exact' }).eq('board_id', nodeId),
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
// Chip-Daten fuer den Sidebar-Tree (SB.2). Leer lassen heisst "Chip
// aus" — dann werden keine Extra-Rows emittiert. Die Maps sind indiziert
// nach dem passenden Parent, damit buildNode O(1)-Lookup hat.
export type SidebarChipData = {
  // Board-Links (LinkRow) indiziert nach board_id.
  linksByBoardId?: Map<string, LinkRow[]>;
  // Docs indiziert nach attached_cell_id.
  docsByCellId?: Map<string, DocRow[]>;
  // Filter nach Link-Typ: 'url' zeigt URLs, 'mail' zeigt Mails.
  // Beides in einem Set bedeutet beide Typen anzeigen; leer = keine.
  linkTypes?: Set<'url' | 'mail'>;
  // Show cell.data.links (info-field-links) wenn 'url' oder 'mail' im
  // Set ist. Wird auch fuers showMail-Flag gebraucht.
  showInfoLinks?: boolean;
};

export function buildSidebarTree(
  nodes: NodeRow[],
  cells: CellRow[],
  rows: RowRow[],
  cols: ColRow[],
  chipData?: SidebarChipData,
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

  // Chip-Daten-Shortcuts. Leer heisst: Chip aus, nichts emittieren.
  const linkTypes = chipData?.linkTypes ?? new Set<'url' | 'mail'>();
  const showInfoLinks = chipData?.showInfoLinks === true;
  const linksByBoardId = chipData?.linksByBoardId ?? new Map<string, LinkRow[]>();
  const docsByCellId = chipData?.docsByCellId ?? new Map<string, DocRow[]>();

  function linkEntryFromBoardLink(l: LinkRow): TreeEntry {
    return {
      kind: 'link',
      id: `link-board-${l.id}`,
      linkType: l.type,
      label: l.label || l.url,
      url: l.url,
      alias: l.alias,
      children: [],
    };
  }

  function linkEntryFromInfoLink(
    cellId: string,
    l: { id: string; label: string; url: string },
  ): TreeEntry {
    // InfoLinks haben keinen Typ-Discriminator (InfoLink hat nur
    // id/label/url). Wir derivieren url/mail aus dem Prefix; das ist
    // dieselbe Heuristik wie in der Link-Add-Eingabe.
    const looksLikeMail = l.url.includes('@') && !/^[a-z]+:\/\//i.test(l.url);
    return {
      kind: 'link',
      id: `link-info-${cellId}-${l.id}`,
      linkType: looksLikeMail ? 'mail' : 'url',
      label: l.label || l.url,
      url: l.url,
      alias: null,
      children: [],
    };
  }

  function docEntry(d: DocRow): TreeEntry {
    return {
      kind: 'doc',
      id: `doc-${d.id}`,
      docId: d.id,
      title: d.title || '(ohne Titel)',
      alias: d.alias,
      children: [],
    };
  }

  // InfoLinks aus cell.data.links extrahieren. Nicht alle Cells tragen
  // das Feld — nur solche, die schonmal Link-Mutationen hatten.
  function readCellInfoLinks(cell: CellRow): Array<{ id: string; label: string; url: string }> {
    const raw = (cell.data as { links?: unknown } | null)?.links;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (l): l is { id: string; label: string; url: string } =>
        !!l &&
        typeof l === 'object' &&
        typeof (l as { id?: unknown }).id === 'string' &&
        typeof (l as { label?: unknown }).label === 'string' &&
        typeof (l as { url?: unknown }).url === 'string',
    );
  }

  function buildNode(node: NodeRow): TreeEntry {
    const entry: TreeEntry = {
      kind: 'node',
      id: node.id,
      node,
      children: [],
    };
    // Board-Node: Chip-Links direkt als Children anhaengen.
    if (node.type === 'board' && linkTypes.size > 0) {
      const links = linksByBoardId.get(node.id) ?? [];
      const filtered = links.filter((l) => linkTypes.has(l.type));
      (entry.children as TreeEntry[]).push(...filtered.map(linkEntryFromBoardLink));
      return entry;
    }
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
      .filter(
        (d): d is { cell: CellRow; row: RowRow; col: ColRow } => d.row != null && d.col != null,
      );
    decorated.sort((a, b) => {
      const ra = a.row.position ?? 0;
      const rb = b.row.position ?? 0;
      if (ra !== rb) return ra - rb;
      const ca = a.col.position ?? 0;
      const cb = b.col.position ?? 0;
      return ca - cb;
    });

    // Feature-Reihenfolge bewusst fix: matrix -> info -> board -> checklists.
    // So sieht jede Cell im Sidebar-Tree gleich strukturiert aus; User
    // entwickelt eine stabile Ortserwartung.
    const FEATURE_ORDER: CellFeature[] = ['matrix', 'info', 'board', 'checklists'];

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
      // Info-Link-Chips haengen unter der info-Feature-Row, wenn
      // der Chip aktiv ist und die Cell info-Links hat.
      const infoLinkChildren: TreeEntry[] =
        showInfoLinks && features.includes('info')
          ? readCellInfoLinks(cell)
              .filter((l) => {
                const looksLikeMail = l.url.includes('@') && !/^[a-z]+:\/\//i.test(l.url);
                const t: 'url' | 'mail' = looksLikeMail ? 'mail' : 'url';
                return linkTypes.has(t);
              })
              .map((l) => linkEntryFromInfoLink(cell.id, l))
          : [];

      for (const feat of FEATURE_ORDER) {
        if (!features.includes(feat)) continue;
        if (feat === 'matrix' && cell.child_matrix_id) {
          const childNode = kids.find((k) => k.id === cell.child_matrix_id);
          if (childNode) featureChildren.push(buildNode(childNode));
        } else if (feat === 'board' && cell.board_id) {
          const childNode = kids.find((k) => k.id === cell.board_id);
          if (childNode) featureChildren.push(buildNode(childNode));
        } else if (feat === 'info') {
          featureChildren.push({
            kind: 'feature',
            id: `feat-${cell.id}-${feat}`,
            cellId: cell.id,
            feature: feat,
            children: infoLinkChildren,
          });
        } else if (feat === 'checklists') {
          featureChildren.push({
            kind: 'feature',
            id: `feat-${cell.id}-${feat}`,
            cellId: cell.id,
            feature: feat,
            children: [],
          });
        }
      }

      // Docs-Chip: Docu-Rows haengen direkt unter der Cell-Row, noch vor
      // den Features. So ist "Doku" im Tree oberhalb der Features gut
      // auffindbar und konkurriert nicht mit Info-Feldern.
      const cellDocs = docsByCellId.get(cell.id) ?? [];
      const docChildren = cellDocs.map(docEntry);

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
        rowLabel: row.label || '(Zeile)',
        colLabel: col.label || '(Spalte)',
        children: [...docChildren, ...featureChildren, ...orphanKids.map(buildNode)],
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
export async function fetchDocsRecent(workspaceId: string, limit = 20): Promise<DocRow[]> {
  try {
    const { data, error } = await supabase
      .from('docs')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    const rows = (data ?? []) as DocRow[];
    void mergeRows('docs', rows).catch(() => {});
    markLiveSuccess();
    return rows;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const all = await getByWorkspace<DocRow>('docs', workspaceId);
    markCacheFallback();
    return all
      .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))
      .slice(0, limit);
  }
}

// Einzel-Doc fetch — fuer Tab-Restore via ^alias.
export async function fetchDocById(docId: string, workspaceId: string): Promise<DocRow | null> {
  try {
    const { data, error } = await supabase
      .from('docs')
      .select('*')
      .eq('id', docId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    if (error) throw error;
    const row = (data as DocRow | null) ?? null;
    if (row) void mergeRows('docs', [row]).catch(() => {});
    markLiveSuccess();
    return row;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const cached = await getById<DocRow>('docs', docId);
    markCacheFallback();
    if (!cached || cached.workspace_id !== workspaceId) return null;
    return cached;
  }
}

// Alle Dokus, die an eine bestimmte Zelle angehaengt sind. Fuer die
// Cell-Info/Checklists-Pages — zeigt dem User "welche Dokus liegen
// hier". Sort nach updated_at DESC (zuletzt geaenderte zuerst, wie
// im Alt-Client-Vorbild).
export async function fetchDocsForCell(cellId: string, workspaceId: string): Promise<DocRow[]> {
  try {
    const { data, error } = await supabase
      .from('docs')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('attached_cell_id', cellId)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    const rows = (data ?? []) as DocRow[];
    void mergeRows('docs', rows).catch(() => {});
    markLiveSuccess();
    return rows;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const all = await getByWorkspace<DocRow>('docs', workspaceId);
    markCacheFallback();
    return all
      .filter((d) => d.attached_cell_id === cellId)
      .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));
  }
}

// Alle Board-Links im Workspace. Fuer den Sidebar-Tree-Links-Chip
// (SB.2) — wenn aktiv, haengen die Links unter dem jeweiligen
// Board-Node. Erwartete Groesse: wenige hundert Rows, tragbar ohne
// Paging.
export async function fetchWorkspaceLinks(workspaceId: string): Promise<LinkRow[]> {
  return cachedList<LinkRow>('links', workspaceId, async () => {
    const { data, error } = await supabase
      .from('links')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('position', { ascending: true });
    if (error) throw error;
    return (data ?? []) as LinkRow[];
  });
}

// Alle Dokus mit attached_cell_id im Workspace. Fuer den Sidebar-
// Tree-Docs-Chip (SB.2) — Rendering haengt die Doc-Row unter die
// passende Cell-Row.
export async function fetchWorkspaceAttachedDocs(workspaceId: string): Promise<DocRow[]> {
  // Wir cachen workspace-weit (alle Docs), filtern dann lokal.
  // Lookups via fetchDocsForCell / fetchCellIdsWithDocs nutzen den
  // gleichen Cache, daher konsistent.
  try {
    const { data, error } = await supabase
      .from('docs')
      .select('*')
      .eq('workspace_id', workspaceId)
      .not('attached_cell_id', 'is', null)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    const rows = (data ?? []) as DocRow[];
    void mergeRows('docs', rows).catch(() => {});
    markLiveSuccess();
    return rows;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const all = await getByWorkspace<DocRow>('docs', workspaceId);
    markCacheFallback();
    return all
      .filter((d) => d.attached_cell_id != null)
      .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));
  }
}

// Set der cell_ids, an denen mindestens eine Doku haengt. Fuer die
// derived Doku-Pill in der Matrix-Ansicht. Eine einzelne Query, wir
// filtern workspace-weit und deduplizieren client-seitig. Erwartete
// Groesse: wenige hundert Rows selbst bei grossen Workspaces —
// tragbar ohne Paging.
export async function fetchCellIdsWithDocs(workspaceId: string): Promise<Set<string>> {
  try {
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
    markLiveSuccess();
    return set;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const all = await getByWorkspace<DocRow>('docs', workspaceId);
    const set = new Set<string>();
    for (const d of all) {
      if (d.attached_cell_id) set.add(d.attached_cell_id);
    }
    markCacheFallback();
    return set;
  }
}
