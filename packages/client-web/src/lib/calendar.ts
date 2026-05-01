// Calendar-Helper (Phase 4 T.1.G.A).
//
// Reine Funktionen — kein DOM, keine Solid-Signals. Nutzbar in der
// Calendar-Route + Sidebar-Mini-Calendar (T.1.G.B) gleichermassen.
//
// Konventionen:
//   - Datums-Strings sind ISO 'YYYY-MM-DD' (Browser-lokal).
//   - Wochen-Layout ist Mo-So (Mo=0, So=6) — dem deutschen UI-Stand
//     entsprechend, nicht der JS-Default-Konvention (So=0).
//   - Multi-Day-Events: start_date + end_date inklusiv.

import { type RecurRule, recurFiresOn } from './recur';
import type { TaskManifestationRow, TaskRow, TaskStatus } from './types';

// ─── Datum-Helper ──────────────────────────────────────────

export function isoDate(d: Date): string {
  // toISOString liefert UTC-basiert — bei lokal-Mitternacht in
  // negativen UTC-Offsets wuerde der Tag drueberlaufen. Fuer einen
  // local-anchored ISO-Date-String benutzen wir die Komponenten direkt.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromIso(iso: string): Date {
  // Lokale Mitternacht — verhindert UTC-vs-lokal-Drift.
  return new Date(`${iso}T00:00:00`);
}

export function addDays(iso: string, days: number): string {
  const d = fromIso(iso);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

export function addMonths(iso: string, months: number): string {
  const d = fromIso(iso);
  d.setMonth(d.getMonth() + months);
  return isoDate(d);
}

export function startOfMonth(iso: string): string {
  const d = fromIso(iso);
  d.setDate(1);
  return isoDate(d);
}

export function endOfMonth(iso: string): string {
  const d = fromIso(iso);
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return isoDate(d);
}

// Mo-So-Index: Mo=0 ... So=6.
export function weekdayMoSo(iso: string): number {
  const d = fromIso(iso);
  return (d.getDay() + 6) % 7;
}

export function isToday(iso: string, today: string): boolean {
  return iso === today;
}

export function isWeekend(iso: string): boolean {
  const w = weekdayMoSo(iso);
  return w === 5 || w === 6;
}

const MONTH_NAMES_DE = [
  'Januar',
  'Februar',
  'Maerz',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];

export function monthLabelDe(iso: string): string {
  const d = fromIso(iso);
  return `${MONTH_NAMES_DE[d.getMonth()]} ${d.getFullYear()}`;
}

// ─── Monats-Grid-Berechnung ────────────────────────────────

export type CalendarDay = {
  iso: string;
  inMonth: boolean; // false fuer Filler-Tage am Anfang/Ende des Grids
  isToday: boolean;
  isWeekend: boolean;
};

// Liefert ein 6×7-Grid fuer den uebergebenen Monat. Erste Zeile beginnt
// am Mo der Woche, in der der 1. des Monats liegt; immer 42 Zellen
// (6 Wochen) fuer stabiles Layout. Filler-Tage tragen `inMonth=false`.
export function buildMonthGrid(monthAnchorIso: string, todayIso: string): CalendarDay[] {
  const first = startOfMonth(monthAnchorIso);
  const offset = weekdayMoSo(first); // 0 = bereits Mo
  const gridStart = addDays(first, -offset);
  const days: CalendarDay[] = [];
  for (let i = 0; i < 42; i++) {
    const iso = addDays(gridStart, i);
    const sameMonth = iso.slice(0, 7) === first.slice(0, 7);
    days.push({
      iso,
      inMonth: sameMonth,
      isToday: iso === todayIso,
      isWeekend: isWeekend(iso),
    });
  }
  return days;
}

// ─── Calendar-Event-Build ─────────────────────────────────
// Ein "Event" ist die Render-Form einer Task-im-Calendar. Quellen:
//   1) virtual: Task hat tasks.deadline != null, aber keine explicit
//      kind='calendar'-Manifestation. Single-Day, kein Range.
//   2) explicit: kind='calendar'-Manifestation mit display_meta-
//      Feldern (start_date / end_date / time / duration / recur).
//
// Bei (2) hat die Manifestation Vorrang; (1) wird nicht zusaetzlich
// erzeugt wenn die Task schon eine explicit Calendar-Manifestation hat.

export type CalendarEvent = {
  // Phase 4 T.AC.B: polymorpher Diskriminator. Fuer atomType='task' ist
  // taskId === atomId. Fuer 'link'/'checklist' steht atomId fuer die
  // Source-Entity-ID (links.id bzw. checklists.id), taskId duplizieren
  // wir fuer Backward-Compat in Render-Komponenten, die schon taskId
  // lesen — dort fungiert der Wert als generischer Atom-Key.
  atomType: 'task' | 'link' | 'checklist' | 'doc';
  atomId: string;
  taskId: string; // = atomId; bleibt drin damit bestehender Render-Code unveraendert bleibt
  manifId: string | null; // null = virtual aus tasks.deadline
  label: string;
  status: TaskStatus | null; // nur task hat einen status
  startDate: string;
  endDate: string; // Single-Day: identisch zu startDate
  isRange: boolean;
  isRecurring: boolean; // task.recur != null — fuer Recur-Symbol in der Tagesansicht
  time: string | null;
  durationMin: number | null;
  // Fuer atomType='link': originale URL (Click oeffnet sie).
  url?: string | null;
  // T.AC.D.3: nur fuer Recur-Instanzen gesetzt. instanceDate ist das
  // konkrete Vorkommen-Datum (= startDate fuer Recur-Instanzen).
  // instanceDone spiegelt task.done_occurrences.includes(instanceDate)
  // — der User toggelt das per Checkbox auf einer einzelnen Instanz.
  instanceDate?: string;
  instanceDone?: boolean;
  // T.AC.D.4: vollstaendige display_meta + originalManifId (= manifId
  // ohne Recur-Instanz-Suffix). Fuer Edit-Modal-Pre-Fill: Recur-Edit
  // muss den ANKER-Manif treffen, nicht eine Instanz, damit alle
  // Folgetermine konsistent angepasst werden.
  displayMeta?: Record<string, unknown>;
  originalManifId?: string;
};

export function buildEvents(args: {
  tasks: TaskRow[];
  manifestations: TaskManifestationRow[];
  // Phase 4 T.AC.B: enriched non-task atom_manifestations (kind='calendar'
  // mit atom_type IN ('link','checklist','doc')). Optional — alte
  // Aufrufer geben das Feld nicht mit, dann nur task-Events.
  atomManifestations?: Array<{
    id: string;
    atom_type: 'link' | 'checklist' | 'doc';
    atom_id: string;
    label: string;
    display_meta: Record<string, unknown>;
    url?: string | null;
  }>;
  // T.AC.D.2: viewRange (fromIso, toIso) aktiviert die Recur-Expansion.
  // Ohne viewRange wird recur als Marker (isRecurring=true) emittiert
  // aber nicht in Folgetermine zerlegt — backwards-compat fuer Aufrufer
  // die keinen Range haben (Smoketests, Smart-Summary).
  viewRange?: { fromIso: string; toIso: string };
}): CalendarEvent[] {
  const { tasks, manifestations, atomManifestations, viewRange } = args;
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const explicitTaskIds = new Set<string>();
  const out: CalendarEvent[] = [];

  // T.AC.D.2: Recur-Expander. Nimmt einen "Anker"-Event + RecurRule und
  // emittiert eine CalendarEvent-Instanz pro fire-date im Range.
  // Cap auf 366 Iterationen pro Event (Sicherheits-Limit gegen
  // pathologische Recur-Konfig). Manifestation-Recur gewinnt lokal —
  // siehe Plan T.AC: "Manifestation gewinnt lokal".
  //
  // T.AC.D.3: doneOccurrences (nur fuer Tasks gesetzt) ermoeglicht
  // pro-Instanz instanceDone-Markierung — User kann eine einzelne
  // Recur-Vorkommen abhaken ohne den Recur-Anker zu beruehren.
  function expandRecurOrSingle(
    base: CalendarEvent,
    recur: RecurRule | null,
    doneOccurrences?: string[] | null,
  ): void {
    if (!recur || !viewRange) {
      out.push(base);
      return;
    }
    // Recur-Expansion. base.startDate ist der Anker — zaehlt als 1.
    // Vorkommen bei recurFiresOn-Match. End-Rule (count) zaehlen wir
    // ueber die Schleife.
    const fromIsoLocal = viewRange.fromIso;
    const toIsoLocal = viewRange.toIso;
    const doneSet = new Set(doneOccurrences ?? []);
    let cur = fromIsoLocal;
    let safety = 0;
    let count = 0;
    const maxCount =
      recur.endType === 'count' && typeof recur.endCount === 'number'
        ? recur.endCount
        : Number.POSITIVE_INFINITY;
    // recurFiresOn akzeptiert RecurRule mit startDate-Anker. Wir setzen
    // den Anker auf base.startDate damit ein recurType='daily' nicht
    // den ganzen Range expandiert sondern erst ab Anker.
    const recurWithAnchor: RecurRule = { ...recur, startDate: base.startDate };
    while (cur <= toIsoLocal && safety < 366 && count < maxCount) {
      safety += 1;
      const d = fromIso(cur);
      if (recurFiresOn(recurWithAnchor, d)) {
        out.push({
          ...base,
          // Synth manifId pro Instanz, damit Click-Handler die Quelle
          // identifizieren koennen aber nicht eine reale Manif-ID kollidiert.
          manifId: base.manifId ? `${base.manifId}::${cur}` : null,
          startDate: cur,
          endDate: cur,
          isRange: false,
          isRecurring: true,
          instanceDate: cur,
          instanceDone: doneSet.has(cur),
        });
        count += 1;
      }
      cur = addDays(cur, 1);
    }
  }

  for (const m of manifestations) {
    if (m.kind !== 'calendar') continue;
    const t = taskById.get(m.task_id);
    if (!t) continue;
    explicitTaskIds.add(t.id);
    const dm = (m.display_meta ?? {}) as Record<string, unknown>;
    const startDate = (dm.start_date as string | undefined) ?? t.deadline ?? null;
    if (!startDate) continue;
    const endDate = (dm.end_date as string | undefined) ?? startDate;
    // Manifestation-Recur (display_meta.recur) gewinnt lokal vor task.recur.
    const manifRecur = (dm.recur as RecurRule | null | undefined) ?? null;
    const effectiveRecur = manifRecur ?? (t.recur as RecurRule | null) ?? null;
    const base: CalendarEvent = {
      atomType: 'task',
      atomId: t.id,
      taskId: t.id,
      manifId: m.id,
      originalManifId: m.id,
      label: t.label,
      status: t.status,
      startDate,
      endDate,
      isRange: endDate > startDate,
      isRecurring: effectiveRecur != null,
      time: (dm.time as string | undefined) ?? null,
      durationMin: (dm.duration_min as number | undefined) ?? null,
      displayMeta: dm,
    };
    expandRecurOrSingle(base, effectiveRecur, t.done_occurrences);
  }

  for (const t of tasks) {
    if (!t.deadline) continue;
    if (explicitTaskIds.has(t.id)) continue;
    const taskRecur = (t.recur as RecurRule | null) ?? null;
    const base: CalendarEvent = {
      atomType: 'task',
      atomId: t.id,
      taskId: t.id,
      manifId: null,
      originalManifId: undefined, // virtual: kein Manif-Edit-Pfad
      label: t.label,
      status: t.status,
      startDate: t.deadline,
      endDate: t.deadline,
      isRange: false,
      isRecurring: taskRecur != null,
      time: null,
      durationMin: null,
      displayMeta: undefined,
    };
    expandRecurOrSingle(base, taskRecur, t.done_occurrences);
  }

  // T.AC.B: non-task Atoms (Link/Checklist/Doc) als Calendar-Events.
  // Status-Konzept gilt fuer sie nicht → null. Recur lebt in display_meta.
  for (const a of atomManifestations ?? []) {
    const dm = (a.display_meta ?? {}) as Record<string, unknown>;
    const startDate = dm.start_date as string | undefined;
    if (!startDate) continue;
    const endDate = (dm.end_date as string | undefined) ?? startDate;
    const recur = (dm.recur as RecurRule | null | undefined) ?? null;
    const base: CalendarEvent = {
      atomType: a.atom_type,
      atomId: a.atom_id,
      taskId: a.atom_id,
      manifId: a.id,
      originalManifId: a.id,
      label: a.label,
      status: null,
      startDate,
      endDate,
      isRange: endDate > startDate,
      isRecurring: recur != null,
      time: (dm.time as string | undefined) ?? null,
      durationMin: (dm.duration_min as number | undefined) ?? null,
      url: a.url ?? null,
      displayMeta: dm,
    };
    expandRecurOrSingle(base, recur);
  }

  return out;
}

// Gruppe Events nach Tag (ISO). Range-Events erscheinen in JEDEM Tag
// von startDate bis endDate inklusiv (Render entscheidet, ob span-bar
// oder repeated item).
export function groupEventsByDay(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    let cur = e.startDate;
    let safety = 0;
    while (cur <= e.endDate && safety < 366) {
      const arr = map.get(cur) ?? [];
      arr.push(e);
      map.set(cur, arr);
      cur = addDays(cur, 1);
      safety += 1;
    }
  }
  // Stabile Reihenfolge pro Tag: Range-Events oben, dann nach time, dann nach label.
  for (const arr of map.values()) {
    arr.sort((a, b) => {
      if (a.isRange !== b.isRange) return a.isRange ? -1 : 1;
      const at = a.time ?? '';
      const bt = b.time ?? '';
      if (at !== bt) return at.localeCompare(bt);
      return a.label.localeCompare(b.label);
    });
  }
  return map;
}

// Tag-Status-Zusammenfassung fuer Mini-Calendar-Dot (T.1.G.B):
//   'overdue' = mind. ein Event ist ueberfaellig (deadline < today, nicht done)
//   'open'    = mind. ein Event ist aktiv (open/in_progress/blocked)
//   'done'    = alle Events sind done/archived
//   null      = kein Event an diesem Tag
export type DayStatus = 'overdue' | 'open' | 'done' | null;

export function dayStatus(events: CalendarEvent[], today: string, dayIso: string): DayStatus {
  if (events.length === 0) return null;
  let hasOpen = false;
  let allDone = true;
  for (const e of events) {
    const isOpen = e.status === 'open' || e.status === 'in_progress' || e.status === 'blocked';
    if (isOpen) hasOpen = true;
    if (e.status !== 'done' && e.status !== 'archived') allDone = false;
  }
  if (hasOpen && dayIso < today) return 'overdue';
  if (hasOpen) return 'open';
  if (allDone) return 'done';
  return 'open';
}
