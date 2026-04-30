// Cross-Table-Alias-Preflight.
//
// Die DB hat pro Tabelle einen Unique-Index auf (workspace_id, lower(alias)),
// aber KEINEN Cross-Table-Constraint. Zwei unterschiedliche Entitaeten
// (z.B. eine Karte und eine Zelle) duerfen DB-technisch denselben Alias
// tragen, was dem Konzept "^alias ist eindeutig im Workspace" widerspricht.
//
// Dieser Helper prueft VOR dem Write gegen alle 5 Alias-Tabellen. Wird ein
// Konflikt gefunden, kann der Caller einen eigenen Toast + Shake bauen,
// ohne auf die DB-23505-Runde warten zu muessen.

import { supabase } from './supabase';

export type AliasTable = 'cells' | 'nodes' | 'kb_cards' | 'checklists' | 'links' | 'docs';

const TABLES: AliasTable[] = ['cells', 'nodes', 'kb_cards', 'checklists', 'links', 'docs'];

export const ALIAS_TABLE_LABEL: Record<AliasTable, string> = {
  cells: 'Zelle',
  nodes: 'Matrix/Board',
  kb_cards: 'Karte',
  checklists: 'Checkliste',
  links: 'Link',
  docs: 'Doku',
};

// Liefert die Tabelle, in der der Alias schon vergeben ist — oder null.
// Bei `exclude` (Selbst-Update) wird der eigene Datensatz ignoriert.
//
// Wildcard-Hinweis: alle Aufrufer reichen `args.alias` durch
// `validateAliasFormat` (siehe lib/alias.ts) — ALIAS_RE = /^[a-z0-9]+$/
// laesst weder `%` noch `_` durch. Die ilike()-Calls unten sind damit
// ohne explizites escape sicher. Wer den Helper extern aufruft, muss
// die Format-Garantie selbst halten.
export async function findAliasConflict(args: {
  workspaceId: string;
  alias: string;
  exclude?: { table: AliasTable; id: string };
}): Promise<AliasTable | null> {
  const a = args.alias.trim();
  if (!a) return null;

  const results = await Promise.all(
    TABLES.map(async (t) => {
      // Phase 4 T.1.D: Karten-Alias liegt in tasks.attrs.alias, nicht
      // mehr in einer kb_cards-Spalte. AliasTable bleibt 'kb_cards' fuer
      // das UI-Label ("Karte"); intern leiten wir auf tasks um.
      const dbTable = t === 'kb_cards' ? 'tasks' : t;
      const aliasFilter = t === 'kb_cards' ? 'attrs->>alias' : 'alias';
      let q = supabase
        .from(dbTable)
        .select('id')
        .eq('workspace_id', args.workspaceId)
        .ilike(aliasFilter, a)
        .limit(1);
      if (args.exclude && args.exclude.table === t) {
        q = q.neq('id', args.exclude.id);
      }
      const { data, error } = await q;
      if (error) return null; // leise; DB-Unique faengt weiterhin ab
      return data && data.length > 0 ? t : null;
    }),
  );
  return results.find((r) => r !== null) ?? null;
}
