// Day-View-Layout-Helper (Phase 4 T.1.G.B Stufe 2).
//
// Transformiert CalendarEvents in absolute Positionen fuer das
// Stunden-Grid der Tagesansicht. Trennt Multi-Day-Events (oben in
// der All-Day-Bar) von Timed-Events (im Hauptbereich) und ordnet
// Overlap-Events in Spalten ein (klassischer Greedy-Algorithmus
// wie in Outlook/Google-Calendar).

import type { CalendarEvent } from './calendar';
import { parseHHMM } from './working-hours';

const DEFAULT_DURATION_MIN = 30; // Single-Click-Default fuer Events ohne Zeit/Dauer

export type TimedEventLayout = {
  event: CalendarEvent;
  startMin: number; // Minuten relativ zum visibleStartMin (gerade nach unten)
  durationMin: number;
  column: number; // 0..maxCol-1
  totalCols: number; // Anzahl simultaner Spalten in der Overlap-Gruppe
  hasTime: boolean; // false = ganztaegig fuer den Tag (kein time-Wert), wird bei dayStart positioniert
};

export type DayLayoutResult = {
  multiDay: CalendarEvent[]; // mehrtaegige Events (in der All-Day-Bar oben)
  timed: TimedEventLayout[]; // Events im Stunden-Grid
  // Maximale Anzahl Spalten ueber alle Overlap-Gruppen — fuer Container-Width-Hinweis.
  maxColumns: number;
};

// Hauptfunktion: layoutet die Events eines Tages.
//
// `dayIso` = der Tag, der gerade gerendert wird ('YYYY-MM-DD').
// `events` = die Events des Tages (aus eventsByDay.get(dayIso) ?? []).
// `visibleStartMin` / `visibleEndMin` = Sichtbarer Bereich in Minuten
//   (typisch 09:00 - buffer_before bis 17:00 + buffer_after, also
//   z.B. 480-1080).
//
// Ergebnis-Positionen sind in MINUTEN relativ zum visibleStartMin —
// der Renderer multipliziert mit pixelPerMinute fuer das Top-Offset.
export function layoutDay(args: {
  dayIso: string;
  events: CalendarEvent[];
  visibleStartMin: number;
  visibleEndMin: number;
}): DayLayoutResult {
  const { events, visibleStartMin, visibleEndMin } = args;

  const multiDay: CalendarEvent[] = [];
  type Pre = { event: CalendarEvent; startMin: number; endMin: number; hasTime: boolean };
  const candidates: Pre[] = [];

  for (const e of events) {
    if (e.isRange) {
      multiDay.push(e);
      continue;
    }
    // Single-Day: Position aus display_meta.time. Ohne time → bei
    // visibleStartMin (Tagesbeginn) als ganztaegiger Eintrag in der
    // ersten sichtbaren Stunde.
    const hasTime = !!e.time;
    const startMin = hasTime ? parseHHMM(e.time as string) : visibleStartMin;
    const duration = e.durationMin ?? DEFAULT_DURATION_MIN;
    const endMin = startMin + Math.max(15, duration); // mindestens 15min damit es sichtbar bleibt
    // Ausserhalb des sichtbaren Bereichs? Wir clippen aber rendern trotzdem.
    if (endMin <= visibleStartMin || startMin >= visibleEndMin) {
      // Komplett ausserhalb — wir zeigen es trotzdem als Marker am
      // Rand. Vereinfachung V1: wir packen es an die naechste
      // Sichtgrenze.
      const clampedStart = Math.max(visibleStartMin, Math.min(visibleEndMin - 15, startMin));
      candidates.push({ event: e, startMin: clampedStart, endMin: clampedStart + 15, hasTime });
    } else {
      candidates.push({
        event: e,
        startMin: Math.max(visibleStartMin, startMin),
        endMin: Math.min(visibleEndMin, endMin),
        hasTime,
      });
    }
  }

  // Stabile Sortierung: nach startMin, dann nach endMin desc (laenger zuerst → bessere Spalten-Allocation).
  candidates.sort((a, b) => {
    if (a.startMin !== b.startMin) return a.startMin - b.startMin;
    return b.endMin - a.endMin;
  });

  // Greedy-Spalten-Allocation: pro Event die kleinste freie Spalte
  // zuweisen. Spalten-Endzeiten merken; eine Spalte ist "frei" wenn
  // ihre letzte Endzeit ≤ Event-Start ist.
  const colEnds: number[] = [];
  const layouts: Array<TimedEventLayout & { _groupIdx: number }> = [];
  // Overlap-Gruppen: zusammenhaengende Events mit Spalten-Sharing.
  // groupIdx fuer die Berechnung von totalCols (alle Events derselben
  // Gruppe bekommen den max-col-count des Pakets).
  let groupIdx = 0;
  let groupMaxCol = 0;
  let groupEndMin = Number.NEGATIVE_INFINITY;

  for (const c of candidates) {
    if (c.startMin >= groupEndMin) {
      // Neue Gruppe beginnt — vorheriges totalCols nachtragen.
      for (let i = layouts.length - 1; i >= 0; i--) {
        if (layouts[i]._groupIdx !== groupIdx) break;
        layouts[i].totalCols = groupMaxCol;
      }
      groupIdx += 1;
      groupMaxCol = 0;
      groupEndMin = Number.NEGATIVE_INFINITY;
      colEnds.length = 0;
    }
    let col = colEnds.findIndex((endMin) => endMin <= c.startMin);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(c.endMin);
    } else {
      colEnds[col] = c.endMin;
    }
    groupMaxCol = Math.max(groupMaxCol, col + 1);
    groupEndMin = Math.max(groupEndMin, c.endMin);
    layouts.push({
      event: c.event,
      startMin: c.startMin - visibleStartMin,
      durationMin: c.endMin - c.startMin,
      column: col,
      totalCols: 0, // wird nachtraeglich gesetzt
      hasTime: c.hasTime,
      _groupIdx: groupIdx,
    });
  }
  // Letzte Gruppe nachtragen.
  for (let i = layouts.length - 1; i >= 0; i--) {
    if (layouts[i]._groupIdx !== groupIdx) break;
    layouts[i].totalCols = groupMaxCol;
  }

  const maxColumns = layouts.reduce((max, l) => Math.max(max, l.totalCols), 1);

  // Stable sort fuer den Caller: nach startMin asc.
  layouts.sort((a, b) => a.startMin - b.startMin);

  return {
    multiDay,
    timed: layouts.map(({ _groupIdx, ...rest }) => rest),
    maxColumns,
  };
}

// Time-zu-Pixel-Mapping: liefert das CSS-Top-Offset in Pixeln.
//   topPx = (startMin - visibleStartMin) * pixelsPerMinute
//   heightPx = durationMin * pixelsPerMinute
export function topPx(startMinRelative: number, pixelsPerMinute: number): number {
  return startMinRelative * pixelsPerMinute;
}

export function heightPx(durationMin: number, pixelsPerMinute: number): number {
  return Math.max(16, durationMin * pixelsPerMinute);
}

// Pro-Event Spalten-Breite + Left-Offset in Prozent.
export function columnGeometry(
  column: number,
  totalCols: number,
): { leftPct: number; widthPct: number } {
  const w = 100 / totalCols;
  return { leftPct: column * w, widthPct: w };
}
