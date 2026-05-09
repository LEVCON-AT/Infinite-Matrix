// Tokenizer fuer `^alias`-Referenzen + URLs im Fliesstext. Single source
// of truth fuer die Render-Pipeline — sowohl AliasText (Plain-Text-
// Renderer fuer Checklisten-Items etc.) als auch markdown-lite
// (Markdown-Light-Parser fuer Node-Descriptions) bauen darauf auf.
//
// Output-Shape ist absichtlich generisch (kind: 'text'|'alias'|'url'),
// damit die Konsumenten in ihre eigenen Internal-Typen mappen koennen —
// das vermeidet eine harte Kopplung zwischen Markdown-AST und Plain-Token.
//
// §14.7 (User 2026-05-07): Aliase + URLs koexistieren als „Direkt-
// verlinkung" in info_field-Values. Der Tokenizer detektiert beide
// Pattern und der Renderer macht aus URL-Tokens ein <a href>, aus
// Alias-Tokens einen <AliasChip>.

import { ALIAS_REF_RE } from './alias';
import { sanitizeUrl } from './url';

// URL-Pattern: https:// + http:// + mailto: + tel:. Greedy bis zum
// naechsten Whitespace oder Quoting-Zeichen. Trailing-Punctuation-
// Cleanup macht der Renderer (sanitizeUrl liefert null bei kaputten
// Schemes, die Token wird dann wie Text behandelt).
const URL_REF_RE = /\b(?:https?:\/\/|mailto:|tel:)[^\s<>"'`\\)\]}]+/gi;

export type AliasToken =
  | { kind: 'text'; value: string }
  | { kind: 'alias'; alias: string }
  | { kind: 'url'; url: string };

// Erste Phase: Alias-Tokens extrahieren wie bisher. Zweite Phase: in den
// resultierenden text-Segmenten URLs splitten. So bleibt die Alias-
// Pruefung autoritativ (zwei Pattern koennten theoretisch ueberlappen,
// z.B. Alias am Ende einer URL — Alias-First gewinnt, weil die Alias-
// Form nur a-z0-9-Hyphen ohne Schraegstrich enthaelt, und URLs einen
// `://`-Anker brauchen, der nie in einem Alias steht).
export function tokenizeAliasText(input: string): AliasToken[] {
  if (!input) return [];
  const aliasOut: AliasToken[] = [];
  let last = 0;
  ALIAS_REF_RE.lastIndex = 0;
  while (true) {
    const m = ALIAS_REF_RE.exec(input);
    if (m === null) break;
    if (m.index > last) {
      aliasOut.push({ kind: 'text', value: input.slice(last, m.index) });
    }
    aliasOut.push({ kind: 'alias', alias: m[1].toLowerCase() });
    last = m.index + m[0].length;
  }
  if (last < input.length) {
    aliasOut.push({ kind: 'text', value: input.slice(last) });
  }

  // Zweite Phase: text-Segmente nach URLs absuchen, in text+url-Tokens
  // splitten. URL-Tokens nur wenn sanitizeUrl sie akzeptiert (XSS-
  // Defense — sonst landet die URL als Plain-Text im Output, was
  // konservativer ist als ein gefaehrliches `<a href>`).
  const out: AliasToken[] = [];
  for (const tok of aliasOut) {
    if (tok.kind !== 'text' || !tok.value) {
      out.push(tok);
      continue;
    }
    let textLast = 0;
    URL_REF_RE.lastIndex = 0;
    while (true) {
      const um = URL_REF_RE.exec(tok.value);
      if (um === null) break;
      // Trailing-Punctuation entfernen: `.`, `,`, `;`, `:`, `)` und
      // `!` direkt nach der URL gehoeren in der Regel zum Satz, nicht
      // zur URL. Wir kuerzen so lang, bis sanitizeUrl ein Ergebnis
      // liefert oder die URL leer ist.
      let raw = um[0];
      while (raw.length > 0 && /[.,;:)!?\]]/.test(raw[raw.length - 1])) {
        raw = raw.slice(0, -1);
      }
      const sanitized = sanitizeUrl(raw);
      if (!sanitized) {
        // Kein gueltiges Scheme/Format — als Text durchreichen.
        continue;
      }
      const urlStart = um.index;
      const urlEnd = um.index + raw.length;
      if (urlStart > textLast) {
        out.push({ kind: 'text', value: tok.value.slice(textLast, urlStart) });
      }
      out.push({ kind: 'url', url: sanitized });
      textLast = urlEnd;
      // RegExp.lastIndex auf den URL-Endpunkt setzen, falls die
      // Trailing-Cleanup das Match verkuerzt hat.
      URL_REF_RE.lastIndex = urlEnd;
    }
    if (textLast < tok.value.length) {
      out.push({ kind: 'text', value: tok.value.slice(textLast) });
    }
  }
  return out;
}
