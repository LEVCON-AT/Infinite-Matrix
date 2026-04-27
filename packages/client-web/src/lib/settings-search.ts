// Settings-Suchindex — Phase 1 Follow-up.
//
// Statisch gepflegt: jeder neue Sub-Tab und jede neue Sektion (h3)
// bekommt hier einen Eintrag. Match laeuft per fuzzyScore aus
// lib/fuzzy.ts (Subsequence + Word-Start-Bonus + Multi-Token AND).
//
// Der `tab`-Pfad ist relativ zum Settings-Root (z.B.
// 'account/visibility'); die UI baut den absoluten Pfad mit
// /w/<wsId>/settings/ davor. `anchorId` ist die DOM-id auf der
// Sub-Page, zu der gescrollt werden soll — null bedeutet "Tab-Top".
//
// Wenn die Doku-Section dazukommt, wird hier ein neuer SearchTab
// 'docs/<bereich>' ergaenzt + entsprechende Eintraege. Die UI
// iteriert nur ueber den Index, sie braucht keinen Patch.

import { fuzzyScore } from './fuzzy';

export type SearchTab =
  | 'account/profile'
  | 'account/security'
  | 'account/visibility'
  | 'account/ai'
  | 'workspace/general'
  | 'workspace/members'
  | 'workspace/audit';

export type SearchEntry = {
  tab: SearchTab;
  label: string;
  hint: string;
  anchorId: string | null;
};

export const SETTINGS_SEARCH_INDEX: ReadonlyArray<SearchEntry> = [
  // ── Konto ────────────────────────────────────────────────────
  {
    tab: 'account/profile',
    label: 'Profil',
    hint: 'Anzeigename E-Mail Avatar',
    anchorId: null,
  },
  {
    tab: 'account/security',
    label: 'Sicherheit',
    hint: 'Sessions Logout Abmelden Passwort',
    anchorId: null,
  },
  {
    tab: 'account/visibility',
    label: 'Sichtbarkeit',
    hint: 'Bedienelemente Edit-Modus',
    anchorId: null,
  },
  {
    tab: 'account/visibility',
    label: 'Aktivitaets-Sichtbarkeit',
    hint: 'Activity-Level full present off Incognito Avatar Online-Stack Presence',
    anchorId: 'activity-level-head',
  },
  {
    tab: 'account/visibility',
    label: 'Sichtbarkeits-Stufen',
    hint: 'Vis-Keys Edit Always Never Schalter Toggle Bedienelemente',
    anchorId: 'vis-groups-head',
  },
  {
    tab: 'account/visibility',
    label: 'Synchronisation',
    hint: 'Sync Offline-Queue Pending Mutations Replay',
    anchorId: 'sync-section-head',
  },
  {
    tab: 'account/visibility',
    label: 'Wartung',
    hint: 'Reset Cache leeren IndexedDB Offline-Cache Zuruecksetzen',
    anchorId: 'maintenance-head',
  },
  {
    tab: 'account/ai',
    label: 'AI-Anbindung',
    hint: 'API-Key Anthropic Claude OpenAI GPT Gemini Provider KI Onboarding Hilfe Wizard',
    anchorId: null,
  },

  // ── Workspace ────────────────────────────────────────────────
  {
    tab: 'workspace/general',
    label: 'Allgemein',
    hint: 'Workspace Name Owner Mitglieder ID Stammdaten',
    anchorId: null,
  },
  {
    tab: 'workspace/general',
    label: 'Gefahren-Zone',
    hint: 'Eigentum uebertragen Workspace loeschen Owner-only Transfer Delete',
    anchorId: 'danger-zone-head',
  },
  {
    tab: 'workspace/members',
    label: 'Mitglieder',
    hint: 'Einladen Rollen Editor Viewer Admin',
    anchorId: null,
  },
  {
    tab: 'workspace/members',
    label: 'Neue Person einladen',
    hint: 'Invite Token Mail Magic-Link Einladung erstellen',
    anchorId: 'invite-form-head',
  },
  {
    tab: 'workspace/members',
    label: 'Aktuelle Mitglieder',
    hint: 'Members-Liste Rolle Deaktivieren Entfernen',
    anchorId: 'members-list-head',
  },
  {
    tab: 'workspace/audit',
    label: 'Audit-Log',
    hint: 'Historie Aktionen Einladungen Mitglieder Workspace',
    anchorId: null,
  },
];

export type SearchHit = SearchEntry & { score: number };

export function matchSettings(query: string, limit = 12): SearchHit[] {
  const q = query.trim();
  if (!q) return [];
  const out: SearchHit[] = [];
  for (const e of SETTINGS_SEARCH_INDEX) {
    const haystack = `${e.label} ${e.hint}`;
    const score = fuzzyScore(q, haystack);
    if (score === null) continue;
    out.push({ ...e, score });
  }
  out.sort((a, b) =>
    b.score - a.score !== 0 ? b.score - a.score : a.label.localeCompare(b.label, 'de'),
  );
  return out.slice(0, limit);
}

// Helper fuer Sub-Nav-Path-Hint: 'account/visibility' -> 'Konto · Sichtbarkeit'.
const TAB_LABELS: Record<SearchTab, string> = {
  'account/profile': 'Konto · Profil',
  'account/security': 'Konto · Sicherheit',
  'account/visibility': 'Konto · Sichtbarkeit',
  'account/ai': 'Konto · AI-Anbindung',
  'workspace/general': 'Workspace · Allgemein',
  'workspace/members': 'Workspace · Mitglieder',
  'workspace/audit': 'Workspace · Audit-Log',
};

export function tabLabel(tab: SearchTab): string {
  return TAB_LABELS[tab];
}

// Icon-Mapping: gleiches Icon wie der Tab in der Sub-Nav benutzt.
// Wenn Settings.tsx das Icon-Mapping aendert, hier mit-anpassen.
import type { IconName } from '../components/Icon';

const TAB_ICONS: Record<SearchTab, IconName> = {
  'account/profile': 'user',
  'account/security': 'lock-closed',
  'account/visibility': 'eye',
  'account/ai': 'sparkles',
  'workspace/general': 'cog',
  'workspace/members': 'users',
  'workspace/audit': 'list-bullet',
};

export function tabIcon(tab: SearchTab): IconName {
  return TAB_ICONS[tab];
}
