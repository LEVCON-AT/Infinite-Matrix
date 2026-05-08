// Welle WV.A.6 — Widget-Foundation: Layout-Engine + JOIN-Resolver.
//
// Joint die fuenf Vorlagen-Tabellen (feature_templates → template_sections
// → template_widgets, plus cell_template_instances + cell_widget_overrides)
// zu einer renderbaren Cell-Vorlagen-Sicht. Konsumiert von
// CellTemplateRenderer + TemplateSectionRenderer + TemplateWidgetRenderer
// (components/CellTemplate*.tsx).
//
// Kein Mutations-Pfad — pure Reads + Resolver. Mutations leben in
// lib/templates.ts (WV.A.1) + lib/cell-templates.ts (WV.A.2).
//
// Pattern:
//   loadCellTemplateInstances(cellId, sources) → CellTemplateView[]
//
//   - Caller liefert die Source-Bundle (alle Tabellen bereits geladen
//     in Workspace.tsx Resources). Resolver macht nur Map-Lookup +
//     Merge-Logik.
//   - Output ist eine Liste von CellTemplateView pro Vorlage in der
//     Cell. Jede View enthaelt resolved Sections + Widgets (mit
//     Override-Merge).
//
// Override-Merge:
//   - mergeWidgetWithOverride(widget, override?) → ResolvedWidget
//   - Sparse: nur Felder aus override.override_data ueberschreiben den
//     Template-Widget-Default. data/toggles/config alle einzeln
//     gemerged (shallow), damit ein User-Patch auf data.foo nicht
//     data.bar ploetzlich loescht.

import type {
  CellTemplateInstanceRow,
  CellWidgetOverrideRow,
  FeatureTemplateRow,
  TemplateSectionRow,
  TemplateWidgetRow,
} from './types';

// ─── Resolved Shapes ───────────────────────────────────────────

// Ein Widget nach Override-Merge. Behalten alle Template-Felder, plus
// hasOverride-Flag fuer „Reset auf Vorlage"-UI-Hint.
export type ResolvedWidget = TemplateWidgetRow & {
  hasOverride: boolean;
  // Sparse-Override-Bezug fuer reset-Action (Caller braucht overrideId).
  overrideId: string | null;
};

export type ResolvedSection = TemplateSectionRow & {
  widgets: ResolvedWidget[];
};

export type CellTemplateView = {
  // cell_template_instances Row.
  instance: CellTemplateInstanceRow;
  // feature_templates Row hinter dem instance.
  template: FeatureTemplateRow;
  // template_sections + Widgets, sortiert nach position. Widgets pro
  // Section bereits mit Overrides gemerged.
  sections: ResolvedSection[];
  // Layout-Versions-Vergleich: instance.layout_version vs template.layout_version.
  // Wenn ungleich → Update-Hint zeigen (Konzept §6.5).
  isLayoutOutdated: boolean;
};

// ─── Source-Bundle vom Caller ──────────────────────────────────

export type WidgetFoundationSources = {
  templates: ReadonlyArray<FeatureTemplateRow>;
  sections: ReadonlyArray<TemplateSectionRow>;
  widgets: ReadonlyArray<TemplateWidgetRow>;
  cellInstances: ReadonlyArray<CellTemplateInstanceRow>;
  overrides: ReadonlyArray<CellWidgetOverrideRow>;
};

// ─── Override-Merge ────────────────────────────────────────────

// Wendet einen sparse Override auf ein Template-Widget an. data/toggles/
// config werden shallow gemerged — User-Patch auf einzelne Felder bleibt
// unabhaengig von Vorlagen-Struktur.
export function mergeWidgetWithOverride(
  widget: TemplateWidgetRow,
  override?: CellWidgetOverrideRow,
): ResolvedWidget {
  if (!override) {
    return { ...widget, hasOverride: false, overrideId: null };
  }
  const od = override.override_data;
  return {
    ...widget,
    data: {
      ...widget.data,
      ...((od.data as Record<string, unknown> | undefined) ?? {}),
    },
    toggles: {
      ...widget.toggles,
      ...((od.toggles as Record<string, unknown> | undefined) ?? {}),
    },
    config: {
      ...widget.config,
      ...((od.config as Record<string, unknown> | undefined) ?? {}),
    },
    // Auch Layout-Felder kann User overriden (size_cols/size_rows/
    // column/position) — wenn der Override-Body sie traegt.
    column: typeof od.column === 'number' ? od.column : widget.column,
    position: typeof od.position === 'number' ? od.position : widget.position,
    size_cols: typeof od.size_cols === 'number' ? od.size_cols : widget.size_cols,
    size_rows: typeof od.size_rows === 'number' ? od.size_rows : widget.size_rows,
    hasOverride: true,
    overrideId: override.id,
  };
}

// ─── Top-Level Resolver ────────────────────────────────────────

// Liefert alle Vorlagen-Views fuer eine Cell. Sortiert pro
// instance.applied_at ASC (frueheste zuerst). Innerhalb einer Vorlage
// Sections nach position, Widgets pro Section nach position.
export function loadCellTemplateInstances(
  cellId: string,
  src: WidgetFoundationSources,
): CellTemplateView[] {
  const instances = src.cellInstances.filter((i) => i.cell_id === cellId);
  if (instances.length === 0) return [];

  // Index Maps fuer O(1)-Lookup.
  const templateById = new Map<string, FeatureTemplateRow>();
  for (const t of src.templates) templateById.set(t.id, t);

  const sectionsByTemplate = new Map<string, TemplateSectionRow[]>();
  for (const s of src.sections) {
    const arr = sectionsByTemplate.get(s.template_id);
    if (arr) arr.push(s);
    else sectionsByTemplate.set(s.template_id, [s]);
  }

  const widgetsBySection = new Map<string, TemplateWidgetRow[]>();
  for (const w of src.widgets) {
    const arr = widgetsBySection.get(w.section_id);
    if (arr) arr.push(w);
    else widgetsBySection.set(w.section_id, [w]);
  }

  const overrideByInstanceWidget = new Map<string, CellWidgetOverrideRow>();
  for (const o of src.overrides) {
    overrideByInstanceWidget.set(`${o.instance_id}:${o.widget_id}`, o);
  }

  const views: CellTemplateView[] = [];
  for (const inst of instances) {
    const template = templateById.get(inst.template_id);
    if (!template) continue; // Template geloescht aber Instance lebt — RLS-Race?

    const sections = (sectionsByTemplate.get(template.id) ?? [])
      .slice()
      .sort((a, b) => a.position - b.position);

    const resolvedSections: ResolvedSection[] = sections.map((section) => {
      const widgets = (widgetsBySection.get(section.id) ?? [])
        .slice()
        .sort((a, b) => a.position - b.position);
      const resolvedWidgets = widgets.map((widget) => {
        const override = overrideByInstanceWidget.get(`${inst.id}:${widget.id}`);
        return mergeWidgetWithOverride(widget, override);
      });
      return { ...section, widgets: resolvedWidgets };
    });

    views.push({
      instance: inst,
      template,
      sections: resolvedSections,
      isLayoutOutdated: inst.layout_version !== template.layout_version,
    });
  }

  // Stable sort: applied_at ASC, dann template.name als Tiebreaker.
  views.sort((a, b) => {
    const ta = a.instance.applied_at;
    const tb = b.instance.applied_at;
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.template.name.localeCompare(b.template.name);
  });

  return views;
}

// ─── Position-Helper ───────────────────────────────────────────

// Layout-Grid: 12-Col-Default. Helper fuer Insert + Move-Operationen.
export const TEMPLATE_GRID_COLS = 12;

export function clampGridCols(cols: number): number {
  if (cols < 1) return 1;
  if (cols > TEMPLATE_GRID_COLS) return TEMPLATE_GRID_COLS;
  return cols;
}
