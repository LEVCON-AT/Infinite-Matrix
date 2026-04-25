// Shared-Dispatch fuer aufgeloeste Aliase. Zentralisiert die
// Navigations-Logik, damit AliasQuicknav, DocsPopup (Source-Chip),
// GlobalSearch und andere Call-Sites dieselben Regeln fuer Cell-Ziele,
// Card-Overlay, Checklist-Routes und Link-Open nutzen.
//
// Bewusst keine React/Solid-Spezifika im Helper — alles was UI-Seite
// braucht (Navigate-Funktion, Toasts) wird als Parameter reingereicht.

import type { AliasResolveResult } from './alias-resolve';
import { openDocsPopup } from './docs-ui';
import { rememberFocus } from './navigation-focus';
import { sanitizeUrl } from './url';

type Navigate = (path: string) => void;

type DispatchDeps = {
  workspaceId: string;
  navigate: Navigate;
  onError: (msg: string) => void;
};

// Strukturelles Interface fuer Cell-Treffer aus Alias-Resolve oder
// Global-Search — beide tragen dieselben Felder (plus extra optional)
// und koennen denselben Target-Helper nutzen.
export type CellLikeTarget = {
  cellId: string;
  matrixId: string;
  features: string[];
  childMatrixId: string | null;
  boardId: string | null;
};

// Liefert den passenden Route-Pfad fuer ein Cell-Ziel — identisch
// zur Quicknav-Priorisierung: Sub-Matrix > Sub-Board > Checklists >
// Info > Overlay auf Parent-Matrix (?cell=).
export function cellTarget(wsId: string, c: CellLikeTarget): string {
  if (c.childMatrixId) return `/w/${wsId}/n/${c.childMatrixId}`;
  if (c.boardId) return `/w/${wsId}/n/${c.boardId}`;
  if (c.features.includes('checklists')) return `/w/${wsId}/c/${c.cellId}/checklists`;
  if (c.features.includes('info')) return `/w/${wsId}/c/${c.cellId}/info`;
  return `/w/${wsId}/n/${c.matrixId}?cell=${c.cellId}`;
}

// Einheitlicher Dispatch-Schalter. Throws nicht — Fehler werden via
// onError() gemeldet (typischerweise showToast).
export function dispatchAliasResult(result: AliasResolveResult, deps: DispatchDeps): void {
  switch (result.kind) {
    case 'node':
      deps.navigate(`/w/${deps.workspaceId}/n/${result.nodeId}`);
      return;
    case 'cell':
      rememberFocus(result.matrixId, result.rowId, result.colId);
      deps.navigate(cellTarget(deps.workspaceId, result));
      return;
    case 'card':
      deps.navigate(`/w/${deps.workspaceId}/n/${result.boardId}?card=${result.cardId}`);
      return;
    case 'checklist-board':
      deps.navigate(`/w/${deps.workspaceId}/n/${result.boardId}`);
      return;
    case 'checklist-cell':
      deps.navigate(`/w/${deps.workspaceId}/c/${result.cellId}/checklists`);
      return;
    case 'link': {
      const safe = sanitizeUrl(result.url);
      if (!safe) {
        deps.onError('Link-URL ist ungueltig.');
        return;
      }
      window.open(safe, '_blank', 'noopener,noreferrer');
      return;
    }
    case 'doc':
      openDocsPopup({ initialDocId: result.docId });
      return;
  }
}
