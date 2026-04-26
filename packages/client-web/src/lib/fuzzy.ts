// Subsequence-Fuzzy-Match mit Score (~50 LOC).
//
// Idee: Query ist eine Folge von Chars, die in dieser Reihenfolge im
// Target vorkommen muessen — nicht zwingend zusammenhaengend.
// "cl" matcht "Cache leeren" (c am Word-Start, l am Word-Start).
// Scoring belohnt Word-Starts und konsekutive Treffer.
//
// Multi-Token: Query auf Whitespace splitten, jeder Token muss
// matchen (AND-Combine), Scores addieren. Wenn ein Token nicht
// matcht, gesamtes Item ohne Score = raus.
//
// Verwendung: Settings-Suche (lib/settings-search.ts) und kuenftig
// die Doku-Suche. Fuer den Workspace-HeaderSearchBar laeuft die
// Hauptlast weiterhin per DB-ilike — Fuzzy ist hier nur fuer
// kuratierte Frontend-Indices.

const WORD_BREAK_RE = /[\s_\-./]/;

function isWordStart(target: string, idx: number): boolean {
  if (idx === 0) return true;
  const prev = target[idx - 1];
  return prev !== undefined && WORD_BREAK_RE.test(prev);
}

// null = kein Match (mind. ein Query-Char fehlt im Target).
// >= 0 = Score, hoeher ist besser.
export function fuzzyScoreToken(query: string, target: string): number | null {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let score = 0;
  let qi = 0;
  // -2 statt -1, damit Pos 0 nicht versehentlich als consecutive zaehlt.
  let lastMatchPos = -2;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;
    if (isWordStart(t, ti)) score += 3;
    if (ti === lastMatchPos + 1) score += 2;
    score += 1;
    lastMatchPos = ti;
    qi++;
  }
  if (qi < q.length) return null;
  return score;
}

// Multi-Token: AND-Combine ueber Whitespace-Tokens. Score = Sum der
// Token-Scores. Wenn ein Token kein Match hat, return null.
export function fuzzyScore(query: string, target: string): number | null {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;
  let total = 0;
  for (const t of tokens) {
    const s = fuzzyScoreToken(t, target);
    if (s === null) return null;
    total += s;
  }
  return total;
}

// Helper fuer Listen-Filter: gibt sortierte Treffer mit Score zurueck.
export function fuzzyFilter<T>(
  items: ReadonlyArray<T>,
  query: string,
  getText: (item: T) => string,
): Array<{ item: T; score: number }> {
  const out: Array<{ item: T; score: number }> = [];
  for (const item of items) {
    const score = fuzzyScore(query, getText(item));
    if (score !== null) out.push({ item, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}
