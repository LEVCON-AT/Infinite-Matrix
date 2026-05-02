// Zentrale Alias-Validierung. Single source of truth — ALLE Alias-Inputs
// im Client laufen hier durch, bevor sie in die DB geschrieben werden.
//
// Vorbild: Alt-Client validateAlias(alias, excludeAlias) + rebuildAliasIndex.
// Dort wird ein global-im-Workspace aggregierter Index gepflegt; bei uns
// fragt findAliasConflict die 5 Alias-Tabellen parallel ab — nicht Hot-
// Path (Alias wird selten gesetzt), Korrektheit vor Performance.
//
// Deckt Cross-Type-Konflikte ab: ein "abc"-Alias darf nicht gleichzeitig
// Node, Cell, Card, Checklist und Link sein — alle leben im gleichen
// Alias-Namespace.

import { ALIAS_TABLE_LABEL, type AliasTable, findAliasConflict } from './alias-check';

// Welle D: 8-Zeichen-Limit gefallen, Hyphen erlaubt fuer datierte
// Doku-Aliases (z.B. `kunde-mueller-d020526`). Bindestrich darf nicht
// am Anfang/Ende stehen + nicht doppelt — sauberer Slug-Stil.
// 64 als Sanity-Upper-Bound (DB-Spalte ist text, Index-Performance bei
// rar-langen Aliases unproblematisch).
export const ALIAS_MAX_LEN = 64;
// Validierungs-Form: matched ein KOMPLETTER Alias-String von Anfang bis Ende.
// Muss mit a-z/0-9 anfangen UND aufhoeren; dazwischen optional Hyphen-
// separierte Zeichen.
export const ALIAS_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
// Render-Form: matched ein `^alias`-Token im Fliesstext (g+i fuer alle
// Vorkommen, case-insensitive Eingabe). Konsumenten setzen
// `lastIndex = 0` vor jedem Iteration-Lauf — siehe AliasText/
// markdown-lite/alias-tokenizer.
export const ALIAS_REF_RE = /\^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)/gi;
// `admin` ist reserviert seit Welle B.0 — ^admin navigiert zur
// Plattform-Admin-Konsole. User koennen ihn deshalb nicht auf eigene
// Atome legen.
export const RESERVED_ALIASES = ['n', 'fa', 'fi', 'fh', 'fc', 'home', 'w', 's', 'admin'];

export type AliasOwnerType = 'node' | 'cell' | 'card' | 'checklist' | 'link' | 'doc';

export type AliasOwner = {
  type: AliasOwnerType;
  id: string; // self-ID, wird beim Unique-Check ausgeschlossen
};

export type AliasValidationResult =
  | { ok: true; canonical: string | null }
  | { ok: false; msg: string };

const OWNER_TO_TABLE: Record<AliasOwnerType, AliasTable> = {
  node: 'nodes',
  cell: 'cells',
  card: 'kb_cards',
  checklist: 'checklists',
  link: 'links',
  doc: 'docs',
};

// Nur-Format-Check. Gibt canonical zurueck (lowercase/trim) oder msg.
// Leer/null => {ok:true, canonical:null} — Alias wird geleert, DB erlaubt das.
export function validateAliasFormat(raw: string | null): AliasValidationResult {
  if (raw == null) return { ok: true, canonical: null };
  const a = String(raw).toLowerCase().trim();
  if (!a) return { ok: true, canonical: null };
  if (a.length > ALIAS_MAX_LEN) {
    return { ok: false, msg: `Alias max ${ALIAS_MAX_LEN} Zeichen.` };
  }
  if (!ALIAS_RE.test(a)) {
    return {
      ok: false,
      msg: 'Alias: a-z, 0-9 und Bindestrich (nicht am Anfang/Ende).',
    };
  }
  if (RESERVED_ALIASES.includes(a)) {
    return { ok: false, msg: `"${a}" ist reserviert.` };
  }
  return { ok: true, canonical: a };
}

// Vollstaendige Validierung (Format + cross-table Uniqueness). Aufrufer
// ruft das VOR dem setAlias-Mutations-Call. Bei ok=true koennen sie den
// canonical-Wert direkt in die DB schreiben. Leere Aliase (canonical=null)
// skippen den Unique-Check.
export async function validateAlias(
  raw: string | null,
  workspaceId: string,
  owner: AliasOwner,
): Promise<AliasValidationResult> {
  const format = validateAliasFormat(raw);
  if (!format.ok) return format;
  if (format.canonical == null) return format;

  const ownerTable = OWNER_TO_TABLE[owner.type];
  const conflict = await findAliasConflict({
    workspaceId,
    alias: format.canonical,
    exclude: { table: ownerTable, id: owner.id },
  });
  if (conflict) {
    return {
      ok: false,
      msg: `Alias ist bereits bei einer ${ALIAS_TABLE_LABEL[conflict]} im Workspace vergeben.`,
    };
  }
  return format;
}
