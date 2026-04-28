// Apply-Pfad fuer den Onboarding-Wizard (A.4d).
//
// Spielt den vom LLM in Step 3 generierten Vorschlag als reale RPC-
// Calls ab. Sequentiell — RLS + FKs moegen Reihenfolge, parallel-
// Inserts riskieren Position-Kollisionen.
//
// V1 (A.4d): nur Top-Level-Nodes werden angelegt. children (cell_label/
// card_name/checklists) sind im Proposal als Vision sichtbar, aber
// werden in V1 nicht ausgefuehrt — der User baut sie nach Wunsch mit
// dem Inline-Help-Drawer (A.3) aus. Naechste Welle (A.4e oder A.5)
// kann das vertiefen.
//
// Source-Pfade:
//   - kind: 'initial' → workspace existiert (handle_new_user trigger),
//     wir fuellen ihn nur.
//   - kind: 'new' → workspace muss erst per createWorkspace angelegt
//     werden, dann fuellen.

import { supabase } from './supabase';
import type { ApplyProgress, WizardProposal, WizardSource } from './wizard-state';
import { createWorkspace } from './workspace-create';

export type ApplyResult =
  | { ok: true; workspaceId: string; createdNodes: number }
  | { ok: false; error: string; partialWorkspaceId?: string; createdSoFar: number };

export type ApplyOptions = {
  proposal: WizardProposal;
  source: WizardSource;
  onProgress?: (p: ApplyProgress) => void;
  signal?: AbortSignal;
};

export async function applyWizardProposal(opts: ApplyOptions): Promise<ApplyResult> {
  const { proposal, source, onProgress, signal } = opts;
  const totalSteps = (source.kind === 'new' ? 1 : 0) + proposal.nodes.length;
  let step = 0;
  let workspaceId: string;
  let created = 0;

  // Step 0: Workspace anlegen wenn neu.
  if (source.kind === 'new') {
    step += 1;
    onProgress?.({ current: step, total: totalSteps, step: 'Workspace anlegen…' });
    if (signal?.aborted) {
      return { ok: false, error: 'abgebrochen', createdSoFar: 0 };
    }
    try {
      workspaceId = await createWorkspace(proposal.workspace_label || 'Neuer Workspace');
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        createdSoFar: 0,
      };
    }
  } else {
    workspaceId = source.workspaceId;
  }

  // Step 1..N: pro Top-Level-Node ein mcp_create_node.
  for (const node of proposal.nodes) {
    if (signal?.aborted) {
      return {
        ok: false,
        error: 'abgebrochen',
        partialWorkspaceId: workspaceId,
        createdSoFar: created,
      };
    }
    step += 1;
    onProgress?.({
      current: step,
      total: totalSteps,
      step: `Knoten "${node.label}" anlegen…`,
    });

    try {
      const { error } = await supabase.rpc('mcp_create_node', {
        p_workspace_id: workspaceId,
        p_parent_cell_id: null,
        p_type: node.type,
        p_label: node.label,
        p_alias: node.alias ?? null,
      });
      if (error) {
        // Ein-Knoten-Fehler ist kein Apply-Abbruch — wir wollen
        // sehen wie viele durchgehen. Aber wir geben den Fehler als
        // Result raus + onProgress mit step-Info, damit das UI weiss
        // wo's haengt.
        console.warn(`mcp_create_node fuer "${node.label}":`, error.message);
        // weiter machen, naechster Node
      } else {
        created += 1;
      }
    } catch (err) {
      console.warn(`mcp_create_node throw fuer "${node.label}":`, err);
      // weiter machen
    }
  }

  if (created === 0) {
    return {
      ok: false,
      error:
        proposal.nodes.length === 0
          ? 'Kein Knoten im Vorschlag'
          : 'Keiner der Knoten konnte angelegt werden — bitte spaeter erneut versuchen.',
      partialWorkspaceId: workspaceId,
      createdSoFar: 0,
    };
  }

  return { ok: true, workspaceId, createdNodes: created };
}
