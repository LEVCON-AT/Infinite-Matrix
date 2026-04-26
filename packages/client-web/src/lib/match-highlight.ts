// Substring-Highlight als Parts-Liste. Wenn das Query als zusammen-
// haengender Substring im Text vorkommt, marken wir die Range. Bei
// Subsequence-Fuzzy ohne Substring-Match liefern wir die ganze Zeile
// unmarkiert zurueck (die Reihen-Selektion zeigt den Treffer).
//
// Original aus components/HeaderSearchBar.tsx, hier zentralisiert
// damit Settings-Suche + HeaderSearchBar das Pattern teilen.

export type HighlightPart = { text: string; mark: boolean };

export function highlightSubstring(text: string, term: string): HighlightPart[] {
  if (!term || !text) return [{ text, mark: false }];
  const lower = text.toLowerCase();
  const needle = term.toLowerCase();
  const out: HighlightPart[] = [];
  let pos = 0;
  while (pos < text.length) {
    const hit = lower.indexOf(needle, pos);
    if (hit < 0) {
      out.push({ text: text.slice(pos), mark: false });
      break;
    }
    if (hit > pos) out.push({ text: text.slice(pos, hit), mark: false });
    out.push({ text: text.slice(hit, hit + term.length), mark: true });
    pos = hit + term.length;
  }
  return out;
}
