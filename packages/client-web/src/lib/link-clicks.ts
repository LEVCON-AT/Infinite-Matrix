// §11.7 — link.click_count Best-Effort-Tracker.
//
// Migration 073 hat die Spalte links.click_count + RPC
// `mcp_increment_link_click_count(p_link_id)` angelegt. Konsumenten
// rufen diese Funktion bei jedem Link-Click — sie wrappt die RPC,
// swallows Errors silent (Click-Tracking darf den User-Flow nicht
// blockieren), und vermeidet Doppel-Increment via 1.5s-Dedup-Cache.
//
// Pflicht-Call-Sites:
//   - alias-dispatch.ts: AliasResolveResult.kind='link' beim window.open.
//   - atom-routing.ts: CalendarEvent.atomType='link' beim Link-Open.
//   - NodeTree.tsx: Sidebar-Link-Entry mit id-Prefix 'link-board-' (das
//     sind echte links-Tabelle-Rows; 'link-info-' sind cell.data.links
//     jsonb ohne click_count, werden ignoriert).
//
// V2-Erweiterung deferred: Per-User-Click-Histogram (welcher User hat
// wann/wieviel geklickt), Most-Popular-Links-Widget.

import { supabase } from './supabase';

// Dedup-Cache: gleicher Link innerhalb 1.5s wird nur einmal incrementiert.
// Ein Doppel-Click oder Hover→Click feuert sonst 2x.
const recentClicks = new Map<string, number>();
const DEDUP_WINDOW_MS = 1500;

export function incrementLinkClickCount(linkId: string): void {
  if (!linkId) return;
  const now = Date.now();
  const last = recentClicks.get(linkId);
  if (last !== undefined && now - last < DEDUP_WINDOW_MS) return;
  recentClicks.set(linkId, now);
  // Best-Effort: feuern + vergessen. RPC-Fail (offline, RLS, gelöschter
  // Link) wird gefressen. Click-Tracking darf den User-Flow nie blockieren.
  // Supabase-rpc liefert PostgrestBuilder (thenable, kein Promise) —
  // .then(...).catch(...) klappt am sauberen Promise. Wir erzwingen
  // Promise-Wrap via Promise.resolve.
  void Promise.resolve(supabase.rpc('mcp_increment_link_click_count', { p_link_id: linkId })).catch(
    () => {
      /* silent */
    },
  );
}

// Helper fuer NodeTree-Sidebar-Link-Entries: parsed das `link-board-<id>`
// Prefix raus, returns die echte link-id oder null fuer cell.data.links-
// Eintraege (ohne click_count).
export function parseTreeLinkEntryId(entryId: string): string | null {
  const m = /^link-board-(.+)$/.exec(entryId);
  return m ? m[1] : null;
}
