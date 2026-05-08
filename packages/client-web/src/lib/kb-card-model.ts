// WV.WV.6 — KbCardModel-Foundation fuer Card<AtomType>-Polymorphie
// in BoardView (+ ChecklistPanel-Item).
//
// Pre-Welle-A: definiert die polymorphe Card-Shape, die ein Kanban-
// Item rendern kann unabhaengig vom Atom-Type. Heute lebt nur der
// task-Card-Pfad in BoardView (KbCardRow als Task-Projection); ab
// Welle A wandern doc/link/checklist/imported_event-Atome ueber
// `atom_manifestations(kind='kanban')` ebenfalls in Kanban-Spalten.
//
// Konzept-Verankerung: §9.10b „Card<AtomType>-Polymorphie" + §9.10
// (doc × kanban) + §9.6c (link × kanban) + §9.13 (info × kanban) +
// imported_event-Anbindung.
//
// Was diese Datei NICHT macht: keine Mutations, keine Drag-Handler.
// Pure Type-Defs + Builder. Caller (BoardView / Welle-A-Adapter)
// bauen die Models aus atom_manifestations + Source-Rows zusammen
// und reichen sie an `<KbAtomCardBody />` (components/KbAtomCardBody.tsx).
//
// Reuse-Vertrag fuer Welle A:
//   - BoardView-Render filtert wsManifestations nach `kind='kanban'
//     AND atom_type !== 'task'` und mapt mit `kbCardModelFromManif`
//     auf KbCardModel-Variants.
//   - Pro Variant gibt es einen Source-Resolver (z.B. doc → DocRow).
//   - Tasks bleiben weiterhin ueber KbCardRow + die existing Inline-
//     Render-Branch in BoardView (Phase-4 task-projection-Layer).
//     KbCardModel.kind='task' ist fuer den Foundation-Vertrag dabei,
//     aber V1-Konsumenten der Polymorphie sind die nicht-task-Variants.

import type { AtomManifestationRow } from './atom-manifestations';
import type { ChecklistItemRow, ChecklistRow, DocRow, ExternalEvent, LinkRow } from './types';

// ─── Models ────────────────────────────────────────────────────

export type KbTaskCardModel = {
  kind: 'task';
  manifestationId: string;
  atomId: string; // = task.id (Source-Tabelle tasks)
  // Tasks behalten ihre tiefe Render-Branch in BoardView (Checkbox,
  // Recur, Inline-Checklisten, Color etc.) — KbCardModel speist hier
  // nur die Identitaet weiter, der Caller laeuft mit KbCardRow.
};

export type KbDocCardModel = {
  kind: 'doc';
  manifestationId: string;
  atomId: string;
  title: string; // live aus DocRow.title (R-WV-8: kein Snapshot)
  alias: string | null;
  excerpt: string; // erste 80 Zeichen aus DocRow.content (HTML
  // strip → text). Konzept §9.10 Card<doc>-Spec.
  pinCount: number; // Anzahl atom_manifestations(kind='pinned' AND
  // atom_id=doc.id) — Cross-Pin-Indicator.
};

export type KbLinkCardModel = {
  kind: 'link';
  manifestationId: string;
  atomId: string;
  label: string; // LinkRow.label
  url: string; // LinkRow.url
  alias: string | null;
  // V1: URL-Provider („url" oder „mail") aus LinkRow.type. Welle B
  // erweitert auf 15 Provider via links.provider-Spalte.
  linkType: LinkRow['type'];
};

export type KbChecklistCardModel = {
  kind: 'checklist';
  manifestationId: string;
  atomId: string;
  label: string; // ChecklistRow.label
  alias: string | null;
  doneCount: number;
  totalCount: number;
};

export type KbImportedEventCardModel = {
  kind: 'imported_event';
  manifestationId: string;
  atomId: string;
  summary: string;
  startAt: string; // ISO
  allDay: boolean;
  sourceProvider: ExternalEvent['source_provider'];
  url: string | null;
};

export type KbCardModel =
  | KbTaskCardModel
  | KbDocCardModel
  | KbLinkCardModel
  | KbChecklistCardModel
  | KbImportedEventCardModel;

// ─── Source-Resolver-Bundle ─────────────────────────────────────
// Caller liefert die Source-Rows, dann mapped der Builder. Map statt
// Array fuer O(1)-Lookup pro Manifestation. Optional pinCountByAtomId
// fuer Card<doc>-Pin-Badge (BoardView berechnet das eh schon via
// docPinCountByCard()).

export type KbCardSources = {
  docsById?: Map<string, DocRow>;
  linksById?: Map<string, LinkRow>;
  checklistsById?: Map<string, ChecklistRow>;
  // ChecklistItems gruppiert nach checklist_id fuer Done/Total-Count.
  checklistItemsByChecklistId?: Map<string, ChecklistItemRow[]>;
  externalEventsById?: Map<string, ExternalEvent>;
  pinCountByAtomId?: Map<string, number>;
};

// ─── Builder ───────────────────────────────────────────────────

// Mappt eine atom_manifestation-Row + Source-Rows auf ein KbCardModel.
// Returns null wenn das Source-Row fehlt (Caller koennte einen
// „Skelett-Stub" rendern oder die Manifestation ueberspringen).
export function kbCardModelFromManif(
  m: AtomManifestationRow,
  sources: KbCardSources,
): KbCardModel | null {
  if (m.kind !== 'kanban') return null;

  if (m.atom_type === 'task') {
    return { kind: 'task', manifestationId: m.id, atomId: m.atom_id };
  }

  if (m.atom_type === 'doc') {
    const doc = sources.docsById?.get(m.atom_id);
    if (!doc) return null;
    return {
      kind: 'doc',
      manifestationId: m.id,
      atomId: m.atom_id,
      title: doc.title,
      alias: doc.alias,
      excerpt: extractDocExcerpt(doc.content, 80),
      pinCount: sources.pinCountByAtomId?.get(m.atom_id) ?? 0,
    };
  }

  if (m.atom_type === 'link') {
    const link = sources.linksById?.get(m.atom_id);
    if (!link) return null;
    return {
      kind: 'link',
      manifestationId: m.id,
      atomId: m.atom_id,
      label: link.label,
      url: link.url,
      alias: link.alias,
      linkType: link.type,
    };
  }

  if (m.atom_type === 'checklist') {
    const cl = sources.checklistsById?.get(m.atom_id);
    if (!cl) return null;
    const items = sources.checklistItemsByChecklistId?.get(m.atom_id) ?? [];
    return {
      kind: 'checklist',
      manifestationId: m.id,
      atomId: m.atom_id,
      label: cl.label,
      alias: cl.alias,
      doneCount: items.filter((i) => i.done).length,
      totalCount: items.length,
    };
  }

  if (m.atom_type === 'imported_event') {
    const ev = sources.externalEventsById?.get(m.atom_id);
    if (!ev) return null;
    return {
      kind: 'imported_event',
      manifestationId: m.id,
      atomId: m.atom_id,
      summary: ev.summary,
      startAt: ev.start_at,
      allDay: ev.all_day,
      sourceProvider: ev.source_provider,
      url: ev.url,
    };
  }

  return null;
}

// HTML → Plain-Text-Excerpt. ProseMirror-Output ist sanitized HTML
// (Welle D); wir strippen Tags und kuerzen auf maxLen mit Ellipsis.
// Kein dompurify-Dependency hier — Pure-Function ohne DOM-Zugriff.
function extractDocExcerpt(htmlOrText: string, maxLen: number): string {
  if (!htmlOrText) return '';
  const text = htmlOrText
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen).trimEnd()}…`;
}
