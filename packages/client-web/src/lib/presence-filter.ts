// Presence-Filter pro NodeTree-Row.
//
// PresenceUser teilt {nodeId, cellId, feature} — abhaengig davon, wo
// der User gerade ist. Eine Tree-Row repraesentiert genau eine dieser
// Stufen. Wir matchen strikt: ein User auf einer Cell-Page erscheint
// NICHT zusaetzlich auf der Parent-Matrix-Row, sonst wuerde der Avatar
// auf dem ganzen Pfad gleichzeitig auftauchen.
//
//   node-Row (Matrix/Board-Page):  nodeId match, kein cellId, kein feature
//   cell-Row (Cell-Page Default):  cellId match, kein feature
//   feature-Row (Cell mit Sektion): cellId match + feature match
//   link/doc-Row:                   nie (zu fein granular fuer Presence)

import type { PresenceUser } from './presence';
import type { TreeEntry } from './types';

export function presenceMatchesEntry(u: PresenceUser, e: TreeEntry): boolean {
  switch (e.kind) {
    case 'node':
      return u.nodeId === e.node.id && !u.cellId && !u.feature;
    case 'cell':
      return u.cellId === e.cell.id && !u.feature;
    case 'feature':
      return u.cellId === e.cellId && u.feature === e.feature;
    default:
      return false;
  }
}
