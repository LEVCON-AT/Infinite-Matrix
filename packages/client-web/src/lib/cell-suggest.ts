// Cell-Suggest (A.6 Skeleton).
//
// Singleton-State fuer das CellSuggestModal. Aufruf von NewCellWizard
// (oder kuenftig auch direkter Empty-Cell-Click): openCellSuggest({
//   workspaceId, parentCellId, parentLabel
// }) → Modal oeffnet sich, User gibt Prompt ein, runAssist mit
// mode='cell-suggest'. Tool-Use-Loop dispatcht mcp_create_*-RPCs.
//
// Owner muss einen AI-Provider gesetzt haben (AccountAi-Settings),
// sonst credential-Lookup wirft. Modal zeigt klaren Hinweis.

export type CellSuggestRequest = {
  workspaceId: string;
  parentCellId: string | null;
  parentLabel: string;
};

let pending: CellSuggestRequest | null = null;
const listeners = new Set<(req: CellSuggestRequest | null) => void>();

export function onCellSuggestRequest(cb: (req: CellSuggestRequest | null) => void): () => void {
  listeners.add(cb);
  cb(pending);
  return () => listeners.delete(cb);
}

function notify() {
  for (const cb of listeners) cb(pending);
}

export function openCellSuggest(req: CellSuggestRequest): void {
  pending = req;
  notify();
}

export function closeCellSuggest(): void {
  pending = null;
  notify();
}
