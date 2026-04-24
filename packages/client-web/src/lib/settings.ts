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

import { createEffect, createMemo, createSignal, onMount, type Accessor } from 'solid-js';
import { useEditMode } from './edit-mode';

export type VisValue = 'edit' | 'always' | 'never';

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
};

const STORAGE_KEY = 'matrix-client-web-settings';

function clone(s: AppSettings): AppSettings {
  return { vis: { ...s.vis } };
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
  return createMemo(() => {
    const v = settings().vis[key] ?? 'edit';
    if (v === 'always') return true;
    if (v === 'never') return false;
    return editMode();
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
    });
  });
}
