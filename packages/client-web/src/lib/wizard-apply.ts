// Apply-Pfad fuer den Onboarding-Wizard (A.4d + Polish-Welle).
//
// Spielt den vom LLM in Step 3 generierten Vorschlag als reale RPC-/
// Insert-Calls ab. Sequentiell — RLS + FKs moegen Reihenfolge,
// parallel-Inserts riskieren Position-Kollisionen.
//
// User-Selection: pro Item (Node, Child, Checkliste) ein
// `selected: boolean`. Apply iteriert nur ueber `selected===true`.
// Children innerhalb eines deselektierten Nodes werden geskippt.
//
// Was angelegt wird:
//   - Top-Level: mcp_create_node pro selektiertem Node
//   - Boards: 1 default kb_col "Inbox" + mcp_create_card pro
//             selektierte child.card_name + board-level Checklisten
//             via mcp_create_checklist(board_id) + mcp_add_checklist_item
//   - Matrices: 1 default col "Themen" + 1 row pro selektierter
//             child.cell_label + cell an (row, col) mit features=
//             ['checklists'] wenn Checklisten dran haengen
//             + Cell-Checklisten via mcp_create_checklist(cell_id)
//
// Direct-Inserts in cols/rows/cells/kb_cols laufen ueber RLS-Policies
// der jeweiligen Tabellen (Owner darf schreiben). RPCs werden nur
// dort genutzt wo sie schon existieren (mcp_create_node/card/checklist/
// add_checklist_item).
//
// Source-Pfade:
//   - kind: 'initial' → workspace existiert (handle_new_user trigger),
//     wir fuellen ihn nur.
//   - kind: 'new' → workspace muss erst per createWorkspace angelegt
//     werden, dann fuellen.

import { addCol, addKbCol, addRow, insertCell } from './mutations';
import { supabase } from './supabase';
import type {
  ApplyFailure,
  ApplyProgress,
  ProposalChild,
  ProposalNode,
  WizardProposal,
  WizardSource,
} from './wizard-state';
import { createWorkspace } from './workspace-create';

export type ApplyResult = {
  ok: boolean;
  workspaceId: string | null;
  createdNodes: number;
  failedItems: ApplyFailure[];
  // Wenn fresh-Mode + alle-fail: Workspace-Cleanup ist noetig (User-
  // sichtbarer Hinweis in StepApplying).
  workspaceCreatedButEmpty: boolean;
};

export type ApplyOptions = {
  proposal: WizardProposal;
  source: WizardSource;
  onProgress?: (p: ApplyProgress) => void;
  signal?: AbortSignal;
};

export async function applyWizardProposal(opts: ApplyOptions): Promise<ApplyResult> {
  const { proposal, source, onProgress, signal } = opts;

  const failures: ApplyFailure[] = [];
  const selectedNodes = proposal.nodes.filter((n) => n.selected);

  // Total-Step-Schaetzung: 1 (workspace) + 1 (per Node) + variable
  // pro Child/Checkliste. Wir rechnen die obere Grenze um den Progress-
  // Balken sinnvoll zu fuellen.
  const totalSteps =
    (source.kind === 'new' ? 1 : 0) +
    selectedNodes.reduce((sum, n) => sum + 1 + childWorkSteps(n), 0);
  let step = 0;
  const tick = (label: string): void => {
    step += 1;
    onProgress?.({ current: step, total: totalSteps, step: label });
  };

  let workspaceId: string | null = null;
  let workspaceFreshlyCreated = false;

  // ─── Step 0: Workspace anlegen wenn fresh ─────────────────────
  if (source.kind === 'new') {
    tick('Workspace anlegen…');
    if (signal?.aborted) {
      return abortedResult(workspaceId, failures, 0, false);
    }
    try {
      workspaceId = await createWorkspace(proposal.workspace_label || 'Neuer Workspace');
      workspaceFreshlyCreated = true;
    } catch (err) {
      failures.push({
        scope: 'workspace',
        label: proposal.workspace_label || 'Neuer Workspace',
        error: errMsg(err),
      });
      return {
        ok: false,
        workspaceId: null,
        createdNodes: 0,
        failedItems: failures,
        workspaceCreatedButEmpty: false,
      };
    }
  } else {
    workspaceId = source.workspaceId;
  }

  // ─── Step 1..N: pro Node ──────────────────────────────────────
  let createdNodes = 0;
  for (const node of selectedNodes) {
    if (signal?.aborted) {
      return abortedResult(workspaceId, failures, createdNodes, workspaceFreshlyCreated);
    }
    tick(`Knoten "${node.label}" anlegen…`);
    const nodeId = await createNode(workspaceId, node, failures);
    if (!nodeId) continue;
    createdNodes += 1;

    const selectedChildren = node.children.filter((c) => c.selected);
    if (selectedChildren.length === 0) {
      // Skip die child-Steps fuer Progress-Korrektheit. Wir haben
      // sie in childWorkSteps eingerechnet — naechster Tick startet
      // also evtl. mit "Sprung". Akzeptabel, der User merkt das nicht.
      continue;
    }

    if (node.type === 'board') {
      await applyBoardChildren(workspaceId, nodeId, selectedChildren, failures, tick, signal);
    } else {
      await applyMatrixChildren(workspaceId, nodeId, selectedChildren, failures, tick, signal);
    }
  }

  const okOverall = createdNodes > 0;
  const workspaceCreatedButEmpty = workspaceFreshlyCreated && createdNodes === 0;

  return {
    ok: okOverall,
    workspaceId,
    createdNodes,
    failedItems: failures,
    workspaceCreatedButEmpty,
  };
}

// ─── Helper: Worksteps pro Node fuer Progress-Schaetzung ─────
function childWorkSteps(node: ProposalNode): number {
  const sel = node.children.filter((c) => c.selected);
  if (sel.length === 0) return 0;
  // 1 fuer default-col/kb_col + 1 pro selected child + 1 pro selected
  // checklist (items werden gesammelt mit der checklist).
  let n = 1;
  for (const c of sel) {
    n += 1;
    n += c.checklists.filter((cl) => cl.selected).length;
  }
  return n;
}

// ─── Node-Create ──────────────────────────────────────────────
async function createNode(
  workspaceId: string,
  node: ProposalNode,
  failures: ApplyFailure[],
): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('mcp_create_node', {
      p_workspace_id: workspaceId,
      p_parent_cell_id: null,
      p_type: node.type,
      p_label: node.label,
      p_alias: node.alias,
    });
    if (error) {
      failures.push({ scope: 'node', label: node.label, error: error.message });
      return null;
    }
    const obj = data as { node_id?: string } | null;
    return obj?.node_id ?? null;
  } catch (err) {
    failures.push({ scope: 'node', label: node.label, error: errMsg(err) });
    return null;
  }
}

// ─── Board-Children: kb_col + Cards + board-Checklisten ──────
async function applyBoardChildren(
  workspaceId: string,
  boardId: string,
  selectedChildren: ProposalChild[],
  failures: ApplyFailure[],
  tick: (s: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return;
  tick('Default-Spalte "Inbox" anlegen…');

  // AU-B1 K2 (B1-B-002): gewrappter addKbCol statt direktem Insert,
  // damit der Onboarding-Workspace im IDB-Cache landet + offline replay-faehig ist.
  let colId: string;
  try {
    const created = await addKbCol({
      workspaceId,
      boardId,
      label: 'Inbox',
    });
    colId = created.id;
  } catch (colErr) {
    failures.push({
      scope: 'col',
      label: 'Inbox',
      error: errMsg(colErr) || 'kb_col-Insert fehlgeschlagen',
    });
    // Ohne kb_col koennen wir keine Karten anlegen. Skip board-children.
    return;
  }

  // Cards
  for (const child of selectedChildren) {
    if (signal?.aborted) return;
    if (!child.card_name) continue;
    tick(`Karte "${child.card_name}" anlegen…`);
    try {
      const { error } = await supabase.rpc('mcp_create_card', {
        p_col_id: colId,
        p_name: child.card_name,
        p_note: child.card_note,
        p_alias: null,
      });
      if (error) {
        failures.push({ scope: 'card', label: child.card_name, error: error.message });
      }
    } catch (err) {
      failures.push({ scope: 'card', label: child.card_name, error: errMsg(err) });
    }

    // Board-Checklisten kommen NICHT auf Cell-Ebene (Boards haben keine
    // Cells). Wir haengen sie pro Child mit board_id direkt ans Board.
    for (const cl of child.checklists) {
      if (!cl.selected || signal?.aborted) continue;
      tick(`Checkliste "${cl.label}" anlegen…`);
      await createChecklistAtBoard(boardId, cl.label, cl.items, failures, signal);
    }
  }
}

// ─── Matrix-Children: 1 col + N rows + N cells + Checklisten ─
async function applyMatrixChildren(
  workspaceId: string,
  matrixId: string,
  selectedChildren: ProposalChild[],
  failures: ApplyFailure[],
  tick: (s: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return;
  tick('Default-Spalte "Themen" anlegen…');

  // AU-B1 K2 (B1-B-002): gewrappte addCol/addRow/insertCell statt
  // direkten Inserts. IDB-Cache + offline-replay konsistent.
  let colId: string;
  try {
    const created = await addCol({
      workspaceId,
      matrixId,
      label: 'Themen',
    });
    colId = created.id;
  } catch (colErr) {
    failures.push({
      scope: 'col',
      label: 'Themen',
      error: errMsg(colErr) || 'cols-Insert fehlgeschlagen',
    });
    return;
  }

  for (const child of selectedChildren) {
    if (signal?.aborted) return;
    if (!child.cell_label) continue;
    tick(`Zeile "${child.cell_label}" anlegen…`);

    // Row anlegen
    let rowId: string;
    try {
      const created = await addRow({
        workspaceId,
        matrixId,
        label: child.cell_label,
      });
      rowId = created.id;
    } catch (rowErr) {
      failures.push({
        scope: 'row',
        label: child.cell_label,
        error: errMsg(rowErr) || 'rows-Insert fehlgeschlagen',
      });
      continue;
    }

    // Cell an (row, col) mit features
    const selectedChecklists = child.checklists.filter((cl) => cl.selected);
    const features = selectedChecklists.length > 0 ? ['checklists'] : [];

    let cellId: string;
    try {
      const created = await insertCell({
        workspaceId,
        matrixId,
        rowId,
        colId,
        patch: { features },
      });
      cellId = created.id;
    } catch (cellErr) {
      failures.push({
        scope: 'cell',
        label: child.cell_label,
        error: errMsg(cellErr) || 'cells-Insert fehlgeschlagen',
      });
      continue;
    }

    for (const cl of selectedChecklists) {
      if (signal?.aborted) return;
      tick(`Checkliste "${cl.label}" anlegen…`);
      await createChecklistAtCell(cellId, cl.label, cl.items, failures, signal);
    }
  }
}

// ─── Checklist-Helper (cell-scoped) ───────────────────────────
async function createChecklistAtCell(
  cellId: string,
  label: string,
  items: string[],
  failures: ApplyFailure[],
  signal?: AbortSignal,
): Promise<void> {
  try {
    const { data, error } = await supabase.rpc('mcp_create_checklist', {
      p_cell_id: cellId,
      p_board_id: null,
      p_label: label,
      p_alias: null,
    });
    if (error || !data) {
      failures.push({
        scope: 'checklist',
        label,
        error: error?.message ?? 'checklist-Insert fehlgeschlagen',
      });
      return;
    }
    const checklistId = (data as { checklist_id?: string }).checklist_id;
    if (!checklistId) return;
    await addChecklistItems(checklistId, items, label, failures, signal);
  } catch (err) {
    failures.push({ scope: 'checklist', label, error: errMsg(err) });
  }
}

// ─── Checklist-Helper (board-scoped) ──────────────────────────
async function createChecklistAtBoard(
  boardId: string,
  label: string,
  items: string[],
  failures: ApplyFailure[],
  signal?: AbortSignal,
): Promise<void> {
  try {
    const { data, error } = await supabase.rpc('mcp_create_checklist', {
      p_cell_id: null,
      p_board_id: boardId,
      p_label: label,
      p_alias: null,
    });
    if (error || !data) {
      failures.push({
        scope: 'checklist',
        label,
        error: error?.message ?? 'checklist-Insert fehlgeschlagen',
      });
      return;
    }
    const checklistId = (data as { checklist_id?: string }).checklist_id;
    if (!checklistId) return;
    await addChecklistItems(checklistId, items, label, failures, signal);
  } catch (err) {
    failures.push({ scope: 'checklist', label, error: errMsg(err) });
  }
}

// ─── Checklist-Items ──────────────────────────────────────────
async function addChecklistItems(
  checklistId: string,
  items: string[],
  parentLabel: string,
  failures: ApplyFailure[],
  signal?: AbortSignal,
): Promise<void> {
  for (const text of items) {
    if (signal?.aborted) return;
    if (!text.trim()) continue;
    try {
      const { error } = await supabase.rpc('mcp_add_checklist_item', {
        p_checklist_id: checklistId,
        p_text: text,
        p_level: 0,
      });
      if (error) {
        failures.push({
          scope: 'item',
          label: `${parentLabel}: ${text.slice(0, 40)}`,
          error: error.message,
        });
      }
    } catch (err) {
      failures.push({
        scope: 'item',
        label: `${parentLabel}: ${text.slice(0, 40)}`,
        error: errMsg(err),
      });
    }
  }
}

// ─── Utilities ────────────────────────────────────────────────
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function abortedResult(
  workspaceId: string | null,
  failures: ApplyFailure[],
  createdNodes: number,
  workspaceFreshlyCreated: boolean,
): ApplyResult {
  return {
    ok: createdNodes > 0,
    workspaceId,
    createdNodes,
    failedItems: failures,
    workspaceCreatedButEmpty: workspaceFreshlyCreated && createdNodes === 0,
  };
}
