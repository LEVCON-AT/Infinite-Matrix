// Welle D — Zentraler Doku-Open-Handler.
//
// Eine Funktion `openDokuForContext(ctx)` die je nach Sicht-Kontext
// den richtigen Pin-Parent voreinstellt. Konsumenten:
//   1. MatrixView (Cell-Focus)
//   2. MatrixView (kein Focus, Matrix-Root)
//   3. MatrixView (Pill-Focus auf Sub-Matrix/Board → node)
//   4. BoardView (Card-Focus → atom)
//   5. BoardView (kein Focus → node = board-node)
//   6. Calendar (Event-Focus → atom)
//   7. Atom-Detail-Modal (Body-Focus → atom)
//   8. Workspace-Root (Shift+D, kein Parent)
//
// Die Funktion ruft openDocsPopup() mit den passenden Pin-Args.
// DocsPopup nutzt das fuer den Pending-Tab-Save-Pfad
// (pin_doc_with_create-RPC).
//
// Guard: 'd' darf nicht in <input>, <textarea> oder contentEditable
// feuern — dafuer hat jeder Caller einen Guard via shouldIgnoreDKey().

import type { AtomKind } from './atom-manifestations';
import { openDocsPopup } from './docs-ui';

export type DocsContext =
  | { kind: 'cell'; cellId: string; cellAlias: string | null }
  | {
      kind: 'atom';
      atomType: AtomKind;
      atomId: string;
      atomTitle: string | null;
    }
  | {
      kind: 'node';
      nodeId: string;
      nodeKind: 'matrix' | 'board';
      nodeAlias: string | null;
    };

// Single-Source — DocsPopup-Request bekommt einen Pin-Hinweis und
// uebersetzt ihn in pin_doc_with_create-Args beim ersten Save. V1
// transportieren wir Cell-Pins ueber das existing attachedCellId-Field
// (DocsPopup behandelt das mit pin_doc_with_create). Atom/Node-Pins
// kommen ueber das neue `pinTarget`-Feld (siehe docs-ui.ts).
export function openDokuForContext(ctx: DocsContext): void {
  if (ctx.kind === 'cell') {
    openDocsPopup({
      sourceAlias: ctx.cellAlias,
      attachedCellId: ctx.cellId,
    });
    return;
  }
  if (ctx.kind === 'atom') {
    openDocsPopup({
      sourceAlias: null,
      pinTarget: {
        containerKind: 'atom',
        containerId: ctx.atomId,
        containerLabel: ctx.atomTitle ?? '(Atom)',
      },
    });
    return;
  }
  if (ctx.kind === 'node') {
    openDocsPopup({
      sourceAlias: ctx.nodeAlias,
      pinTarget: {
        containerKind: 'node',
        containerId: ctx.nodeId,
        containerLabel: ctx.nodeAlias ? `^${ctx.nodeAlias}` : `(${ctx.nodeKind})`,
      },
    });
    return;
  }
}

// Guard fuer 'd'-Hotkey-Handler. Returns true wenn der Druck IGNORIERT
// werden soll (User tippt gerade in einem Input/contentEditable).
export function shouldIgnoreDKey(target: EventTarget | null): boolean {
  if (!target) return false;
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target.isContentEditable) return true;
  // <select> und <button> sollen `d` durchlassen — sind keine Input-
  // Felder. Default false.
  return false;
}
