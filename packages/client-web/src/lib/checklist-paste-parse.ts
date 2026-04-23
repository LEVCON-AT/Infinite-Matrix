// Parser fuer mehrzeiligen Zwischenablage-Inhalt beim Einfuegen in eine
// Checkliste. Zerlegt rohen Text in {text, level}-Items; Einrueckung
// wird aus fuehrenden Tabs und 2-Spaces-Bloecken abgeleitet und auf
// das kleinste vorkommende Level normalisiert (so dass die flachste
// Zeile auf Level 0 landet).
//
// Vorbild: `_clPasteParse` im HTML-Client (matrix_tool_beta.html, ~Z6062).
// Absichtlich minimalistisch — Bullets werden gestrippt, aber keine
// weitere Interpretation (keine "numbered lists", keine Checkbox-Marker).

export type ParsedPasteItem = {
  text: string;
  level: 0 | 1 | 2;
};

// Bullet-Prefixe, die beim Parsen entfernt werden:
//   - item, * item, • item, 1. item, 12. item
// Der Match ist bewusst streng (kein `+` / kein `◦`), um False-Positives
// in normalem Fliesstext ("- dies - das") zu vermeiden.
const BULLET_RE = /^(?:[-*•]\s+|\d+\.\s+)/;

const MAX_LEVEL = 2;

export function parsePastedText(raw: string): ParsedPasteItem[] {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');

  // Erster Durchlauf: pro Zeile Indent-Level + getrimmter Text.
  const entries: Array<{ lvl: number; rest: string }> = [];
  for (const line of lines) {
    // Fuehrende Whitespace-Sequenz abgreifen.
    const m = line.match(/^([\t ]*)(.*)$/);
    if (!m) continue;
    const indent = m[1];
    let rest = m[2];
    // 1 Tab = 1 Level, 2 Spaces = 1 Level. Mixed Tabs/Spaces addieren sich.
    let tabs = 0;
    let spaces = 0;
    for (const ch of indent) {
      if (ch === '\t') tabs++;
      else if (ch === ' ') spaces++;
    }
    const lvl = tabs + Math.floor(spaces / 2);
    // Bullet-Marker entfernen (falls vorhanden) und trimmen.
    rest = rest.replace(BULLET_RE, '').trimEnd();
    if (!rest.trim()) continue;
    entries.push({ lvl, rest });
  }

  if (entries.length === 0) return [];

  // Level-Normalisierung: alle Items relativ zum kleinsten Level.
  let minLvl = Infinity;
  for (const e of entries) if (e.lvl < minLvl) minLvl = e.lvl;
  if (!Number.isFinite(minLvl)) minLvl = 0;

  return entries.map((e) => {
    const rel = Math.max(0, Math.min(MAX_LEVEL, e.lvl - minLvl));
    return { text: e.rest, level: rel as 0 | 1 | 2 };
  });
}
