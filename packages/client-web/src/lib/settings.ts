// App-Settings (persistent, pro Browser-Profil).
//
// Portierung des appSettings-Vis-Patterns aus dem HTML-Vorbild
// (matrix_tool_beta.html ~1303+): pro UI-Gruppe ein Key mit Wert
// 'edit' | 'always' | 'never'. `useVis(key)` kombiniert das mit dem
// globalen Edit-Mode zu einer reaktiven boolean — so kann jedes
// Consumer-Element anstelle von `editMode()` die feinere Variante
// nutzen und der User togglet im Settings-Modal, ob ein Button immer
// oder nur im Edit-Mode sichtbar sein soll.
//
// Persistenz: localStorage unter `matrix-client-web-settings`. Die
// in-memory Kopie ist ein SolidJS-Signal — Modal-Writes und
// Consumer-Reads gehen ueber denselben reaktiven Pfad.
//
// Scope-Hinweis: der Storage-Key ist BEWUSST nicht workspace-scoped.
// Die Settings hier (vis-Flags fuer Buttons/Edit-Mode-Pattern)
// betreffen das UI-Verhalten, nicht die Daten — ein User, der die
// "Daily-Col-Edit-immer-an"-Option in einem Workspace setzt, will
// das selbe Verhalten typischerweise auch in seinen anderen
// Workspaces. Wenn spaeter pro-Workspace-Settings dazukommen, sollte
// das ein separater Storage-Slot sein, kein Sub-Tree dieses Schluessels.

import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import { useSession } from './auth';
import { useEditMode } from './edit-mode';
import { type UserPrefs, loadUserPrefs, saveUserPrefs } from './user-prefs';
import { useViewerActive } from './workspace-role';

export type VisValue = 'edit' | 'always' | 'never';

// Phase-1.C: Aktivitaets-Sichtbarkeit fuer Multi-User-Awareness.
// 'off'      — Channel wird nicht subscribed, User ist fuer andere unsichtbar.
// 'present'  — wie bisher: nur Avatar im Online-Stack.
// 'full'     — zusaetzlich Position (nodeId/cellId/feature) im Track-Payload.
export type ActivityLevel = 'off' | 'present' | 'full';

export type VisKey =
  | 'addRowCol'
  | 'deleteRowCol'
  | 'renameHeaders'
  | 'moveArrows'
  | 'transpose'
  | 'exportImport'
  | 'alias'
  | 'addKbCol'
  | 'colorPicker'
  | 'addFeature'
  | 'addInfoField'
  | 'deleteItems'
  | 'dailyColEdit'
  | 'sbCtxFeature'
  | 'sbCtxContent';

export type AppSettings = {
  vis: Record<VisKey, VisValue>;
  activity: { level: ActivityLevel };
};

export const VIS_LABELS: Record<VisKey, string> = {
  addRowCol: 'Zeile/Spalte hinzufuegen',
  deleteRowCol: 'Zeile/Spalte loeschen',
  renameHeaders: 'Header umbenennen',
  moveArrows: 'Verschiebe-Pfeile',
  transpose: 'Transponieren-Button',
  exportImport: 'Export / Import',
  alias: 'Kuerzel-Eingabe',
  addKbCol: 'Kanban-Spalte hinzufuegen',
  colorPicker: 'Farbauswahl',
  addFeature: 'Feature-Anlage (Matrix/Board/Info/Checklisten)',
  addInfoField: 'Felder / Links / Checklisten anlegen',
  deleteItems: 'Loesch-Buttons',
  dailyColEdit: 'Tagesuebersicht-Spalten bearbeiten',
  sbCtxFeature: 'Sidebar: Feature-Anlage',
  sbCtxContent: 'Sidebar: Inhalts-Anlage',
};

export const VIS_OPTIONS: ReadonlyArray<readonly [VisValue, string]> = [
  ['edit', 'Nur Edit-Modus'],
  ['always', 'Immer sichtbar'],
  ['never', 'Ausgeblendet'],
] as const;

export const ACTIVITY_OPTIONS: ReadonlyArray<readonly [ActivityLevel, string, string]> = [
  ['full', 'Vollstaendig', 'Avatar im Online-Stack + aktuelle Position (Matrix/Cell).'],
  ['present', 'Anwesend', 'Nur Avatar im Online-Stack — keine Position.'],
  ['off', 'Aus', 'Komplett unsichtbar fuer andere — kein Avatar, kein Hinweis.'],
] as const;

// Gruppierung fuer die Modal-Darstellung. Reine Kosmetik — die Keys
// bleiben flach. Reihenfolge wirkt sich aufs Rendering aus.
export const VIS_GROUPS: ReadonlyArray<{ title: string; keys: VisKey[] }> = [
  {
    title: 'Matrix',
    keys: ['addRowCol', 'deleteRowCol', 'renameHeaders', 'moveArrows', 'transpose'],
  },
  {
    title: 'Zellen',
    keys: ['addFeature', 'addInfoField', 'alias'],
  },
  {
    title: 'Kanban',
    keys: ['addKbCol', 'colorPicker'],
  },
  {
    title: 'Aufgabenuebersicht',
    keys: ['dailyColEdit'],
  },
  {
    title: 'Sidebar',
    keys: ['sbCtxFeature', 'sbCtxContent'],
  },
  {
    title: 'Allgemein',
    keys: ['deleteItems', 'exportImport'],
  },
];

export const DEFAULT_SETTINGS: AppSettings = {
  vis: {
    addRowCol: 'edit',
    deleteRowCol: 'edit',
    renameHeaders: 'edit',
    moveArrows: 'edit',
    transpose: 'edit',
    exportImport: 'edit',
    alias: 'edit',
    addKbCol: 'edit',
    colorPicker: 'edit',
    addFeature: 'edit',
    addInfoField: 'edit',
    deleteItems: 'edit',
    dailyColEdit: 'edit',
    sbCtxFeature: 'edit',
    sbCtxContent: 'always',
  },
  activity: { level: 'present' },
};

const STORAGE_KEY = 'matrix-client-web-settings';

function clone(s: AppSettings): AppSettings {
  return { vis: { ...s.vis }, activity: { ...s.activity } };
}

function loadFromStorage(): AppSettings {
  if (typeof localStorage === 'undefined') return clone(DEFAULT_SETTINGS);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return clone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const merged = clone(DEFAULT_SETTINGS);
    if (parsed?.vis && typeof parsed.vis === 'object') {
      for (const k of Object.keys(DEFAULT_SETTINGS.vis) as VisKey[]) {
        const v = (parsed.vis as Record<string, unknown>)[k];
        if (v === 'edit' || v === 'always' || v === 'never') {
          merged.vis[k] = v;
        }
      }
    }
    if (parsed?.activity && typeof parsed.activity === 'object') {
      const lvl = (parsed.activity as Record<string, unknown>).level;
      if (lvl === 'off' || lvl === 'present' || lvl === 'full') {
        merged.activity.level = lvl;
      }
    }
    return merged;
  } catch {
    return clone(DEFAULT_SETTINGS);
  }
}

function persistToStorage(s: AppSettings) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Quota voll oder deaktiviert — schweigend weiter; das Setting
    // lebt dann nur fuer die aktuelle Session.
  }
}

const [settings, setSettings] = createSignal<AppSettings>(loadFromStorage());

export function useSettings(): Accessor<AppSettings> {
  return settings;
}

export function setVis(key: VisKey, value: VisValue): void {
  const next = clone(settings());
  next.vis[key] = value;
  setSettings(next);
  persistToStorage(next);
}

export function setActivityLevel(level: ActivityLevel): void {
  const next = clone(settings());
  next.activity.level = level;
  setSettings(next);
  persistToStorage(next);
}

export function useActivityLevel(): Accessor<ActivityLevel> {
  return createMemo(() => settings().activity.level);
}

export function resetSettings(): void {
  const next = clone(DEFAULT_SETTINGS);
  setSettings(next);
  persistToStorage(next);
}

// Reaktiver Helfer: true, wenn die UI-Gruppe sichtbar sein soll.
// Verbindet vis-Value mit Edit-Mode. Nur in Komponenten nutzen —
// useEditMode() greift auf das SolidJS-Signal zu.
export function useVis(key: VisKey): Accessor<boolean> {
  const editMode = useEditMode();
  const viewerActive = useViewerActive();
  return createMemo(() => {
    // Phase 1 P1.B.3: Viewer hat keine schreibenden Edit-UI, egal was
    // der User unter "Sichtbarkeit" eingestellt hat (auch 'always').
    // RLS blockt Writes ohnehin — diese Sperre vermeidet die Verwirrung
    // sichtbarer-aber-nicht-funktionierender Edit-Buttons.
    if (viewerActive()) return false;
    const v = settings().vis[key] ?? 'edit';
    if (v === 'always') return true;
    if (v === 'never') return false;
    return editMode();
  });
}

// ─── DB-Sync (Sprint US) ─────────────────────────────────────
// Beim Login die DB-Praeferenzen pullen und in den lokalen Store
// mergen. Bei Aenderung debounced zurueckschreiben.
//
// Strategie: Last-Write-Wins via updated_at-Trigger in DB. Beim Mount
// gewinnt die DB (User hat sich gerade neu authentisiert, Server-State
// ist kanonisch). Lokale Aenderungen pushen wir mit 500ms Debounce —
// damit ein "Slider 5x verschieben" nicht 5 RPC-Calls erzeugt.

function applyRemoteToSettings(remote: UserPrefs): AppSettings {
  // Identisches Parse-Pattern wie loadFromStorage — fehlende/ungueltige
  // Keys fallen auf Default zurueck. Validieren-statt-Vertrauen, weil
  // jsonb potentiell alles sein koennte (z.B. von alter Client-Version).
  const merged = clone(DEFAULT_SETTINGS);
  if (remote.vis && typeof remote.vis === 'object') {
    for (const k of Object.keys(DEFAULT_SETTINGS.vis) as VisKey[]) {
      const v = (remote.vis as Record<string, unknown>)[k];
      if (v === 'edit' || v === 'always' || v === 'never') merged.vis[k] = v;
    }
  }
  if (remote.activity && typeof remote.activity === 'object') {
    const lvl = (remote.activity as Record<string, unknown>).level;
    if (lvl === 'off' || lvl === 'present' || lvl === 'full') {
      merged.activity.level = lvl;
    }
  }
  return merged;
}

export function useUserPrefsSync(): void {
  const session = useSession();
  let prefsHydrated = false;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  // Hydration: bei Session-Aenderung (Login) DB-Snapshot pullen.
  // Bei Logout den hydrated-Flag zuruecksetzen, damit ein erneutes
  // Login wieder pullt statt direkt mit dem Vor-Logout-State zu saven.
  createEffect(() => {
    const s = session();
    if (!s) {
      prefsHydrated = false;
      return;
    }
    void (async () => {
      try {
        const remote = await loadUserPrefs();
        if (remote) {
          const merged = applyRemoteToSettings(remote.prefs);
          setSettings(merged);
          persistToStorage(merged);
        }
      } finally {
        prefsHydrated = true;
      }
    })();
  });

  // Save: nach jeder Settings-Aenderung debounced pushen. Gate
  // ueber prefsHydrated, damit Initial-State nicht VOR dem Pull
  // den DB-Snapshot ueberschreibt.
  createEffect(() => {
    const cur = settings();
    if (!prefsHydrated) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void saveUserPrefs(cur as unknown as UserPrefs);
    }, 500);
  });

  // Online-Recovery: bei einer Offline->Online-Transition den aktuellen
  // State erneut pushen. Sonst wuerde eine Offline-Aenderung lokal
  // bleiben, bis der User das naechste Mal etwas im Setting aendert.
  const onOnline = () => {
    if (!prefsHydrated) return;
    void saveUserPrefs(settings() as unknown as UserPrefs);
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

// Body-Class-Sync: body bekommt `vis-<key>-always` / `vis-<key>-never`
// Klassen, damit CSS ohne Prop-Durchreicherei reagieren kann.
// `edit` ist Default und bekommt keine Klasse — das entspricht dem
// bisherigen Verhalten.
export function useSettingsBodyClassSync() {
  onMount(() => {
    createEffect(() => {
      const s = settings();
      const body = document.body;
      for (const k of Object.keys(s.vis) as VisKey[]) {
        const v = s.vis[k];
        body.classList.toggle(`vis-${k}-always`, v === 'always');
        body.classList.toggle(`vis-${k}-never`, v === 'never');
      }
      body.classList.toggle('activity-off', s.activity.level === 'off');
      body.classList.toggle('activity-present', s.activity.level === 'present');
      body.classList.toggle('activity-full', s.activity.level === 'full');
    });
  });
}
