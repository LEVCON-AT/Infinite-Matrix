// Minimaler Markdown-Light-Parser fuer Node-Descriptions. Rendert
// nicht in HTML-Strings (kein dangerouslySetInnerHTML), sondern in
// ein Solid-freundliches Tree von Tokens. Keine Deps, keine Security-
// Kopfschmerzen — alles geht durch Solids Text-Escape.
//
// Unterstuetzt:
//   **bold**, *italic*, `code`         — inline
//   http(s)://...                      — Auto-Link (target _blank, noopener)
//   \n                                 — Line-Break innerhalb Paragraph
//
// Nicht unterstuetzt (bewusst): Listen, Headings, Bilder, HTML-Tags.
// Der Parser ist absichtlich dumm: wenn man mehr will, kommt eine
// Markdown-Lib.
//
// URL-Sanitization laeuft durch sanitizeUrl() (lehnt javascript:/
// data:/vbscript: ab) — Paranoia.

import { ALIAS_REF_RE } from './alias';
import { sanitizeUrl } from './url';

export type MdText = { type: 'text'; value: string };
export type MdBold = { type: 'bold'; children: MdInline[] };
export type MdItalic = { type: 'italic'; children: MdInline[] };
export type MdCode = { type: 'code'; value: string };
export type MdLink = { type: 'link'; href: string; label: string };
export type MdAlias = { type: 'alias'; alias: string };
export type MdInline = MdText | MdBold | MdItalic | MdCode | MdLink | MdAlias;

const URL_RE = /https?:\/\/[^\s<>"'`]+/g;
// Alias-Token im Fliesstext: `^` gefolgt von a-z/0-9. Wir splitten erst
// nach URLs, damit ein Alias-Muster innerhalb einer URL nicht falsch
// erkannt wird. Regex-Definition zentral in lib/alias (ALIAS_REF_RE).

// Erst Inline-Code ausschneiden (damit ** und * darin nicht greifen),
// dann bold, dann italic, dann URLs.
function parseInline(input: string): MdInline[] {
  const out: MdInline[] = [];
  let i = 0;

  function pushAliasOrText(s: string) {
    if (!s) return;
    let last = 0;
    ALIAS_REF_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ALIAS_REF_RE.exec(s)) !== null) {
      if (m.index > last) out.push({ type: 'text', value: s.slice(last, m.index) });
      out.push({ type: 'alias', alias: m[1].toLowerCase() });
      last = m.index + m[0].length;
    }
    if (last < s.length) out.push({ type: 'text', value: s.slice(last) });
  }

  function pushText(s: string) {
    if (!s) return;
    // Zuerst URLs abspalten, dann in den verbleibenden Text-Teilen nach
    // Alias-Tokens suchen. So ueberlappen sich URL- und Alias-Muster nicht.
    let last = 0;
    URL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = URL_RE.exec(s)) !== null) {
      if (m.index > last) pushAliasOrText(s.slice(last, m.index));
      const safe = sanitizeUrl(m[0]);
      if (safe) {
        out.push({ type: 'link', href: safe, label: m[0] });
      } else {
        out.push({ type: 'text', value: m[0] });
      }
      last = m.index + m[0].length;
    }
    if (last < s.length) pushAliasOrText(s.slice(last));
  }

  while (i < input.length) {
    const rest = input.slice(i);

    // `code` — hoechste Prio, greedy auf erstes closing-backtick
    if (rest.startsWith('`')) {
      const end = rest.indexOf('`', 1);
      if (end > 0) {
        out.push({ type: 'code', value: rest.slice(1, end) });
        i += end + 1;
        continue;
      }
    }

    // **bold** — nicht-greedy, muss mind. 1 Zeichen Inhalt haben
    if (rest.startsWith('**')) {
      const end = rest.indexOf('**', 2);
      if (end > 2) {
        out.push({ type: 'bold', children: parseInline(rest.slice(2, end)) });
        i += end + 2;
        continue;
      }
    }

    // *italic* — nicht-greedy, nicht wenn direkt nach ** (das wuerde
    // das ** zerlegen). Workaround: wir kommen hier nur an wenn **
    // schon nicht matchte.
    if (rest.startsWith('*')) {
      const end = rest.indexOf('*', 1);
      if (end > 1) {
        out.push({ type: 'italic', children: parseInline(rest.slice(1, end)) });
        i += end + 1;
        continue;
      }
    }

    // Bis zum naechsten Marker ein Stueck Text sammeln
    let nextMarker = input.length;
    for (const tok of ['`', '**', '*']) {
      const idx = input.indexOf(tok, i + 1);
      if (idx >= 0 && idx < nextMarker) nextMarker = idx;
    }
    pushText(input.slice(i, nextMarker));
    i = nextMarker;
  }

  return out;
}

// Top-Level: splittet an Leerzeilen in Paragraphs, jeder Paragraph
// haelt seine Zeilen. Innerhalb eines Paragraphs werden \n zu
// Line-Breaks (MdText mit \n bleibt).
export type MdParagraph = { lines: MdInline[][] };

export function parseMarkdownLight(text: string): MdParagraph[] {
  const paragraphs = text.replace(/\r\n?/g, '\n').split(/\n{2,}/);
  return paragraphs.map((p) => ({
    lines: p.split('\n').map(parseInline),
  }));
}
