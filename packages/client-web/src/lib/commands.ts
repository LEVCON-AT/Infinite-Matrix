// Command-Palette: parseCommand portiert aus packages/client-standalone/matrix.html
// (dort `parseCommand` + `executeCommand`).
//
// Die Palette akzeptiert Commands ohne fuehrenden ^ — das Prefix ist
// Input-Kosmetik (ein separater `^`-Badge vor dem Input zeigt dem User
// den Kontext, wie bei AliasQuicknav). Aliases als Argumente werden
// ebenfalls ohne fuehrendes ^ geschrieben (Einfachheits-Prinzip).
//
// Sprint 1:
//   n <alias>               — neue Karte im aktuellen Board
//   copy <src> [dst]        — Checklisten-Clone zwischen Boards
//
// Sprint 2:
//   n <card> -m <target> [col]  — Card cross-board move (Col-Picker
//                                  wenn col fehlt und >1 Spalte da ist)
//   del <alias>             — Alias resolven + Loeschen (node/card/
//                             checklist/doc). window.confirm vorher.
//   ren <alias> <label>     — Alias resolven + Umbenennen
//   nd                      — Docs-Popup oeffnen
//   k                       — KeyboardHelp oeffnen
//
// Stubs (noch nicht implementiert):
//   w, s, sc, c, move (Rest), cl-to-card, fa, fi, fh, fc

import { type AliasResolveResult, resolveAlias } from './alias-resolve';
import { showConfirm } from './dialog';
import { translateDbError } from './errors';
import {
  addCard,
  addChecklist,
  addChecklistItem,
  delCard,
  delChecklist,
  delDoc,
  deleteNode,
  moveCardToBoard,
  renameCard,
  renameChecklist,
  renameNode,
  setCardAlias,
  setDocTitle,
} from './mutations';
import { fetchBoardContent } from './queries';
import { showToast } from './toasts';
import type { NodeRow } from './types';

export type ParsedCommand =
  | { kind: 'new-card'; alias: string | null }
  | {
      kind: 'move-card';
      cardAlias: string;
      targetAlias: string;
      colName: string | null;
    }
  | { kind: 'copy'; source: string; target: string | null }
  | { kind: 'delete-alias'; alias: string }
  | { kind: 'rename-alias'; alias: string; label: string }
  | { kind: 'new-doc' }
  | { kind: 'show-help' }
  // Reset-here: leert den Ebene-Kontext (Matrix / Board / Cell /
  // Feature) — was genau geleert wird, bestimmt ctx.currentNode +
  // ctx.currentCellId + ctx.currentFeature.
  | { kind: 'reset-here' }
  // Reset-all: Workspace komplett leeren + frische Root-Matrix.
  // skipConfirm=true (via -y-Flag): keine Rueckfrage, keine Export-
  // Nachfrage — fuer schnelles Testen.
  | { kind: 'reset-all'; skipConfirm: boolean }
  // Workspace-weiter Export. encrypted=true → User wird Passphrase
  // gefragt + .imx-Datei. Plain default.
  | { kind: 'export-workspace'; encrypted: boolean }
  // Workspace-weiter Import: oeffnet File-Picker. Mode-Wahl (add /
  // overwrite / export-overwrite) passiert im UI-Hook nach File-Read.
  | { kind: 'import-workspace' }
  // Implicit: wenn der User einfach ^alias tippt (nur ein Token, kein
  // Verb), landet das hier. Behaviour = Quicknav-Dispatch.
  | { kind: 'navigate'; alias: string }
  | { kind: 'unsupported'; verb: string }
  | { kind: 'unknown'; raw: string };

// Liste aller Verben — fuer Parser-Dispatch und fuer die Help-Uebersicht.
// Eintraege werden in der Reihenfolge im ^help-Dropdown gezeigt.
// Unsupported-Verben werden auch angezeigt (gedimmt) — der User sieht
// das komplette Vokabular + weiss welche "noch nicht ready" sind.
export const COMMAND_VERBS: Array<{
  verb: string;
  syntax: string;
  description: string;
  supported: boolean;
}> = [
  { verb: 'n', syntax: 'n [alias]', description: 'Neue Karte im aktuellen Board', supported: true },
  {
    verb: 'n -m',
    syntax: 'n <card> -m <board> [col]',
    description: 'Karte in anderes Board verschieben',
    supported: true,
  },
  { verb: 'copy', syntax: 'copy <src> [dst]', description: 'Checkliste clonen', supported: true },
  {
    verb: 'del',
    syntax: 'del <alias>',
    description: 'Alias aufloesen + loeschen',
    supported: true,
  },
  { verb: 'ren', syntax: 'ren <alias> <label>', description: 'Alias umbenennen', supported: true },
  { verb: 'nd', syntax: 'nd', description: 'Neue Doku (Docs-Popup oeffnen)', supported: true },
  {
    verb: 'reset',
    syntax: 'reset [-all] [-y]',
    description:
      'Inhalt der aktuellen Ebene leeren. `-all` = ganzer Workspace. `-y` = ohne Rueckfrage.',
    supported: true,
  },
  {
    verb: 'export',
    syntax: 'export [-enc]',
    description:
      'Workspace komplett als JSON exportieren. `-enc` fuer verschluesseltes .imx mit Passphrase.',
    supported: true,
  },
  {
    verb: 'import',
    syntax: 'import',
    description:
      'Workspace-Export einlesen (.json oder .imx). 3-Weg-Wahl: hinzufuegen / sichern+ersetzen / ersetzen.',
    supported: true,
  },
  { verb: 'help', syntax: 'help', description: 'Diese Uebersicht zeigen', supported: true },
  {
    verb: '<alias>',
    syntax: '<alias>',
    description: 'Zum Alias springen (Navigation)',
    supported: true,
  },
  // Stubs — parseCommand liefert {kind:'unsupported'}, die Bar zeigt sie
  // gedimmt. Reihenfolge grob nach Haeufigkeit im HTML-Vorbild.
  {
    verb: 'w',
    syntax: 'w [alias]',
    description: 'Intervallmatrix (Wiederkehr-Ansicht)',
    supported: false,
  },
  { verb: 's', syntax: 's', description: 'Einstellungen oeffnen', supported: false },
  { verb: 'sc', syntax: 'sc', description: 'Sidebar-Scroll-Modus togglen', supported: false },
  {
    verb: 'c',
    syntax: 'c [tab] [alias] [-all]',
    description: 'Cleanup — Labels zuruecksetzen',
    supported: false,
  },
  {
    verb: 'move',
    syntax: 'move <alias> ...',
    description: 'Node verschieben (Alt-Variante)',
    supported: false,
  },
  {
    verb: 'delete',
    syntax: 'delete <alias>',
    description: 'Alias aufloesen + loeschen (Alt-Variante)',
    supported: false,
  },
  {
    verb: 'cl-to-card',
    syntax: 'cl-to-card <alias>',
    description: 'Checkliste in Karten umwandeln',
    supported: false,
  },
  { verb: 'fa', syntax: 'fa <term>', description: 'Scope-Suche nur Karten', supported: false },
  { verb: 'fi', syntax: 'fi <term>', description: 'Scope-Suche nur Info-Felder', supported: false },
  { verb: 'fh', syntax: 'fh <term>', description: 'Scope-Suche nur Links', supported: false },
  { verb: 'fc', syntax: 'fc <term>', description: 'Scope-Suche nur Checklisten', supported: false },
];

export function parseCommand(raw: string): ParsedCommand | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Fuehrendes ^ dulden — User tippt's oft reflexartig.
  const stripped = trimmed.startsWith('^') ? trimmed.slice(1) : trimmed;
  // Verb + lowercase Args. Wir splitten in 2 Modi: "uniform tokens" fuer
  // die meisten Commands (alles lowercase + whitespace-split), und "mixed"
  // fuer ren <alias> <label...> — da bleibt der Label-Teil case-preserved.
  const tokens = stripped.split(/\s+/);
  const verb = tokens[0]?.toLowerCase();
  const lower = tokens.map((t) => t.toLowerCase());
  if (!verb) return null;

  // n cardAlias -m targetAlias [colName]
  if (verb === 'n' && tokens.length >= 4 && lower[2] === '-m') {
    return {
      kind: 'move-card',
      cardAlias: lower[1],
      targetAlias: lower[3],
      colName: tokens.slice(4).join(' ') || null,
    };
  }

  // n [alias]
  if (verb === 'n') {
    return { kind: 'new-card', alias: lower[1] || null };
  }

  // copy src [dst]
  if (verb === 'copy') {
    if (!tokens[1]) return { kind: 'unknown', raw };
    return { kind: 'copy', source: lower[1], target: lower[2] || null };
  }

  // del <alias>
  if (verb === 'del') {
    if (!tokens[1]) return { kind: 'unknown', raw };
    return { kind: 'delete-alias', alias: lower[1] };
  }

  // ren <alias> <label> — Label behaelt Original-Case.
  if (verb === 'ren') {
    if (!tokens[1] || !tokens[2]) return { kind: 'unknown', raw };
    return {
      kind: 'rename-alias',
      alias: lower[1],
      label: tokens.slice(2).join(' '),
    };
  }

  // nd — neue Doku (oeffnet Docs-Popup)
  if (verb === 'nd') {
    return { kind: 'new-doc' };
  }

  // help / k — KeyboardHelp + Command-Uebersicht (Shortcut-Hilfe)
  if (verb === 'help' || verb === 'k') {
    return { kind: 'show-help' };
  }

  // reset [-all] [-y]
  if (verb === 'reset') {
    const flags = new Set(lower.slice(1));
    const isAll = flags.has('-all') || flags.has('--all');
    const skipConfirm = flags.has('-y') || flags.has('--yes');
    if (isAll) return { kind: 'reset-all', skipConfirm };
    return { kind: 'reset-here' };
  }

  // export [-enc]
  if (verb === 'export') {
    const flags = new Set(lower.slice(1));
    const encrypted = flags.has('-enc') || flags.has('--enc');
    return { kind: 'export-workspace', encrypted };
  }

  // import — File-Picker oeffnet sich, IMX-Detect im UI-Hook.
  if (verb === 'import') {
    return { kind: 'import-workspace' };
  }

  // Known-but-unsupported verbs.
  const stubs = ['w', 's', 'sc', 'c', 'move', 'delete', 'cl-to-card', 'fa', 'fi', 'fh', 'fc'];
  if (stubs.includes(verb)) {
    return { kind: 'unsupported', verb };
  }

  // Kein bekanntes Verb UND nur ein Token UND das Token sieht wie ein Alias
  // aus (a-z, 0-9) — als Navigation interpretieren. Macht ^kuerzel zum
  // "jump to alias"-Shortcut, so wie frueher Ctrl+K / AliasQuicknav.
  if (tokens.length === 1 && /^[a-z0-9]+$/.test(lower[0])) {
    return { kind: 'navigate', alias: lower[0] };
  }

  return { kind: 'unknown', raw };
}

// Ergebnis einer Command-Ausfuehrung. Der Caller (CommandPalette)
// entscheidet, ob bei success die Palette schliesst und navigiert.
export type CommandOutcome =
  | { ok: true; message?: string; navigateTo?: string }
  | { ok: false; message: string };

// Side-Effect-Callbacks fuer Commands, die eine UI-Aktion ausloesen
// (Popup, Sekundaer-Prompt). Das executor-Framework ruft sie, statt
// das Outcome mit discriminierten Varianten zu verunreinigen.
export type CommandUiHooks = {
  onShowHelp: () => void;
  onOpenDocs: () => void;
  onColPick: (args: {
    cardId: string;
    cardLabel: string;
    boardId: string;
    boardLabel: string;
    cols: Array<{ id: string; label: string }>;
  }) => void;
  // Navigation: die Palette uebergibt dispatch-Logik (Router + Cell-Focus-
  // Restore + window.open fuer Links). Rueckgabe entscheidet ob die Palette
  // nach Dispatch schliesst (ok) oder eine Fehlermeldung anzeigt (msg).
  onNavigateAlias: (alias: string) => Promise<{ ok: true } | { ok: false; msg: string }>;
  // reset-here / reset-all: Palette delegiert den destruktiven Flow
  // inkl. optionalem Export-Prompt an die UI-Schicht. Rueckgabe true
  // wenn ausgefuehrt, false wenn abgebrochen (Fehler gehen via throw).
  onResetHere: () => Promise<boolean>;
  onResetAll: (skipConfirm: boolean) => Promise<boolean>;
  // Workspace-weiter Export: UI-Hook holt downloadWorkspaceExport,
  // ggf. mit Passphrase-Prompt bei encrypted=true. Rueckgabe true =
  // ausgefuehrt, false = abgebrochen.
  onExportWorkspace: (encrypted: boolean) => Promise<boolean>;
  // Workspace-weiter Import: oeffnet File-Picker, liest IMX/JSON,
  // delegiert an die import-Pipeline. Rueckgabe analog.
  onImportWorkspace: () => Promise<boolean>;
};

export type CommandContext = {
  workspaceId: string;
  currentNode: NodeRow | undefined;
  // Fuer ^reset ohne -all: Zelle/Feature, auf dem der User gerade
  // steht. Beide optional — wenn keins gesetzt, bezieht sich `reset-
  // here` auf currentNode (Matrix / Board).
  currentCellId?: string;
  currentFeature?: 'info' | 'checklists' | 'docs';
  ui: CommandUiHooks;
};

export async function executeCommand(
  cmd: ParsedCommand,
  ctx: CommandContext,
): Promise<CommandOutcome> {
  if (cmd.kind === 'unknown') {
    return { ok: false, message: `Unbekannter Command: ${cmd.raw}` };
  }
  if (cmd.kind === 'unsupported') {
    return {
      ok: false,
      message: `"^${cmd.verb}" kommt in einem spaeteren Sprint.`,
    };
  }

  if (cmd.kind === 'new-card') return execNewCard(cmd, ctx);
  if (cmd.kind === 'copy') return execCopy(cmd, ctx);
  if (cmd.kind === 'move-card') return execMoveCard(cmd, ctx);
  if (cmd.kind === 'delete-alias') return execDeleteAlias(cmd, ctx);
  if (cmd.kind === 'rename-alias') return execRenameAlias(cmd, ctx);

  if (cmd.kind === 'new-doc') {
    ctx.ui.onOpenDocs();
    return { ok: true };
  }
  if (cmd.kind === 'show-help') {
    ctx.ui.onShowHelp();
    return { ok: true };
  }
  if (cmd.kind === 'reset-here') {
    try {
      const ok = await ctx.ui.onResetHere();
      if (!ok) return { ok: false, message: 'Abgebrochen.' };
      return { ok: true, message: 'Ebene geleert.' };
    } catch (err) {
      return { ok: false, message: translateDbError(err) };
    }
  }
  if (cmd.kind === 'reset-all') {
    try {
      const ok = await ctx.ui.onResetAll(cmd.skipConfirm);
      if (!ok) return { ok: false, message: 'Abgebrochen.' };
      return { ok: true, message: 'Workspace geleert.' };
    } catch (err) {
      return { ok: false, message: translateDbError(err) };
    }
  }
  if (cmd.kind === 'export-workspace') {
    try {
      const ok = await ctx.ui.onExportWorkspace(cmd.encrypted);
      if (!ok) return { ok: false, message: 'Abgebrochen.' };
      return {
        ok: true,
        message: cmd.encrypted ? 'Verschluesselt exportiert.' : 'Exportiert.',
      };
    } catch (err) {
      return { ok: false, message: translateDbError(err) };
    }
  }
  if (cmd.kind === 'import-workspace') {
    try {
      const ok = await ctx.ui.onImportWorkspace();
      if (!ok) return { ok: false, message: 'Abgebrochen.' };
      return { ok: true, message: 'Importiert.' };
    } catch (err) {
      return { ok: false, message: translateDbError(err) };
    }
  }
  if (cmd.kind === 'navigate') {
    const res = await ctx.ui.onNavigateAlias(cmd.alias);
    if (res.ok) return { ok: true };
    return { ok: false, message: res.msg };
  }

  return { ok: false, message: 'Command nicht erkannt.' };
}

async function execNewCard(
  cmd: Extract<ParsedCommand, { kind: 'new-card' }>,
  ctx: CommandContext,
): Promise<CommandOutcome> {
  const node = ctx.currentNode;
  if (!node || node.type !== 'board') {
    return {
      ok: false,
      message: 'Neue Karten nur in einem Board. Zum Board navigieren und nochmal.',
    };
  }

  try {
    const content = await fetchBoardContent(node.id, ctx.workspaceId);
    const firstCol = content.kbCols[0];
    if (!firstCol) {
      return { ok: false, message: 'Board hat keine Spalte. Erst eine Spalte anlegen.' };
    }

    const card = await addCard({
      workspaceId: ctx.workspaceId,
      boardId: node.id,
      colId: firstCol.id,
      name: '',
    });

    if (cmd.alias) {
      try {
        await setCardAlias(card.id, cmd.alias);
      } catch (err) {
        return {
          ok: true,
          message: `Karte angelegt, Alias "${cmd.alias}" konnte nicht gesetzt werden: ${translateDbError(err)}`,
        };
      }
    }

    return {
      ok: true,
      message: cmd.alias
        ? `Karte "^${cmd.alias}" in "${node.label}" angelegt.`
        : `Karte in "${node.label}" angelegt.`,
    };
  } catch (err) {
    return { ok: false, message: translateDbError(err) };
  }
}

async function execCopy(
  cmd: Extract<ParsedCommand, { kind: 'copy' }>,
  ctx: CommandContext,
): Promise<CommandOutcome> {
  // Source resolven (muss Board sein).
  const srcOutcome = await resolveAlias(cmd.source, ctx.workspaceId);
  if (!srcOutcome.ok) {
    return { ok: false, message: `Quelle "^${cmd.source}": ${srcOutcome.msg}` };
  }
  if (srcOutcome.result.kind !== 'node' || srcOutcome.result.nodeType !== 'board') {
    return {
      ok: false,
      message: `^copy unterstuetzt zur Zeit nur Board-Quellen. "^${cmd.source}" ist kein Board.`,
    };
  }
  const srcBoardId = srcOutcome.result.nodeId;

  // Target: explizit oder aktueller Node (muss Board sein).
  let tgtBoardId: string;
  let tgtLabel: string;
  if (cmd.target) {
    const tgtOutcome = await resolveAlias(cmd.target, ctx.workspaceId);
    if (!tgtOutcome.ok) {
      return { ok: false, message: `Ziel "^${cmd.target}": ${tgtOutcome.msg}` };
    }
    if (tgtOutcome.result.kind !== 'node' || tgtOutcome.result.nodeType !== 'board') {
      return {
        ok: false,
        message: `Ziel "^${cmd.target}" ist kein Board.`,
      };
    }
    tgtBoardId = tgtOutcome.result.nodeId;
    tgtLabel = tgtOutcome.result.label;
  } else {
    if (!ctx.currentNode || ctx.currentNode.type !== 'board') {
      return {
        ok: false,
        message: 'Kein Ziel angegeben und aktueller Node ist kein Board.',
      };
    }
    tgtBoardId = ctx.currentNode.id;
    tgtLabel = ctx.currentNode.label;
  }

  if (srcBoardId === tgtBoardId) {
    return {
      ok: false,
      message: 'Quelle und Ziel sind identisch — nichts zu kopieren.',
    };
  }

  // Quell-Checklisten laden + clonen.
  try {
    const src = await fetchBoardContent(srcBoardId, ctx.workspaceId);
    if (src.checklists.length === 0) {
      return { ok: false, message: 'Quelle hat keine Checklisten.' };
    }

    let clonedCount = 0;
    for (const cl of src.checklists) {
      const newCl = await addChecklist({
        workspaceId: ctx.workspaceId,
        boardId: tgtBoardId,
        label: `${cl.label || 'Checkliste'} (Kopie)`,
      });
      const items = src.checklistItems
        .filter((it) => it.checklist_id === cl.id)
        .sort((a, b) => a.position - b.position);
      for (const it of items) {
        await addChecklistItem({
          workspaceId: ctx.workspaceId,
          checklistId: newCl.id,
          text: it.text,
          level: it.level,
        });
      }
      clonedCount += 1;
    }

    return {
      ok: true,
      message: `${clonedCount} Checkliste(n) in "${tgtLabel}" geklont.`,
    };
  } catch (err) {
    return { ok: false, message: translateDbError(err) };
  }
}

// ─── Sprint 2: move-card / del / ren ─────────────────────────────

async function execMoveCard(
  cmd: Extract<ParsedCommand, { kind: 'move-card' }>,
  ctx: CommandContext,
): Promise<CommandOutcome> {
  // Card resolven.
  const cardOutcome = await resolveAlias(cmd.cardAlias, ctx.workspaceId);
  if (!cardOutcome.ok) {
    return { ok: false, message: `Karte "^${cmd.cardAlias}": ${cardOutcome.msg}` };
  }
  if (cardOutcome.result.kind !== 'card') {
    return {
      ok: false,
      message: `"^${cmd.cardAlias}" ist keine Karte.`,
    };
  }
  const card = cardOutcome.result;

  // Ziel-Board resolven.
  const boardOutcome = await resolveAlias(cmd.targetAlias, ctx.workspaceId);
  if (!boardOutcome.ok) {
    return { ok: false, message: `Ziel "^${cmd.targetAlias}": ${boardOutcome.msg}` };
  }
  if (boardOutcome.result.kind !== 'node' || boardOutcome.result.nodeType !== 'board') {
    return {
      ok: false,
      message: `Ziel "^${cmd.targetAlias}" ist kein Board.`,
    };
  }
  const board = boardOutcome.result;

  if (card.boardId === board.nodeId) {
    return {
      ok: false,
      message: 'Karte ist bereits in diesem Board.',
    };
  }

  // Ziel-Spalten laden.
  let content: Awaited<ReturnType<typeof fetchBoardContent>>;
  try {
    content = await fetchBoardContent(board.nodeId, ctx.workspaceId);
  } catch (err) {
    return { ok: false, message: translateDbError(err) };
  }
  const cols = content.kbCols;
  if (cols.length === 0) {
    return { ok: false, message: `Board "${board.label}" hat keine Spalte.` };
  }

  // Spalten-Resolution: explizit per Name, sonst Auto/Picker.
  let targetCol: (typeof cols)[number] | undefined;
  if (cmd.colName) {
    const wanted = cmd.colName.toLowerCase();
    targetCol =
      cols.find((c) => (c.label || '').toLowerCase() === wanted) ||
      cols.find((c) => (c.label || '').toLowerCase().startsWith(wanted));
    if (!targetCol) {
      const list = cols.map((c) => `"${c.label || '(leer)'}"`).join(', ');
      return {
        ok: false,
        message: `Spalte "${cmd.colName}" nicht gefunden. Vorhanden: ${list}.`,
      };
    }
  } else if (cols.length === 1) {
    targetCol = cols[0];
  } else {
    // Col-Picker-UI ausloesen. Der User waehlt, Palette-Flow endet hier.
    ctx.ui.onColPick({
      cardId: card.cardId,
      cardLabel: card.name,
      boardId: board.nodeId,
      boardLabel: board.label,
      cols: cols.map((c) => ({ id: c.id, label: c.label || '(leer)' })),
    });
    return {
      ok: true,
      message: `Spalte in "${board.label}" waehlen…`,
    };
  }

  // Position ans Ende der Ziel-Spalte.
  const posInCol = content.kbCards
    .filter((c) => c.col_id === targetCol!.id)
    .reduce((max, c) => Math.max(max, c.position ?? 0), -1);

  try {
    await moveCardToBoard(card.cardId, board.nodeId, targetCol.id, posInCol + 1);
    return {
      ok: true,
      message: `Karte "${card.name}" in "${board.label}" / "${targetCol.label || '(leer)'}" verschoben.`,
    };
  } catch (err) {
    return { ok: false, message: translateDbError(err) };
  }
}

// Liefert ein Display-Label fuer einen resolvten Alias (fuer Toasts +
// Confirms). "Card" heisst name, "Doc" heisst title, Node heisst label,
// Checklist analog.
function describeResult(result: AliasResolveResult): {
  typeLabel: string;
  displayLabel: string;
} {
  switch (result.kind) {
    case 'node':
      return {
        typeLabel: result.nodeType === 'matrix' ? 'Matrix' : 'Board',
        displayLabel: result.label || '(ohne Label)',
      };
    case 'card':
      return { typeLabel: 'Karte', displayLabel: result.name || '(ohne Name)' };
    case 'checklist-board':
    case 'checklist-cell':
      return { typeLabel: 'Checkliste', displayLabel: result.label || '(ohne Label)' };
    case 'doc':
      return { typeLabel: 'Doku', displayLabel: result.title || '(ohne Titel)' };
    case 'cell':
      return { typeLabel: 'Zelle', displayLabel: '(Zelle)' };
    case 'link':
      return { typeLabel: 'Link', displayLabel: result.label || '(ohne Label)' };
  }
}

async function execDeleteAlias(
  cmd: Extract<ParsedCommand, { kind: 'delete-alias' }>,
  ctx: CommandContext,
): Promise<CommandOutcome> {
  const r = await resolveAlias(cmd.alias, ctx.workspaceId);
  if (!r.ok) return { ok: false, message: `"^${cmd.alias}": ${r.msg}` };
  const info = describeResult(r.result);

  // Unterstuetzte Kinds festlegen.
  const kind = r.result.kind;
  if (kind === 'cell' || kind === 'link') {
    return {
      ok: false,
      message: `${info.typeLabel}-Loeschung per ^del nicht unterstuetzt.`,
    };
  }

  // Confirm-Dialog. Bei Node besonders warnen (Subtree).
  const message =
    kind === 'node'
      ? `${info.typeLabel} "${info.displayLabel}" (^${cmd.alias}) loeschen? Alle darunter liegenden Nodes, Zellen und Karten verschwinden mit.`
      : `${info.typeLabel} "${info.displayLabel}" (^${cmd.alias}) loeschen?`;
  const ok = await showConfirm({
    title: `${info.typeLabel} loeschen?`,
    message,
    variant: 'danger',
    confirmLabel: 'Loeschen',
  });
  if (!ok) {
    return { ok: false, message: 'Abgebrochen.' };
  }

  try {
    if (r.result.kind === 'node') await deleteNode(r.result.nodeId);
    else if (r.result.kind === 'card') await delCard(r.result.cardId);
    else if (r.result.kind === 'checklist-board') await delChecklist(r.result.checklistId);
    else if (r.result.kind === 'checklist-cell') await delChecklist(r.result.checklistId);
    else if (r.result.kind === 'doc') await delDoc(r.result.docId);
    return {
      ok: true,
      message: `${info.typeLabel} "${info.displayLabel}" geloescht.`,
    };
  } catch (err) {
    return { ok: false, message: translateDbError(err) };
  }
}

async function execRenameAlias(
  cmd: Extract<ParsedCommand, { kind: 'rename-alias' }>,
  ctx: CommandContext,
): Promise<CommandOutcome> {
  const r = await resolveAlias(cmd.alias, ctx.workspaceId);
  if (!r.ok) return { ok: false, message: `"^${cmd.alias}": ${r.msg}` };
  const info = describeResult(r.result);
  const trimmed = cmd.label.trim();
  if (!trimmed) return { ok: false, message: 'Neuer Name darf nicht leer sein.' };

  try {
    if (r.result.kind === 'node') {
      await renameNode(r.result.nodeId, trimmed);
    } else if (r.result.kind === 'card') {
      await renameCard(r.result.cardId, trimmed);
    } else if (r.result.kind === 'checklist-board') {
      await renameChecklist(r.result.checklistId, trimmed);
    } else if (r.result.kind === 'checklist-cell') {
      await renameChecklist(r.result.checklistId, trimmed);
    } else if (r.result.kind === 'doc') {
      await setDocTitle(r.result.docId, trimmed);
    } else {
      return {
        ok: false,
        message: `${info.typeLabel}-Umbenennung per ^ren nicht unterstuetzt.`,
      };
    }
    return {
      ok: true,
      message: `${info.typeLabel} "${info.displayLabel}" → "${trimmed}".`,
    };
  } catch (err) {
    return { ok: false, message: translateDbError(err) };
  }
}

// Bequemer Toast-Wrapper fuer die Palette.
export function reportOutcome(outcome: CommandOutcome): void {
  if (outcome.ok && outcome.message) {
    showToast(outcome.message, 'success');
  } else if (!outcome.ok) {
    showToast(outcome.message, 'error');
  }
}
