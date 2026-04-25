// Close-Actions fuer Checklisten: was passiert, nachdem eine Checkliste
// abgeschlossen (snapshotted + items weggeraeumt) wurde. Vier Typen:
//
//   - toast:   kurzer Info-Toast mit konfigurierbarem Text
//   - jump:    zu einem Alias springen (resolve + dispatch)
//   - webhook: POST an eine externe URL (best-effort, CORS-abhaengig)
//   - mail:    oeffnet einen mailto:-Link (reisst das Mail-Programm hoch)
//
// Die Config lebt in `checklists.action` (jsonb). Ist `action` null
// oder `{type:'none'}`, passiert nichts — default-Fall.

import { dispatchAliasResult } from './alias-dispatch';
import { resolveAlias } from './alias-resolve';
import { showToast } from './toasts';
import { sanitizeUrl } from './url';

export type ChecklistAction =
  | { type: 'none' }
  | { type: 'toast'; message?: string }
  | { type: 'jump'; target: string } // alias (mit oder ohne ^)
  | { type: 'webhook'; url: string; message?: string }
  | { type: 'mail'; to: string; subject?: string };

// Lose Parsing — jsonb-Row kann schema-drift haben. Fehlt `type`,
// gibt's `none`.
export function parseChecklistAction(raw: unknown): ChecklistAction {
  if (!raw || typeof raw !== 'object') return { type: 'none' };
  const r = raw as Record<string, unknown>;
  const t = typeof r.type === 'string' ? r.type : 'none';
  switch (t) {
    case 'toast':
      return { type: 'toast', message: typeof r.message === 'string' ? r.message : '' };
    case 'jump':
      return { type: 'jump', target: typeof r.target === 'string' ? r.target : '' };
    case 'webhook':
      return {
        type: 'webhook',
        url: typeof r.url === 'string' ? r.url : '',
        message: typeof r.message === 'string' ? r.message : '',
      };
    case 'mail':
      return {
        type: 'mail',
        to: typeof r.to === 'string' ? r.to : '',
        subject: typeof r.subject === 'string' ? r.subject : '',
      };
    default:
      return { type: 'none' };
  }
}

type ExecuteDeps = {
  workspaceId: string;
  checklistLabel: string;
  navigate: (path: string) => void;
};

export async function executeChecklistAction(
  action: ChecklistAction,
  deps: ExecuteDeps,
): Promise<void> {
  switch (action.type) {
    case 'none':
      return;
    case 'toast': {
      const msg = action.message?.trim() || `Checkliste "${deps.checklistLabel}" abgeschlossen.`;
      showToast(msg, 'info');
      return;
    }
    case 'jump': {
      const out = await resolveAlias(action.target, deps.workspaceId);
      if (!out.ok) {
        showToast(`Close-Jump: ${out.msg}`, 'error');
        return;
      }
      dispatchAliasResult(out.result, {
        workspaceId: deps.workspaceId,
        navigate: deps.navigate,
        onError: (msg) => showToast(msg, 'error'),
      });
      return;
    }
    case 'webhook': {
      const url = sanitizeUrl(action.url);
      if (!url) {
        showToast('Close-Webhook: URL ungueltig.', 'error');
        return;
      }
      // Timeout via AbortController: ein haengender Fetch darf den UI-
      // Thread nicht binden. 5 s ist grosszuegig fuer typische Webhooks.
      const ctrl = new AbortController();
      const timer = window.setTimeout(() => ctrl.abort(), 5000);
      try {
        await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            event: 'checklist.close',
            checklist: deps.checklistLabel,
            message: action.message ?? '',
            at: new Date().toISOString(),
          }),
          signal: ctrl.signal,
        });
      } catch {
        // Best-effort — Webhook-Fehler (CORS, Netz, 500, Timeout) sollen
        // den Close-Flow nicht brechen. Der Nutzer sieht, dass die
        // Checkliste trotzdem abgeschlossen ist.
        showToast('Close-Webhook konnte nicht erreicht werden.', 'error');
      } finally {
        window.clearTimeout(timer);
      }
      return;
    }
    case 'mail': {
      const to = action.to.trim();
      if (!to) {
        showToast('Close-Mail: keine Adresse konfiguriert.', 'error');
        return;
      }
      const subj = encodeURIComponent(
        action.subject?.trim() || `Checkliste ${deps.checklistLabel} abgeschlossen`,
      );
      const href = `mailto:${encodeURIComponent(to)}?subject=${subj}`;
      window.location.href = href;
      return;
    }
  }
}
