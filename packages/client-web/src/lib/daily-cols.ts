// Daily-Cols: Konfiguration fuer die Aufgabenuebersicht-Spalten.
// Portiert aus dem HTML-Vorbild (matrix_tool_beta.html:6471+ -
// getTimeRange + DCTYPE_LABELS). Im HTML in appSettings gespeichert;
// hier pro Workspace in localStorage, weil es keinen Settings-Layer
// gibt.
//
// Eine DailyCol hat `id`, `label` (frei waehlbar), und `type` (eine
// der DailyColType-Optionen, definiert das Zeit-Fenster). Der User
// kann Spalten anlegen/umbenennen/loeschen (im Edit-Mode).

import { createSignal } from 'solid-js';
import type { KbCardRow } from './types';
import {
  getOccurrenceDatesInRange,
  recurFiresInRange,
  recurFiresOn,
  type RecurRule,
} from './recur';

export type DailyColType =
  | 'today'
  | 'thisweek'
  | 'nextweek'
  | 'thismonth'
  | 'nextmonth'
  | 'thisquarter'
  | 'thisyear'
  | 'nextyear'
  | 'nodate';

export type DailyCol = {
  id: string;
  label: string;
  type: DailyColType;
};

export const DCTYPE_LABELS: Record<DailyColType, string> = {
  today: 'Heute',
  thisweek: 'Diese Woche',
  nextweek: 'Naechste Woche',
  thismonth: 'Dieser Monat',
  nextmonth: 'Naechster Monat',
  thisquarter: 'Dieses Quartal',
  thisyear: 'Dieses Jahr',
  nextyear: 'Naechstes Jahr',
  nodate: 'Ohne Datum',
};

const DEFAULT_COLS: DailyCol[] = [
  { id: 'dc-today', label: 'Heute', type: 'today' },
  { id: 'dc-thisweek', label: 'Diese Woche', type: 'thisweek' },
  { id: 'dc-thismonth', label: 'Dieser Monat', type: 'thismonth' },
  { id: 'dc-nodate', label: 'Ohne Datum', type: 'nodate' },
];

function storageKey(workspaceId: string): string {
  return `matrix-daily-cols-${workspaceId}`;
}

export function loadDailyCols(workspaceId: string): DailyCol[] {
  try {
    const raw = localStorage.getItem(storageKey(workspaceId));
    if (!raw) return DEFAULT_COLS.slice();
    const parsed = JSON.parse(raw) as DailyCol[];
    if (!Array.isArray(parsed)) return DEFAULT_COLS.slice();
    return parsed;
  } catch {
    return DEFAULT_COLS.slice();
  }
}

export function saveDailyCols(workspaceId: string, cols: DailyCol[]): void {
  try {
    localStorage.setItem(storageKey(workspaceId), JSON.stringify(cols));
  } catch {
    /* ignore */
  }
}

// Reaktiver Hook fuer die Daily-Col-Liste. Eine Registry pro Workspace
// â€” alle TaskOverview-Instanzen teilen denselben Store, damit eine
// Mutation (add/rename/...) sofort ueberall ankommt. Persistiert nach
// jedem Mutate.
const REGISTRY = new Map<string, {
  cols: () => DailyCol[];
  setCols: (next: DailyCol[]) => void;
}>();

function uid(): string {
  return `dc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useDailyCols(workspaceId: string) {
  let entry = REGISTRY.get(workspaceId);
  if (!entry) {
    const [cols, setCols] = createSignal<DailyCol[]>(loadDailyCols(workspaceId));
    entry = {
      cols,
      setCols: (next) => {
        setCols(next);
        saveDailyCols(workspaceId, next);
      },
    };
    REGISTRY.set(workspaceId, entry);
  }
  const { cols, setCols } = entry;

  function add(type: DailyColType = 'today', label?: string): string {
    const id = uid();
    const newCol: DailyCol = {
      id,
      label: label ?? DCTYPE_LABELS[type],
      type,
    };
    setCols([...cols(), newCol]);
    return id;
  }

  function rename(id: string, label: string): void {
    setCols(cols().map((c) => (c.id === id ? { ...c, label } : c)));
  }

  function setType(id: string, type: DailyColType): void {
    setCols(
      cols().map((c) =>
        c.id === id
          ? {
              ...c,
              type,
              // Label nur dann automatisch anpassen, wenn er noch der
              // Default-Label des alten Typs war. So behaelt ein User-
              // custom-Label "Heute erledigt" beim Typ-Wechsel seinen
              // Custom-Text; der Default-Fall bekommt das frische Label.
              label:
                c.label === DCTYPE_LABELS[c.type]
                  ? DCTYPE_LABELS[type]
                  : c.label,
            }
          : c,
      ),
    );
  }

  function remove(id: string): void {
    setCols(cols().filter((c) => c.id !== id));
  }

  function move(id: string, dir: 'left' | 'right'): void {
    const list = cols();
    const idx = list.findIndex((c) => c.id === id);
    if (idx < 0) return;
    const target = dir === 'left' ? idx - 1 : idx + 1;
    if (target < 0 || target >= list.length) return;
    const next = list.slice();
    const [it] = next.splice(idx, 1);
    next.splice(target, 0, it);
    setCols(next);
  }

  function reset(): void {
    setCols(DEFAULT_COLS.slice());
  }

  return { cols, add, rename, setType, remove, move, reset };
}

function day0(d: Date): Date {
  const x = new Date(d.getTime());
  x.setHours(0, 0, 0, 0);
  return x;
}

export function getTimeRange(
  type: DailyColType,
  today: Date,
): { s: Date; e: Date } | null {
  const s = new Date(today);
  const e = new Date(today);
  if (type === 'today') return { s, e };
  if (type === 'thisweek') {
    s.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    e.setTime(s.getTime());
    e.setDate(s.getDate() + 6);
    return { s, e };
  }
  if (type === 'nextweek') {
    s.setDate(today.getDate() - ((today.getDay() + 6) % 7) + 7);
    e.setTime(s.getTime());
    e.setDate(s.getDate() + 6);
    return { s, e };
  }
  if (type === 'thismonth') {
    s.setDate(1);
    e.setFullYear(today.getFullYear(), today.getMonth() + 1, 0);
    return { s, e };
  }
  if (type === 'nextmonth') {
    s.setFullYear(today.getFullYear(), today.getMonth() + 1, 1);
    e.setFullYear(today.getFullYear(), today.getMonth() + 2, 0);
    return { s, e };
  }
  if (type === 'thisquarter') {
    const q = Math.floor(today.getMonth() / 3);
    s.setMonth(q * 3, 1);
    e.setMonth(q * 3 + 3, 0);
    return { s, e };
  }
  if (type === 'thisyear') {
    s.setMonth(0, 1);
    e.setMonth(11, 31);
    return { s, e };
  }
  if (type === 'nextyear') {
    s.setFullYear(today.getFullYear() + 1, 0, 1);
    e.setFullYear(today.getFullYear() + 1, 11, 31);
    return { s, e };
  }
  return null; // 'nodate'
}

// Prueft, ob eine Karte in eine Spalte gehoert. Deadline-basierte
// Karten matchen, wenn die Deadline im Zeit-Range liegt. Rekurrente
// Karten matchen, wenn sie im Range feuern (recurFiresInRange).
// 'nodate'-Spalte: nur Karten ohne Deadline und ohne Recur.
export function cardFitsCol(
  card: KbCardRow,
  col: DailyCol,
  today: Date,
): boolean {
  const recur = card.recur as RecurRule | null;
  const isRecur = !!recur && recur.type !== 'none';

  if (col.type === 'nodate') {
    return !card.deadline && !isRecur;
  }

  const range = getTimeRange(col.type, today);
  if (!range) return false;
  const { s, e } = range;
  const todayDay = day0(today);
  const dlDate = card.deadline ? day0(new Date(card.deadline)) : null;

  function inRange(d: Date | null): boolean {
    if (!d) return false;
    return d >= s && d <= e;
  }

  if (col.type === 'today') {
    if (dlDate && sameDay(dlDate, todayDay)) return true;
    if (isRecur && recurFiresOn(recur, todayDay)) return true;
    return false;
  }
  if (inRange(dlDate)) return true;
  if (isRecur && recurFiresInRange(recur, s, e)) return true;
  return false;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// Fuer rekurrente Karten: wenn alle Feuerungs-Daten im Range bereits
// als done_occurrence gebucht sind, Karte in der Spalte nicht zeigen.
export function allOccurrencesDoneInRange(
  card: KbCardRow,
  start: Date,
  end: Date,
): boolean {
  const dates = getOccurrenceDatesInRange(
    card.recur as RecurRule | null,
    start,
    end,
  );
  if (dates.length === 0) return false;
  const done = new Set(card.done_occurrences ?? []);
  return dates.every((d) => done.has(d));
}
