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

import { tokenizeAliasText } from './alias-tokenizer';

export type MdText = { type: 'text'; value: string };
export type MdBold = { type: 'bold'; children: MdInline[] };
export type MdItalic = { type: 'italic'; children: MdInline[] };
export type MdCode = { type: 'code'; value: string };
export type MdLink = { type: 'link'; href: string; label: string };
export type MdAlias = { type: 'alias'; alias: string };
export type MdInline = MdText | MdBold | MdItalic | MdCode | MdLink | MdAlias;

// Alias- + URL-Tokenization erfolgt zentral in tokenizeAliasText
// (§14.7 Konsolidierung). Frueher hatte markdown-lite einen eigenen
// URL_RE — der ist gefallen, damit URL-Detection nicht doppelt lebt
// (Doublet-Verbot, code-quality §1).

// Erst Inline-Code ausschneiden (damit ** und * darin nicht greifen),
// dann bold, dann italic, dann URLs + Aliase via Tokenizer.
function parseInline(input: string): MdInline[] {
  const out: MdInline[] = [];
  let i = 0;

  function pushText(s: string) {
    if (!s) return;
    // Tokenizer liefert text + alias + url. Wir mappen 1:1.
    for (const t of tokenizeAliasText(s)) {
      if (t.kind === 'text') {
        out.push({ type: 'text', value: t.value });
      } else if (t.kind === 'alias') {
        out.push({ type: 'alias', alias: t.alias });
      } else {
        // url-Token: tokenizer hat sanitizeUrl bereits verifiziert;
        // label = sanitized url (kein separates Display-Token).
        out.push({ type: 'link', href: t.url, label: t.url });
      }
    }
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
