// Welle WV.C.2 — Save-as-Template Helper.
//
// Konzept §7.2 — Pfad B: Snapshot eines Cell-Feature als Vorlage.
// Layout + Widget-Toggles + Konfiguration werden kopiert. Atom-
// Inhalte (Cards, Items, Texts) werden **nicht** uebernommen — die
// Vorlage ist Layout, nicht Daten.
//
// V1-Scope:
//   - Legacy-Features (cell.features Array) → 1 Section mit 1 Widget
//     pro Feature-Kind. Mapping kanonisch:
//       info → 'info'
//       board → 'kanban'
//       checklist → 'checklist'
//       doc → 'doc'
//   - Existing Template-Instance auf der Cell wird ignoriert (V1
//     kopiert bevorzugt Legacy-Features, V1.5 kopiert Template-
//     Instance + Overrides per applyTemplateToCell-Foundation).
//
// Reihenfolge der Calls:
//   1. addFeatureTemplate (Vorlagen-Row, root_widget_id NULL).
//   2. addTemplateSection (eine Default-Section).
//   3. addTemplateWidget (pro Feature ein Widget).
//   4. setTemplateRootWidget (auf das erste Widget — Default-Drop-Target).
//
// Konsumenten:
//   - components/templates/SaveAsTemplateModal.tsx (Welle WV.C.2).

import {
  addFeatureTemplate,
  addTemplateSection,
  addTemplateWidget,
  setTemplateRootWidget,
} from './templates';
import type { CellRow, FeatureTemplateRow, TemplateWidgetType } from './types';

const FEATURE_TO_WIDGET_TYPE: Record<string, TemplateWidgetType> = {
  info: 'info',
  board: 'kanban',
  checklist: 'checklist',
  doc: 'doc',
};

const WIDGET_DEFAULT_SYMBOL: Record<TemplateWidgetType, string> = {
  kanban: 'view-columns',
  checklist: 'list-bullet',
  info: 'information-circle',
  doc: 'document-text',
  link: 'link',
  calendar: 'calendar',
  smart_summary: 'sparkles',
  channel: 'chat-bubble',
};

export type SaveAsTemplateInput = {
  workspaceId: string;
  ownerUserId: string | null;
  cell: CellRow;
  name: string;
  symbol: string | null;
  description: string | null;
  visibility: 'workspace' | 'user';
  hotkeySlot: number | null;
};

export async function saveAsTemplate(input: SaveAsTemplateInput): Promise<FeatureTemplateRow> {
  if (!input.name.trim()) throw new Error('Vorlagen-Name ist Pflicht.');

  // 1. Vorlagen-Row anlegen.
  const symbolOrAuto = input.symbol ?? inferSymbolFromCellFeatures(input.cell.features) ?? null;
  const description = input.description?.trim();
  const template = await addFeatureTemplate({
    workspaceId: input.workspaceId,
    ownerUserId: input.visibility === 'user' ? input.ownerUserId : null,
    name: input.name.trim(),
    symbol: symbolOrAuto,
    hotkeySlot: input.hotkeySlot,
    visibility: input.visibility,
    config: description ? { description } : {},
  });

  // 2. Default-Section.
  const section = await addTemplateSection({
    workspaceId: input.workspaceId,
    templateId: template.id,
    position: 1,
    title: null,
    defaultCollapsed: false,
    visibility: 'always',
  });

  // 3. Pro Feature ein Widget — V1 in einer Column, gross 12 Cols.
  const features = input.cell.features ?? [];
  const widgetTypes: TemplateWidgetType[] = features
    .map((f) => FEATURE_TO_WIDGET_TYPE[f])
    .filter((w): w is TemplateWidgetType => Boolean(w));

  // Wenn die Cell features=[] hat, machen wir leere Vorlage (kein Widget).
  let rootWidgetId: string | null = null;
  let position = 1;
  for (const wt of widgetTypes) {
    const widget = await addTemplateWidget({
      workspaceId: input.workspaceId,
      sectionId: section.id,
      column: 1,
      position,
      type: wt,
      sizeCols: 12,
      sizeRows: 6,
      data: {},
      toggles: {},
      config: { autoSymbol: WIDGET_DEFAULT_SYMBOL[wt] },
    });
    if (rootWidgetId === null) rootWidgetId = widget.id;
    position += 1;
  }

  // 4. Root-Widget setzen (nur wenn welche existieren).
  if (rootWidgetId) {
    await setTemplateRootWidget(template.id, rootWidgetId);
    return { ...template, root_widget_id: rootWidgetId };
  }
  return template;
}

function inferSymbolFromCellFeatures(features: ReadonlyArray<string>): string | null {
  // Erste passende Feature → Default-Symbol.
  for (const f of features) {
    const wt = FEATURE_TO_WIDGET_TYPE[f];
    if (wt) return WIDGET_DEFAULT_SYMBOL[wt];
  }
  return null;
}
