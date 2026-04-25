// Shared Hook-Builder fuer Workspace-weite Export/Import-Commands.
// Wird sowohl von der CommandPalette als auch von der HeaderSearchBar
// verwendet, damit ^export / ^import in beiden Entry-Points exakt
// gleich greifen — ohne Code-Duplizierung.
//
// Der Caller reicht den Workspace-Kontext + (optional) den aktuellen
// Node, weil ^import einen Anker als Ziel-Matrix braucht. Rueckgabe-
// Typen passen 1:1 in CommandUiHooks.

import type { NodeRow } from './types';
import { showChoice, showPrompt } from './dialog';
import { showToast } from './toasts';
import { translateDbError } from './errors';
import { decryptPayload, isEncrypted } from './crypto';
import {
  downloadWorkspaceExport,
  exportWorkspace,
  summarizeExport,
} from './export';
import {
  executeSubtreeImportIntoMatrix,
  parseImportPayload,
  type ImportMode,
} from './subtree-import';
import { startProgress, endProgress } from './progress';

// File-Picker als Promise. Erstellt ein temporaeres <input>, oeffnet
// den Picker, resolvt mit der gewaehlten Datei oder null bei Abbruch.
// Kein Dauer-DOM-Slot noetig — Caller koennen es jederzeit aufrufen.
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    document.body.appendChild(input);
    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      input.remove();
    };
    input.addEventListener('change', () => {
      const f = input.files?.[0] ?? null;
      cleanup();
      resolve(f);
    });
    // 'cancel'-Event ist Chrome 113+ — auf aelteren Browsern kommt
    // einfach nichts; der Timer-Fallback unten greift dann.
    input.addEventListener('cancel', () => {
      cleanup();
      resolve(null);
    });
    setTimeout(() => {
      if (settled) return;
      cleanup();
      resolve(null);
    }, 30000);
    input.click();
  });
}

export async function exportWorkspaceWithUi(args: {
  workspaceId: string;
  encrypted: boolean;
}): Promise<boolean> {
  let passphrase: string | null = null;
  if (args.encrypted) {
    passphrase = await showPrompt({
      title: 'Verschluesselt exportieren',
      message:
        'Passphrase fuer die .imx-Datei. Ohne diese Passphrase ist der Export nicht mehr lesbar — sicher aufbewahren.',
      placeholder: 'Passphrase…',
      confirmLabel: 'Exportieren',
      inputType: 'password',
    });
    if (passphrase === null) return false;
    if (!passphrase.trim()) {
      showToast('Passphrase darf nicht leer sein.', 'error');
      return false;
    }
  }
  try {
    const data = await exportWorkspace(args.workspaceId);
    const wsName =
      typeof (data.workspace as { name?: unknown }).name === 'string'
        ? ((data.workspace as { name: string }).name)
        : 'workspace';
    await downloadWorkspaceExport(
      data,
      wsName,
      passphrase ? { passphrase } : undefined,
    );
    showToast(
      `${args.encrypted ? 'Verschluesselt e' : 'E'}xportiert — ${summarizeExport(data)}`,
      'success',
    );
    return true;
  } catch (err) {
    showToast(translateDbError(err), 'error');
    return false;
  }
}

export async function importWorkspaceWithUi(args: {
  workspaceId: string;
  currentNode: NodeRow | undefined;
}): Promise<boolean> {
  // V1: braucht eine aktive Matrix als Anker. Workspace-weiter Import
  // wird als Subtree-Import in die aktuelle Matrix umgeleitet — fuer
  // "auf leerer Workspace einlesen" gibt es ^reset -all + danach
  // diesen Befehl.
  if (!args.currentNode || args.currentNode.type !== 'matrix') {
    showToast(
      'Workspace-Import braucht eine aktive Matrix als Ziel. Navigiere zur gewuenschten Matrix und versuch es nochmal.',
      'error',
    );
    return false;
  }
  const targetMatrixId = args.currentNode.id;
  const file = await pickFile('.json,.imx,application/json');
  if (!file) return false;
  let text = await file.text();
  if (isEncrypted(text)) {
    const pw = await showPrompt({
      title: 'Verschluesselter Import',
      message:
        'Diese Datei ist verschluesselt (.imx). Bitte Passphrase eingeben, mit der sie exportiert wurde.',
      placeholder: 'Passphrase…',
      confirmLabel: 'Entschluesseln',
      inputType: 'password',
    });
    if (pw === null) return false;
    try {
      text = await decryptPayload(text, pw);
    } catch (err) {
      showToast(translateDbError(err), 'error');
      return false;
    }
  }
  let payload;
  try {
    payload = parseImportPayload(text);
  } catch (err) {
    showToast(translateDbError(err), 'error');
    return false;
  }
  const summary = summarizeExport(payload);
  const choice = await showChoice({
    title: 'Wie einfuegen?',
    message: `Dieser Export enthaelt: ${summary}.\n\nSoll er an die aktuelle Matrix "${args.currentNode.label}" angehaengt werden, oder die Matrix ersetzen? Beim Ersetzen kannst du optional vorher einen Sicherungs-Export speichern.`,
    choices: [
      { id: 'add', label: 'Hinzufuegen', variant: 'primary' },
      {
        id: 'export-overwrite',
        label: 'Sichern + Ersetzen',
        variant: 'default',
      },
      { id: 'overwrite', label: 'Ersetzen', variant: 'danger' },
      { id: 'cancel', label: 'Abbrechen', variant: 'default' },
    ],
  });
  if (!choice || choice === 'cancel') return false;
  const mode = choice as ImportMode;
  startProgress('Workspace-Import…');
  try {
    await executeSubtreeImportIntoMatrix({
      payload,
      workspaceId: args.workspaceId,
      targetMatrixId,
      mode,
    });
    showToast(`Importiert — ${summary}.`, 'success');
    return true;
  } catch (err) {
    showToast(translateDbError(err), 'error');
    return false;
  } finally {
    endProgress();
  }
}
