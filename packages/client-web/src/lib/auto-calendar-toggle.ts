// Welle WV.E #37 V1.5 — Auto-Calendar-Toggle-Filter.
//
// Konzept §9.14.3 — der Vorlage-Toggle
// `template_widgets.toggles.date_field_auto_calendar` (Default true)
// blendet Auto-Calendar-Manifestations pro Cell aus. V1 hat den
// Toggle nur als UI-Praeferenz exponiert; V1.5 macht ihn renderwirksam.
//
// Strategie: client-seitiger JOIN ueber drei Reads
//   template_widgets (info-Widgets mit toggle=false → section_id-Set)
//   template_sections (section_id → template_id)
//   cell_template_instances (cell_id ↔ template_id)
// → Set von cell_ids, in denen Auto-Calendar abgeschaltet ist.
//
// Heuristik bei mehreren Vorlagen pro Cell: eine Vorlage mit
// suppress-Toggle reicht, um Auto-Manifs auszublenden. Date-Felder
// leben nur in Info-Widgets, daher ist der Eingriff begrenzt.

import { fetchCellTemplateInstancesForWorkspace } from './cell-templates';
import { fetchTemplateSectionsForWorkspace, fetchTemplateWidgetsForWorkspace } from './templates';

// Default-Toggle-Wert: Auto-Calendar ist On wenn der Toggle nicht
// explizit gesetzt ist. Konsistent zur Designer-Default in
// TemplateDesigner.tsx.
const DEFAULT_DATE_FIELD_AUTO_CALENDAR = true;

// Liefert ein Set von cell_ids, in denen Auto-Calendar suppressed ist.
export async function fetchAutoCalendarSuppressedCellIds(
  workspaceId: string,
): Promise<Set<string>> {
  if (!workspaceId) return new Set();

  const [instances, widgets, sections] = await Promise.all([
    fetchCellTemplateInstancesForWorkspace(workspaceId),
    fetchTemplateWidgetsForWorkspace(workspaceId),
    fetchTemplateSectionsForWorkspace(workspaceId),
  ]);

  // 1. section_id-Set sammeln, in der mind. 1 Info-Widget den Toggle
  //    auf false hat.
  const suppressedSectionIds = new Set<string>();
  for (const w of widgets) {
    if (w.type !== 'info') continue;
    const toggles = (w.toggles ?? {}) as { date_field_auto_calendar?: boolean };
    const enabled = toggles.date_field_auto_calendar ?? DEFAULT_DATE_FIELD_AUTO_CALENDAR;
    if (!enabled) suppressedSectionIds.add(w.section_id);
  }
  if (suppressedSectionIds.size === 0) return new Set();

  // 2. section_id → template_id via template_sections.
  const suppressedTemplateIds = new Set<string>();
  for (const s of sections) {
    if (suppressedSectionIds.has(s.id)) suppressedTemplateIds.add(s.template_id);
  }
  if (suppressedTemplateIds.size === 0) return new Set();

  // 3. template_id → cell_id via cell_template_instances.
  const cells = new Set<string>();
  for (const inst of instances) {
    if (suppressedTemplateIds.has(inst.template_id)) cells.add(inst.cell_id);
  }
  return cells;
}
