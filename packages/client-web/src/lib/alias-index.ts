// Workspace-lokaler Alias-Index fuer Autocomplete und Chip-Rendering.
//
// Die Alias-Aufloesung beim Navigieren laeuft weiterhin ueber
// `resolveAlias` (Supabase-ilike). Fuer Autocomplete-Dropdowns und
// Read-Mode-Chips brauchen wir aber einen SYNCHRONEN Match — die
// Latenz einer DB-Runde pro Tastenanschlag waere unakzeptabel. Also:
// ein in-memory Cache pro Workspace, lazy gefuellt, refresh-getrieben
// von der bestehenden realtime-Pipeline.
//
// Shape orientiert sich am Alt-Client `aliasIndex` (matrix_tool_beta.html
// Zeile 1462ff) — gleiche Kinds, canonical lowercase als Key.

import { createSignal, type Accessor } from 'solid-js';
import { supabase } from './supabase';
import { getByWorkspace } from './offline-cache';
import { isNetworkError } from './mutation-queue';
import { markCacheFallback, markLiveSuccess } from './offline-state';
import type {
  CellRow,
  ChecklistRow,
  DocRow,
  KbCardRow,
  LinkRow,
  NodeRow,
} from './types';

export type AliasKind = 'node' | 'cell' | 'card' | 'checklist' | 'link' | 'doc';

export type AliasEntry = {
  alias: string; // canonical lowercase (DB-normalized)
  kind: AliasKind;
  id: string; // entity row id (primary key in der jeweiligen Tabelle)
  label: string; // primary display label (leer fuer cell — zeigt Kind-Label)
  subLabel?: string; // optionale Zusatzinfo fuer Dropdown (Typ/Parent)
};

type WsState = {
  entries: Accessor<AliasEntry[]>;
  setEntries: (v: AliasEntry[]) => void;
};

const states = new Map<string, WsState>();

function ensureState(wsId: string): WsState {
  const existing = states.get(wsId);
  if (existing) return existing;
  const [entries, setEntries] = createSignal<AliasEntry[]>([]);
  const s: WsState = { entries, setEntries };
  states.set(wsId, s);
  return s;
}

// Parallele Fetches ueber alle 6 Alias-Tabellen. Ergebnis ueberschreibt
// den Cache komplett (kein Merge, kein Dedup). Bei Fehler in einem Shard
// laeuft der Rest weiter — sonst wuerde ein einzelner RLS-Hickup alle
// Dropdowns abschalten.
//
// Offline-Fallback: rebuilds aus den IDB-gecachten Workspace-Rows.
// Solange irgendeine vorherige Online-Sitzung den Cache gefuellt hat,
// liefert ^alias-Quicknav offline plausible Treffer.
export async function fetchAliasIndex(wsId: string): Promise<void> {
  if (!wsId) return;
  const s = ensureState(wsId);

  try {
    await fetchAliasIndexLive(wsId, s);
    markLiveSuccess();
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    await fetchAliasIndexFromCache(wsId, s);
    markCacheFallback();
  }
}

async function fetchAliasIndexLive(wsId: string, s: WsState): Promise<void> {
  const [nodes, cells, cards, checklists, links, docs] = await Promise.all([
    supabase
      .from('nodes')
      .select('id, alias, label, type')
      .eq('workspace_id', wsId)
      .not('alias', 'is', null),
    supabase
      .from('cells')
      .select('id, alias')
      .eq('workspace_id', wsId)
      .not('alias', 'is', null),
    supabase
      .from('kb_cards')
      .select('id, alias, name')
      .eq('workspace_id', wsId)
      .not('alias', 'is', null),
    supabase
      .from('checklists')
      .select('id, alias, label')
      .eq('workspace_id', wsId)
      .not('alias', 'is', null),
    supabase
      .from('links')
      .select('id, alias, label, url')
      .eq('workspace_id', wsId)
      .not('alias', 'is', null),
    supabase
      .from('docs')
      .select('id, alias, title')
      .eq('workspace_id', wsId)
      .not('alias', 'is', null),
  ]);

  const out: AliasEntry[] = [];

  for (const r of (nodes.data ?? []) as Array<{
    id: string;
    alias: string;
    label: string;
    type: 'matrix' | 'board';
  }>) {
    if (!r.alias) continue;
    out.push({
      alias: r.alias.toLowerCase(),
      kind: 'node',
      id: r.id,
      label: r.label ?? '',
      subLabel: r.type === 'matrix' ? 'Matrix' : 'Board',
    });
  }
  for (const r of (cells.data ?? []) as Array<{ id: string; alias: string }>) {
    if (!r.alias) continue;
    out.push({
      alias: r.alias.toLowerCase(),
      kind: 'cell',
      id: r.id,
      label: '',
      subLabel: 'Zelle',
    });
  }
  for (const r of (cards.data ?? []) as Array<{
    id: string;
    alias: string;
    name: string;
  }>) {
    if (!r.alias) continue;
    out.push({
      alias: r.alias.toLowerCase(),
      kind: 'card',
      id: r.id,
      label: r.name ?? '',
      subLabel: 'Karte',
    });
  }
  for (const r of (checklists.data ?? []) as Array<{
    id: string;
    alias: string;
    label: string;
  }>) {
    if (!r.alias) continue;
    out.push({
      alias: r.alias.toLowerCase(),
      kind: 'checklist',
      id: r.id,
      label: r.label ?? '',
      subLabel: 'Checkliste',
    });
  }
  for (const r of (links.data ?? []) as Array<{
    id: string;
    alias: string;
    label: string;
    url: string;
  }>) {
    if (!r.alias) continue;
    out.push({
      alias: r.alias.toLowerCase(),
      kind: 'link',
      id: r.id,
      label: r.label || r.url || '',
      subLabel: 'Link',
    });
  }
  for (const r of (docs.data ?? []) as Array<{
    id: string;
    alias: string;
    title: string;
  }>) {
    if (!r.alias) continue;
    out.push({
      alias: r.alias.toLowerCase(),
      kind: 'doc',
      id: r.id,
      label: r.title ?? '',
      subLabel: 'Doku',
    });
  }

  // Sort alphabetisch fuer stabile Dropdown-Reihenfolge. Dropdown-Konsumenten
  // koennen eigene Sortierung anwenden, aber der Default ist vorhersehbar.
  out.sort((a, b) => a.alias.localeCompare(b.alias));
  s.setEntries(out);
}

// Offline-Variante: liest die sechs Tabellen aus dem IDB-Workspace-
// Cache, filtert auf rows mit alias != null und baut dieselbe
// Index-Shape wie der Live-Pfad zusammen. Wenn der Cache leer ist
// (frische Tab-Sitzung, noch nie online), bleibt der Index leer.
async function fetchAliasIndexFromCache(wsId: string, s: WsState): Promise<void> {
  const [nodes, cells, cards, checklists, links, docs] = await Promise.all([
    getByWorkspace<NodeRow>('nodes', wsId),
    getByWorkspace<CellRow>('cells', wsId),
    getByWorkspace<KbCardRow>('kb_cards', wsId),
    getByWorkspace<ChecklistRow>('checklists', wsId),
    getByWorkspace<LinkRow>('links', wsId),
    getByWorkspace<DocRow>('docs', wsId),
  ]);
  const out: AliasEntry[] = [];
  for (const r of nodes) {
    if (!r.alias) continue;
    out.push({
      alias: r.alias.toLowerCase(),
      kind: 'node',
      id: r.id,
      label: r.label ?? '',
      subLabel: r.type === 'matrix' ? 'Matrix' : 'Board',
    });
  }
  for (const r of cells) {
    if (!r.alias) continue;
    out.push({
      alias: r.alias.toLowerCase(),
      kind: 'cell',
      id: r.id,
      label: '',
      subLabel: 'Zelle',
    });
  }
  for (const r of cards) {
    if (!r.alias) continue;
    out.push({
      alias: r.alias.toLowerCase(),
      kind: 'card',
      id: r.id,
      label: r.name ?? '',
      subLabel: 'Karte',
    });
  }
  for (const r of checklists) {
    if (!r.alias) continue;
    out.push({
      alias: r.alias.toLowerCase(),
      kind: 'checklist',
      id: r.id,
      label: r.label ?? '',
      subLabel: 'Checkliste',
    });
  }
  for (const r of links) {
    if (!r.alias) continue;
    out.push({
      alias: r.alias.toLowerCase(),
      kind: 'link',
      id: r.id,
      label: r.label || r.url || '',
      subLabel: 'Link',
    });
  }
  for (const r of docs) {
    if (!r.alias) continue;
    out.push({
      alias: r.alias.toLowerCase(),
      kind: 'doc',
      id: r.id,
      label: r.title ?? '',
      subLabel: 'Doku',
    });
  }
  out.sort((a, b) => a.alias.localeCompare(b.alias));
  s.setEntries(out);
}

// Reactive Accessor — Komponenten koennen direkt auf Aenderungen reagieren.
export function aliasIndexSignal(wsId: string): Accessor<AliasEntry[]> {
  return ensureState(wsId).entries;
}

// Sync prefix-match, case-insensitive. Leerer Query liefert die ersten
// `limit` Eintraege (nuetzlich fuer Klick-Trigger ohne Typing).
// Analog _aaOnInput (HTML Zeile 5223) — startsWith, limitiert.
export function getAliasMatches(
  wsId: string,
  query: string,
  limit = 8,
): AliasEntry[] {
  const s = states.get(wsId);
  if (!s) return [];
  const all = s.entries();
  const q = query.toLowerCase().trim().replace(/^\^+/, '');
  if (!q) return all.slice(0, limit);
  const out: AliasEntry[] = [];
  for (const e of all) {
    if (e.alias.startsWith(q)) {
      out.push(e);
      if (out.length >= limit) break;
    }
  }
  return out;
}

// Exakter Lookup ueber den canonical Alias. Fuer Chip-Rendering:
// ist der geparste `^token` ein bekannter Alias, ja/nein?
export function lookupAlias(wsId: string, alias: string): AliasEntry | null {
  const s = states.get(wsId);
  if (!s) return null;
  const a = alias.toLowerCase().trim().replace(/^\^+/, '');
  if (!a) return null;
  return s.entries().find((e) => e.alias === a) ?? null;
}

// Reset (z.B. bei Workspace-Wechsel). Der Realtime-Refresh baut den
// Cache danach ohnehin neu — aber ein expliziter Clear verhindert,
// dass veraltete Eintraege kurzfristig durchschlagen.
export function clearAliasIndex(wsId: string): void {
  states.delete(wsId);
  const t = debounceTimers.get(wsId);
  if (t) {
    clearTimeout(t);
    debounceTimers.delete(wsId);
  }
}

// Debouncer pro wsId, damit Bulk-Realtime-Events (z.B. Drag-Reorder
// oder Bulk-Delete) nicht fuer jedes einzelne Event 6 parallele
// Queries ausloesen. 250 ms Fensterbreite — schnell genug dass ein
// Alias-Rename in der UI zuegig sichtbar wird, aber grosszuegig genug
// um typische Bursts zu coalescen.
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const REFRESH_DEBOUNCE_MS = 250;

export function scheduleAliasRefresh(wsId: string): void {
  if (!wsId) return;
  const existing = debounceTimers.get(wsId);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    debounceTimers.delete(wsId);
    void fetchAliasIndex(wsId);
  }, REFRESH_DEBOUNCE_MS);
  debounceTimers.set(wsId, t);
}
