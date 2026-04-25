// Helpers fuer rekurrente Karten.
//
// Konvention aus dem HTML-Vorbild (packages/client-standalone/matrix.html):
//  - Eine Karte mit `recur.type !== 'none'` wird NIE auf `card.done=true`
//    gesetzt. Stattdessen wird der heutige Tag (YYYY-MM-DD) in
//    `card.done_occurrences[]` gepusht.
//  - "Heute erledigt?" ist dann: `done_occurrences.includes(todayIso())`.
//  - Non-recur Karten verwenden weiter das boolean-Feld `card.done`.
//
// So kann dieselbe Karte-Row beliebig oft "wiederkehren", ohne dass
// eine neue Instanz gespawnt wird — der Nutzer sieht immer die eine
// Karte und deren Historie an Abhak-Daten.

import type { KbCardRow } from './types';

export function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isRecurCard(card: KbCardRow): boolean {
  const r = card.recur;
  if (!r || typeof r !== 'object') return false;
  const t = (r as { type?: unknown }).type;
  return typeof t === 'string' && t !== 'none';
}

export function isCardDone(card: KbCardRow): boolean {
  if (isRecurCard(card)) {
    return (card.done_occurrences ?? []).includes(todayIso());
  }
  return card.done;
}

// Pure: gibt das neue done_occurrences-Array zurueck, nachdem heute
// hinzugefuegt ODER entfernt wurde (je nach Wunsch). Existierende
// Eintraege bleiben erhalten.
export function toggleOccurrence(
  occurrences: string[] | null | undefined,
  date: string,
  done: boolean,
): string[] {
  const list = occurrences ?? [];
  if (done) {
    if (list.includes(date)) return list;
    return [...list, date];
  }
  return list.filter((d) => d !== date);
}

// ─── recurFiresOn: portiert aus matrix_tool_beta.html:6603 ───────
// Prueft, ob eine Recur-Regel an einem bestimmten Datum feuert.
// Alle Edge-Cases (weekly.weekdays, monthly.monthType='weekday',
// yearly.yearMonth+yearDay, every-Intervall, endType/endDate) werden
// uebernommen.
//
// Datum-Normalisierung: day0() schneidet Stunden/Minuten ab.

export type RecurRule = {
  type?: string;
  every?: number;
  startDate?: string;
  endType?: string;
  endDate?: string;
  endCount?: number;
  weekdays?: number[]; // Mon=0..Sun=6
  weekday?: number; // legacy single-value
  weekdayOrd?: number; // fuer monthly/yearly (monthType='weekday'): 1..4, -1
  monthType?: 'day' | 'weekday';
  day?: number; // 1..31 fuer monthly monthType='day'
  yearMonth?: number; // 0..11 fuer yearly
  anchorMonth?: number; // legacy
  yearDay?: number; // 1..31 fuer yearly
  anchorDay?: number; // legacy
};

function day0(d: Date | string): Date {
  const dt = typeof d === 'string' ? new Date(d) : new Date(d.getTime());
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function recurFiresOn(
  r: RecurRule | null | undefined,
  date: Date,
): boolean {
  if (!r || !r.type || r.type === 'none') return false;

  if (r.endType === 'date' && r.endDate) {
    const ed = day0(r.endDate);
    if (date > ed) return false;
  }
  if (r.startDate) {
    const sd = day0(r.startDate);
    if (date < sd) return false;
  }

  const every = r.every || 1;

  if (r.type === 'daily') {
    if (!r.startDate) return true;
    const sd = day0(r.startDate);
    const diff = Math.round((date.getTime() - sd.getTime()) / 86400000);
    return diff >= 0 && diff % every === 0;
  }

  if (r.type === 'weekly') {
    // weekdays in Mon=0..Sun=6 unseres Schemas; JS getDay: Sun=0..Sat=6.
    const wd = r.weekdays || (r.weekday !== undefined ? [r.weekday] : [0]);
    const jsDay = date.getDay();
    const ourDay = jsDay === 0 ? 6 : jsDay - 1;
    if (!wd.includes(ourDay)) return false;
    if (every === 1) return true;
    if (!r.startDate) return true;
    const sd = day0(r.startDate);
    const dayDiff = Math.round(
      (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) -
        Date.UTC(sd.getFullYear(), sd.getMonth(), sd.getDate())) /
        86400000,
    );
    const weekDiff = Math.floor(dayDiff / 7);
    return weekDiff >= 0 && weekDiff % every === 0;
  }

  if (r.type === 'monthly') {
    let fires = false;
    if (r.monthType === 'weekday') {
      const wd = r.weekday || 0;
      const ord = r.weekdayOrd || 1;
      const jsWd = wd === 6 ? 0 : wd + 1;
      if (ord === -1) {
        const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
        while (last.getDay() !== jsWd) last.setDate(last.getDate() - 1);
        fires = sameDay(date, last);
      } else {
        const first = new Date(date.getFullYear(), date.getMonth(), 1);
        let count = 0;
        const d = new Date(first);
        while (d.getMonth() === date.getMonth()) {
          if (d.getDay() === jsWd) {
            count++;
            if (count === ord) {
              fires = sameDay(date, d);
              break;
            }
          }
          d.setDate(d.getDate() + 1);
        }
      }
    } else {
      fires = date.getDate() === (r.day || 1);
    }
    if (!fires) return false;
    if (every === 1) return true;
    if (!r.startDate) return true;
    const sd = day0(r.startDate);
    const mDiff =
      (date.getFullYear() - sd.getFullYear()) * 12 +
      (date.getMonth() - sd.getMonth());
    return mDiff >= 0 && mDiff % every === 0;
  }

  if (r.type === 'yearly') {
    const month = r.yearMonth !== undefined ? r.yearMonth : r.anchorMonth || 0;
    if (date.getMonth() !== month) return false;
    let fires = false;
    if (r.monthType === 'weekday') {
      const wd = r.weekday || 0;
      const ord = r.weekdayOrd || 1;
      const jsWd = wd === 6 ? 0 : wd + 1;
      if (ord === -1) {
        const last = new Date(date.getFullYear(), month + 1, 0);
        while (last.getDay() !== jsWd) last.setDate(last.getDate() - 1);
        fires = sameDay(date, last);
      } else {
        const first = new Date(date.getFullYear(), month, 1);
        let count = 0;
        const d = new Date(first);
        while (d.getMonth() === month) {
          if (d.getDay() === jsWd) {
            count++;
            if (count === ord) {
              fires = sameDay(date, d);
              break;
            }
          }
          d.setDate(d.getDate() + 1);
        }
      }
    } else {
      fires = date.getDate() === (r.yearDay || r.anchorDay || 1);
    }
    if (!fires) return false;
    if (every === 1) return true;
    if (!r.startDate) return true;
    const sd = day0(r.startDate);
    const yDiff = date.getFullYear() - sd.getFullYear();
    return yDiff >= 0 && yDiff % every === 0;
  }

  return false;
}

export function recurFiresInRange(
  r: RecurRule | null | undefined,
  start: Date,
  end: Date,
): boolean {
  if (!r || !r.type || r.type === 'none') return false;
  // endCount: wenn bereits vor `start` oft genug gefeuert, ist die
  // Regel abgelaufen.
  if (r.endType === 'count' && r.endCount && r.startDate) {
    const sd = day0(r.startDate);
    let count = 0;
    const d2 = new Date(sd);
    while (d2 < start) {
      if (recurFiresOn(r, d2)) count++;
      d2.setDate(d2.getDate() + 1);
    }
    if (count >= r.endCount) return false;
  }
  const d = new Date(start);
  while (d <= end) {
    if (recurFiresOn(r, d)) return true;
    d.setDate(d.getDate() + 1);
  }
  return false;
}

// Menschenlesbare Zusammenfassung fuer Badges + Modal-Header.
// Port aus HTML recurLabel. Kompakt-Form ohne End-Regel (die steht
// separat). Beispiele:
//   daily, every=1             → "taeglich"
//   daily, every=3             → "alle 3 Tage"
//   weekly, weekdays=[0,2]     → "Mo, Mi"
//   weekly, every=2 [0]        → "alle 2 Wochen (Mo)"
//   monthly, day=15            → "monatlich am 15."
//   monthly, weekday=0 ord=2   → "jeden 2. Mo im Monat"
//   yearly, yearMonth=3 day=24 → "jaehrlich am 24. Apr"
const WD_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const WD_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mrz', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const ORD_LABEL: Record<number, string> = {
  1: '1.',
  2: '2.',
  3: '3.',
  4: '4.',
  [-1]: 'letzten',
};

function weekdaysOf(r: RecurRule): number[] {
  if (Array.isArray(r.weekdays) && r.weekdays.length > 0) return r.weekdays;
  if (typeof r.weekday === 'number') return [r.weekday];
  return [];
}

export function recurHumanLabel(r: RecurRule | null | undefined): string {
  if (!r || !r.type || r.type === 'none') return '';
  const every = r.every ?? 1;

  if (r.type === 'daily') {
    return every === 1 ? 'taeglich' : `alle ${every} Tage`;
  }

  if (r.type === 'weekly') {
    const wd = weekdaysOf(r);
    const days = wd.length > 0 ? wd.map((d) => WD_SHORT[d] ?? '?').join(', ') : 'keine Tage';
    if (every === 1) return days;
    return `alle ${every} Wochen (${days})`;
  }

  if (r.type === 'monthly') {
    const intvl = every === 1 ? 'monatlich' : `alle ${every} Monate`;
    if (r.monthType === 'weekday') {
      const wd = typeof r.weekday === 'number' ? r.weekday : 0;
      const ord = r.weekdayOrd ?? 1;
      return `jeden ${ORD_LABEL[ord] ?? ord + '.'} ${WD_LONG[wd] ?? '?'} im Monat${every === 1 ? '' : ` (${intvl})`}`;
    }
    return `${intvl} am ${r.day ?? 1}.`;
  }

  if (r.type === 'yearly') {
    const intvl = every === 1 ? 'jaehrlich' : `alle ${every} Jahre`;
    const month = r.yearMonth !== undefined ? r.yearMonth : (r.anchorMonth ?? 0);
    const monthLabel = MONTH_SHORT[month] ?? '?';
    if (r.monthType === 'weekday') {
      const wd = typeof r.weekday === 'number' ? r.weekday : 0;
      const ord = r.weekdayOrd ?? 1;
      return `${intvl}, ${ORD_LABEL[ord] ?? ord + '.'} ${WD_LONG[wd] ?? '?'} im ${monthLabel}`;
    }
    const day = r.yearDay ?? r.anchorDay ?? 1;
    return `${intvl} am ${day}. ${monthLabel}`;
  }

  return '';
}

// Ende-Regel lesbar (separat, damit die Bubble ueber dem Badge klein
// bleibt). "ohne Ende" wird weggelassen — nur date/count liefern Text.
export function recurEndLabel(r: RecurRule | null | undefined): string {
  if (!r || !r.type || r.type === 'none') return '';
  if (r.endType === 'date' && r.endDate) {
    const d = new Date(r.endDate);
    return `bis ${d.toLocaleDateString('de-DE')}`;
  }
  if (r.endType === 'count' && r.endCount && r.endCount > 0) {
    return `${r.endCount} Termine`;
  }
  return '';
}

// Liefert alle Datums-Strings (YYYY-MM-DD) im Range in denen
// die Regel feuert. Fuer TaskOverview-allOccurrencesDoneInRange.
export function getOccurrenceDatesInRange(
  r: RecurRule | null | undefined,
  start: Date,
  end: Date,
): string[] {
  const out: string[] = [];
  if (!r || !r.type || r.type === 'none') return out;
  const d = new Date(start);
  while (d <= end) {
    if (recurFiresOn(r, d)) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      out.push(`${y}-${m}-${day}`);
    }
    d.setDate(d.getDate() + 1);
  }
  return out;
}
