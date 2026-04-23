// Command-Palette: parseCommand portiert aus client/matrix_tool_beta.html
// (dort `parseCommand` + `executeCommand`).
//
// Die Palette akzeptiert Commands ohne fuehrenden ^ — das Prefix ist
// Input-Kosmetik (ein separater `^`-Badge vor dem Input zeigt dem User
// den Kontext, wie bei AliasQuicknav).
//
// Commands in Sprint 1:
//   n <alias>               — neue Karte im aktuellen Board, Alias optional
//   copy <src> [dst]        — klont alle Checklisten eines Boards in ein
//                             anderes Board (dst leer = aktuelles Board)
//
// Stubs (bekannte Verben aus dem Vorbild, noch nicht implementiert):
//   w, s, k, sc, c, move, delete, cl-to-card, fa, fi, fh, fc
//   → liefern ein `unsupported`-Ergebnis, damit der User eine freundliche
//     Meldung sieht statt eines generischen "unbekannt"-Fehlers.

import type { NodeRow } from './types';
import { addCard, setCardAlias, addChecklist, addChecklistItem } from './mutations';
import { fetchBoardContent } from './queries';
import { resolveAlias } from './alias-resolve';
import { showToast } from './toasts';
import { translateDbError } from './errors';

export type ParsedCommand =
  | { kind: 'new-card'; alias: string | null }
  | {
      kind: 'move-card';
      cardAlias: string;
      targetAlias: string;
      colName: string | null;
    }
  | { kind: 'copy'; source: string; target: string | null }
  | { kind: 'unsupported'; verb: string }
  | { kind: 'unknown'; raw: string };

export function parseCommand(raw: string): ParsedCommand | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Fuehrendes ^ dulden — User tippt's oft reflexartig.
  const stripped = trimmed.startsWith('^') ? trimmed.slice(1) : trimmed;
  const parts = stripped.toLowerCase().split(/\s+/);
  if (!parts[0]) return null;

  // n cardAlias -m targetAlias [colName]
  if (parts[0] === 'n' && parts.length >= 4 && parts[2] === '-m') {
    return {
      kind: 'move-card',
      cardAlias: parts[1],
      targetAlias: parts[3],
      colName: parts.slice(4).join(' ') || null,
    };
  }

  // n [alias]
  if (parts[0] === 'n') {
    return { kind: 'new-card', alias: parts[1] || null };
  }

  // copy src [dst]
  if (parts[0] === 'copy') {
    if (!parts[1]) return { kind: 'unknown', raw };
    return { kind: 'copy', source: parts[1], target: parts[2] || null };
  }

  // Known-but-unsupported verbs.
  const stubs = [
    'w',
    's',
    'k',
    'sc',
    'c',
    'move',
    'delete',
    'cl-to-card',
    'fa',
    'fi',
    'fh',
    'fc',
  ];
  if (stubs.includes(parts[0])) {
    return { kind: 'unsupported', verb: parts[0] };
  }

  return { kind: 'unknown', raw };
}

// Ergebnis einer Command-Ausfuehrung. Der Caller (CommandPalette)
// entscheidet, ob bei success die Palette schliesst und navigiert.
export type CommandOutcome =
  | { ok: true; message?: string; navigateTo?: string }
  | { ok: false; message: string };

export async function executeCommand(
  cmd: ParsedCommand,
  ctx: {
    workspaceId: string;
    currentNode: NodeRow | undefined;
  },
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

  if (cmd.kind === 'new-card') {
    return execNewCard(cmd, ctx);
  }

  if (cmd.kind === 'copy') {
    return execCopy(cmd, ctx);
  }

  if (cmd.kind === 'move-card') {
    return {
      ok: false,
      message: '"n … -m …" kommt in einem spaeteren Sprint.',
    };
  }

  return { ok: false, message: 'Command nicht erkannt.' };
}

async function execNewCard(
  cmd: Extract<ParsedCommand, { kind: 'new-card' }>,
  ctx: { workspaceId: string; currentNode: NodeRow | undefined },
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
  ctx: { workspaceId: string; currentNode: NodeRow | undefined },
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
    if (
      tgtOutcome.result.kind !== 'node' ||
      tgtOutcome.result.nodeType !== 'board'
    ) {
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

// Bequemer Toast-Wrapper fuer die Palette.
export function reportOutcome(outcome: CommandOutcome): void {
  if (outcome.ok && outcome.message) {
    showToast(outcome.message, 'success');
  } else if (!outcome.ok) {
    showToast(outcome.message, 'error');
  }
}
