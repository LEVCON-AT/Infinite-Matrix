// Working-Hours pro User (Phase 4 T.1.G.B Stufe 3).
//
// Persistiert ueber `public.user_preferences.prefs.working_hours`
// (Migration 017). Nicht im Browser-localStorage — Multi-Device-Sync
// gewollt.
//
// Pattern: globales Solid-Signal als Source-of-Truth. Hydration beim
// Mount via `useWorkingHoursSync()`-Hook (analog `useUserPrefsSync`
// in lib/settings.ts). Save ist debounced + merged das prefs-Object
// (kein vollstaendiger Overwrite anderer Keys). Race-Fenster mit
// settings.ts-Save ist klein (beide debounced 500ms) — fuer V1 ok.
//
// Pro Wochentag: start + end + buffer-vor + buffer-nach (Minuten).
// Buffer-Bereiche werden in der Tagesansicht als getoente Streifen
// gerendert, damit Tasks dort sichtbar bleiben aber visuell vom
// Hauptarbeitstag getrennt sind.

import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';
import { useSession } from './auth';
import { isNetworkError } from './mutation-queue';
import { supabase } from './supabase';
import { loadUserPrefs } from './user-prefs';

export type DayHours = {
  start: string; // 'HH:MM'
  end: string; // 'HH:MM'
  buffer_before_min: number; // 0-180
  buffer_after_min: number; // 0-180
  enabled: boolean; // false = kein Arbeitstag → Tagesansicht zeigt Hinweis
};

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export type WorkingHours = Record<Weekday, DayHours>;

export const WEEKDAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export const WEEKDAY_LABEL_DE: Record<Weekday, string> = {
  mon: 'Montag',
  tue: 'Dienstag',
  wed: 'Mittwoch',
  thu: 'Donnerstag',
  fri: 'Freitag',
  sat: 'Samstag',
  sun: 'Sonntag',
};

const DEFAULT_WORKDAY: DayHours = {
  start: '09:00',
  end: '17:00',
  buffer_before_min: 0,
  buffer_after_min: 0,
  enabled: true,
};

const DEFAULT_OFFDAY: DayHours = {
  start: '09:00',
  end: '17:00',
  buffer_before_min: 0,
  buffer_after_min: 0,
  enabled: false,
};

export function defaultWorkingHours(): WorkingHours {
  return {
    mon: { ...DEFAULT_WORKDAY },
    tue: { ...DEFAULT_WORKDAY },
    wed: { ...DEFAULT_WORKDAY },
    thu: { ...DEFAULT_WORKDAY },
    fri: { ...DEFAULT_WORKDAY },
    sat: { ...DEFAULT_OFFDAY },
    sun: { ...DEFAULT_OFFDAY },
  };
}

function mergeWithDefault(partial: Partial<WorkingHours> | undefined): WorkingHours {
  const def = defaultWorkingHours();
  if (!partial) return def;
  for (const d of WEEKDAYS) {
    const incoming = (partial as Record<Weekday, Partial<DayHours>>)[d];
    if (incoming && typeof incoming === 'object') {
      def[d] = { ...def[d], ...incoming };
    }
  }
  return def;
}

// ─── Globales Signal ──────────────────────────────────────────
const [workingHoursSignal, setWorkingHoursSignal] = createSignal<WorkingHours>(
  defaultWorkingHours(),
);

export const workingHours: Accessor<WorkingHours> = workingHoursSignal;

export function setWorkingHours(h: WorkingHours): void {
  setWorkingHoursSignal(h);
}

// ─── Sync-Hook fuer App-Bootstrap ─────────────────────────────
// Verwendung: in App.tsx einmalig aufrufen — wie useUserPrefsSync.
// Hydratet beim Login aus user_preferences.prefs.working_hours,
// debouncet Saves bei Aenderungen.
export function useWorkingHoursSync(): void {
  const session = useSession();
  let hydrated = false;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  createEffect(() => {
    const s = session();
    if (!s) {
      hydrated = false;
      return;
    }
    void (async () => {
      try {
        const remote = await loadUserPrefs();
        const wh = (remote?.prefs as Record<string, unknown> | undefined)?.working_hours as
          | Partial<WorkingHours>
          | undefined;
        setWorkingHoursSignal(mergeWithDefault(wh));
      } finally {
        hydrated = true;
      }
    })();
  });

  createEffect(() => {
    const cur = workingHoursSignal();
    if (!hydrated) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void saveWorkingHoursToDb(cur);
    }, 500);
  });

  const onOnline = () => {
    if (!hydrated) return;
    void saveWorkingHoursToDb(workingHoursSignal());
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('online', onOnline);
  }

  onCleanup(() => {
    if (saveTimer) clearTimeout(saveTimer);
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', onOnline);
    }
  });
}

// Schreibt working_hours in user_preferences.prefs, mergt mit existierendem
// prefs-Object (kein Overwrite anderer Keys wie vis/activity/...).
async function saveWorkingHoursToDb(h: WorkingHours): Promise<void> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id;
    if (!userId) return;
    // Aktuellen prefs-Stand lesen, working_hours-Sub-Key ueberschreiben.
    const { data: existing, error: readErr } = await supabase
      .from('user_preferences')
      .select('prefs')
      .eq('user_id', userId)
      .maybeSingle();
    if (readErr) throw readErr;
    const cur = ((existing?.prefs as Record<string, unknown> | null) ?? {}) as Record<
      string,
      unknown
    >;
    const next = { ...cur, working_hours: h };
    const { error } = await supabase
      .from('user_preferences')
      .upsert({ user_id: userId, prefs: next }, { onConflict: 'user_id' });
    if (error) throw error;
  } catch (err) {
    if (isNetworkError(err)) return;
    console.error('saveWorkingHoursToDb:', err);
  }
}

// ─── Helpers ──────────────────────────────────────────────────
const DAY_KEY: Record<number, Weekday> = {
  0: 'sun',
  1: 'mon',
  2: 'tue',
  3: 'wed',
  4: 'thu',
  5: 'fri',
  6: 'sat',
};

export function getDayHoursFor(date: Date, h: WorkingHours): DayHours {
  return h[DAY_KEY[date.getDay()]];
}

export function parseHHMM(t: string): number {
  const [h, m] = t.split(':').map((x) => Number.parseInt(x, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

export function formatHHMM(min: number): string {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(min)));
  const h = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `${h}:${mm}`;
}

export function visibleRangeForDay(
  date: Date,
  h: WorkingHours,
): {
  startMin: number;
  endMin: number;
  mainStartMin: number;
  mainEndMin: number;
  enabled: boolean;
} {
  const day = getDayHoursFor(date, h);
  const mainStart = parseHHMM(day.start);
  const mainEnd = parseHHMM(day.end);
  return {
    startMin: Math.max(0, mainStart - day.buffer_before_min),
    endMin: Math.min(24 * 60, mainEnd + day.buffer_after_min),
    mainStartMin: mainStart,
    mainEndMin: mainEnd,
    enabled: day.enabled,
  };
}
