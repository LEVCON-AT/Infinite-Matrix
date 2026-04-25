// Tokenizer fuer `^alias`-Referenzen im Fliesstext. Single source of
// truth fuer die Render-Pipeline — sowohl AliasText (Plain-Text-Renderer
// fuer Checklisten-Items etc.) als auch markdown-lite (Markdown-Light-
// Parser fuer Node-Descriptions) bauen darauf auf.
//
// Output-Shape ist absichtlich generisch (kind: 'text'|'alias'), damit
// die Konsumenten in ihre eigenen Internal-Typen mappen koennen — das
// vermeidet eine harte Kopplung zwischen Markdown-AST und Plain-Token.

import { ALIAS_REF_RE } from './alias';

export type AliasToken = { kind: 'text'; value: string } | { kind: 'alias'; alias: string };

export function tokenizeAliasText(input: string): AliasToken[] {
  const out: AliasToken[] = [];
  if (!input) return out;
  let last = 0;
  ALIAS_REF_RE.lastIndex = 0;
  while (true) {
    const m = ALIAS_REF_RE.exec(input);
    if (m === null) break;
    if (m.index > last) {
      out.push({ kind: 'text', value: input.slice(last, m.index) });
    }
    out.push({ kind: 'alias', alias: m[1].toLowerCase() });
    last = m.index + m[0].length;
  }
  if (last < input.length) {
    out.push({ kind: 'text', value: input.slice(last) });
  }
  return out;
}
