// Feature-Registry fuer Zellen.
//
// kind:
//   'structural' = aktives Feature impliziert einen Sub-Node (Matrix/Board).
//                  Toggle ON legt den Node an, Toggle OFF loescht ihn (Confirm,
//                  Cascade via FK).
//   'flag'       = reiner Anzeige-Flag im cells.features-Array. Toggle
//                  haengt nur am Array, kein Node-Write.
//   'doc'        = Doku haengt ueber docs.attached_cell_id; kein cell.features-
//                  Eintrag. Anlage = createDoc(...attached_cell_id), Loeschen
//                  = doc loeschen. Doku ist `nameable: true` (eigener Title).
//
// nameable: Phase 3 O.8 — true wenn der Wizard fuer dieses Feature einen
//           Cycle-Template-Schritt anbieten soll (Matrix, Board, Doku,
//           Checkliste). Info ist ein reiner Flag ohne Namen, daher false.
//
// requires: optional. Feature-Hotkey ist disabled wenn Voraussetzung fehlt,
//           und der Toggle-Handler kaskadiert beim Ausschalten der Basis.
//
// Neues Feature hinzufuegen = ein Listen-Eintrag. Hotkey '1'..'9' oder
// einzelne Buchstaben (Phase 3 O.8: 'd' fuer Doku, 'n' als Platzhalter
// fuer zukuenftige Features). Der Button-Handler ist dispatch-based.

// Welle D: 'doc' raus — Doc ist kein Cell-Feature mehr, sondern ein
// pinbares Atom (atom_type='doc' + atom_pins).
export type FeatureKind = 'structural' | 'flag';

import type { IconName } from '../components/Icon';

export type FeatureDef = {
  key: string;
  hotkey: string;
  label: string;
  icon: string; // Legacy Unicode-Fallback (Filter-Toolbar, Kompakt-Stellen)
  iconName: IconName; // Heroicons-SVG-Icon fuer alle Render-Pfade
  kind: FeatureKind;
  // Phase 3 O.8: Wizard zeigt fuer nameable Features den Cycle-Step.
  nameable: boolean;
  requires?: string;
};

export const CELL_FEATURES: FeatureDef[] = [
  {
    key: 'matrix',
    hotkey: '1',
    label: 'Matrix',
    icon: '▦',
    iconName: 'squares-2x2',
    kind: 'structural',
    nameable: true,
  },
  {
    key: 'board',
    hotkey: '2',
    label: 'Board',
    icon: '▤',
    iconName: 'view-columns',
    kind: 'structural',
    nameable: true,
  },
  {
    key: 'info',
    hotkey: '3',
    label: 'Info',
    icon: 'i',
    iconName: 'information-circle',
    kind: 'flag',
    nameable: false,
  },
  {
    key: 'checklists',
    hotkey: '4',
    label: 'Checkliste',
    icon: '✓',
    iconName: 'check-circle',
    kind: 'flag',
    nameable: true,
  },
  // Welle D: 'doc' aus den Wizard-Features entfernt — Doku ist kein
  // klassisches Cell-Feature mehr, sondern ein eigenstaendiger Atom-
  // Typ ('atom_type=doc') mit Pin-Relation in atom_pins. Pill ent-
  // steht lazy via cellsWithDocs sobald ein Doc gepinnt wird (siehe
  // MatrixView L1000+). 'd'-Hotkey lebt jetzt global in lib/docs-open.ts
  // und triggert openDokuForContext(ctx) fuer die jeweils fokussierte
  // Sicht.
  // Hotkeys 5-9 + 'n' frei fuer zukuenftige Features.
];

export function findFeatureByHotkey(hotkey: string): FeatureDef | undefined {
  return CELL_FEATURES.find((f) => f.hotkey === hotkey);
}

export function findFeatureByKey(key: string): FeatureDef | undefined {
  return CELL_FEATURES.find((f) => f.key === key);
}
