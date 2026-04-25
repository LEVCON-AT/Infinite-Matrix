// JSONB-Reader fuer cell.data. Single source of truth — dieselbe
// Type-Guard-Logik wurde frueher in mutations.ts (intern) und in
// CellInfoPage.tsx (lokal) gepflegt; jetzt beides hier.
//
// Pattern: Read-Modify-Write auf cell.data laeuft IMMER ueber
// readInfoFieldsFromData/readCellLinksFromData → Mutation → updateCell.
// Das verhindert, dass eine korrupte JSONB-Row den Caller zum Crash
// bringt — fehlerhafte Eintraege werden stillschweigend ausgefiltert.

import type { CellRow, InfoField, InfoLink } from './types';

// Liest cell.data.infoFields[]. Rauswerf-Filter: nur Eintraege mit
// (id, label, value) als Strings — alles andere ist Datenmuell und
// wird stillschweigend uebersprungen.
export function readInfoFieldsFromData(
  data: Record<string, unknown> | null | undefined,
): InfoField[] {
  if (!data) return [];
  const raw = (data as { infoFields?: unknown }).infoFields;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (f): f is InfoField =>
      !!f &&
      typeof f === 'object' &&
      typeof (f as InfoField).id === 'string' &&
      typeof (f as InfoField).label === 'string' &&
      typeof (f as InfoField).value === 'string',
  );
}

// Liest cell.data.links[]. Selber Filter-Stil wie readInfoFieldsFromData.
export function readCellLinksFromData(
  data: Record<string, unknown> | null | undefined,
): InfoLink[] {
  if (!data) return [];
  const raw = (data as { links?: unknown }).links;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (l): l is InfoLink =>
      !!l &&
      typeof l === 'object' &&
      typeof (l as InfoLink).id === 'string' &&
      typeof (l as InfoLink).label === 'string' &&
      typeof (l as InfoLink).url === 'string',
  );
}

// Convenience-Wrapper, wenn der Caller die ganze CellRow zur Hand hat.
export function readInfoFieldsFromCell(cell: CellRow): InfoField[] {
  return readInfoFieldsFromData(cell.data as Record<string, unknown> | null);
}

export function readCellLinksFromCell(cell: CellRow): InfoLink[] {
  return readCellLinksFromData(cell.data as Record<string, unknown> | null);
}
