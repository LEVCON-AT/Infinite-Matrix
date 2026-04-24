// Feature-Registry fuer Zellen.
//
// kind:
//   'structural' = aktives Feature impliziert einen Sub-Node (Matrix/Board).
//                  Toggle ON legt den Node an, Toggle OFF loescht ihn (Confirm,
//                  Cascade via FK).
//   'flag'       = reiner Anzeige-Flag im cells.features-Array. Toggle
//                  haengt nur am Array, kein Node-Write.
//
// requires: optional. Feature-Hotkey ist disabled wenn Voraussetzung fehlt,
//           und der Toggle-Handler kaskadiert beim Ausschalten der Basis.
//
// Neues Feature hinzufuegen = ein Listen-Eintrag. Hotkey '1'..'9' frei waehlen.
// Der Button-Handler ist dispatch-based (kind -> Strategie), skaliert linear.

export type FeatureKind = 'structural' | 'flag';

import type { IconName } from '../components/Icon';

export type FeatureDef = {
  key: string;
  hotkey: string;
  label: string;
  icon: string; // Legacy Unicode-Fallback (Filter-Toolbar, Kompakt-Stellen)
  iconName: IconName; // Heroicons-SVG-Icon fuer alle Render-Pfade
  kind: FeatureKind;
  requires?: string;
};

export const CELL_FEATURES: FeatureDef[] = [
  { key: 'matrix', hotkey: '1', label: 'Matrix', icon: '▦', iconName: 'squares-2x2', kind: 'structural' },
  { key: 'board', hotkey: '2', label: 'Board', icon: '▤', iconName: 'view-columns', kind: 'structural' },
  { key: 'info', hotkey: '3', label: 'Info', icon: 'i', iconName: 'information-circle', kind: 'flag' },
  { key: 'checklists', hotkey: '4', label: 'Checklisten', icon: '✓', iconName: 'check-circle', kind: 'flag' },
  // { key: 'links', hotkey: '5', label: 'Links', icon: '→', iconName: 'link', kind: 'flag' },
  // Platz fuer weitere Features (Hotkeys 5-9 frei).
];

export function findFeatureByHotkey(hotkey: string): FeatureDef | undefined {
  return CELL_FEATURES.find((f) => f.hotkey === hotkey);
}

export function findFeatureByKey(key: string): FeatureDef | undefined {
  return CELL_FEATURES.find((f) => f.key === key);
}
