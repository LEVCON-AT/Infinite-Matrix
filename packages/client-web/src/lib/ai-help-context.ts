// Context-Snapshot-Builder fuer den Inline-Help-Drawer (A.3).
//
// Promptinj-Mitigation E (Context-Min): nur die NOTWENDIGEN Daten
// landen im LLM-Context, nicht "alles im Workspace". Das verkleinert
// die Injection-Oberflaeche.
//
// Strategie pro Kontext-Tiefe:
//   - Workspace-Root        → workspace_id + Name + Top-Level-Knoten
//                              (kommt vom mcp_get_workspace_context-RPC)
//   - In einer Matrix-Cell  → zusaetzlich Cell-Label + Parent-Knoten-Label
//   - In einer Karte        → zusaetzlich Karten-Name + Spalte
//
// Der Snapshot ist ein kompakter Markdown-String, KEIN JSON-Dump.
// Markdown-light, damit der LLM ihn als Daten lesen kann ohne sich
// in JSON-Schemas zu verheddern.
//
// Mitigation G (Read-Only-Mode) lebt auch hier: shouldUseReadOnlyMode()
// pruefen ob der User auf einer Cell von einem ANDEREN User in einem
// Multi-Member-Workspace ist. UI rendert dann den Drawer im Read-Only-
// Modus (ohne Tool-Calls).

import { fetchMembers } from './members';
import type { CellRow, NodeRow } from './types';

export type HelpContextInput = {
  workspaceId: string;
  workspaceName: string;
  currentNode?: NodeRow | null;
  currentCell?: CellRow | null;
  // Aktueller User-ID, fuer Read-Only-Detection.
  selfUserId: string | null;
};

// Kompakter Markdown-Snapshot des aktuellen Kontextes.
export function buildHelpContext(input: HelpContextInput): string {
  const parts: string[] = [];
  parts.push(`Workspace: **${escapeMd(input.workspaceName)}** (id=${input.workspaceId})`);

  if (input.currentNode) {
    const n = input.currentNode;
    parts.push(`Aktueller Knoten: **${escapeMd(n.label)}** (type=${n.type}, id=${n.id})`);
    if (n.alias) parts.push(`Alias: ^${n.alias}`);
  }

  if (input.currentCell) {
    const c = input.currentCell;
    parts.push(`Aktuelle Zelle: id=${c.id}, matrix_id=${c.matrix_id}`);
    if (c.alias) parts.push(`Cell-Alias: ^${c.alias}`);
    if (c.features && c.features.length > 0) {
      parts.push(`Features: ${c.features.join(', ')}`);
    }
  }

  return parts.join('\n');
}

// Read-Only-Mode (Mitigation G):
// Aktiviert sich wenn:
//   - Workspace hat > 2 aktive Mitglieder
//   - UND aktuelle Cell wurde nicht vom selbst-User erstellt
//
// Im Read-Only-Modus zeigt der Drawer einen Toggle-Button "Action-
// Mode aktivieren" — der LLM darf erst nach explicit-User-Klick
// Tools aufrufen.
//
// Cell hat heute kein created_by (Migration 016 hat nodes.created_by
// hinzugefuegt, nicht cells.created_by). Pragmatisch: wir nutzen
// stattdessen den parent-Node.created_by als Approximation fuer
// "wer hat den Sub-Tree initial gebaut".
export async function shouldUseReadOnlyMode(input: {
  workspaceId: string;
  selfUserId: string | null;
  currentNode?: NodeRow | null;
}): Promise<boolean> {
  if (!input.selfUserId) return false;
  if (!input.currentNode) return false;
  // Wenn der aktuelle Knoten keinen created_by hat (Bridge-Insert),
  // koennen wir nicht entscheiden — lieber Action-Mode (User darf sich
  // selbst entscheiden).
  if (!input.currentNode.created_by) return false;
  // Selbst-erstellt: Action-Mode.
  if (input.currentNode.created_by === input.selfUserId) return false;
  // Multi-Member-Check.
  try {
    const members = await fetchMembers(input.workspaceId);
    const activeCount = members.filter((m) => !m.deactivated_at).length;
    return activeCount > 2;
  } catch {
    // Bei Read-Fehler defensiv: lieber Read-Only.
    return true;
  }
}

function escapeMd(s: string): string {
  return s.replace(/\*/g, '\\*').replace(/_/g, '\\_').replace(/`/g, '\\`');
}
