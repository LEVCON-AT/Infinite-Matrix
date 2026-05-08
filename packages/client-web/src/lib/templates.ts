// Welle WV.A.1 — Vorlagen-Mutations + Reads.
//
// CRUD-Layer fuer feature_templates + template_sections +
// template_widgets (Migration 067). Single-Source fuer Welle-A-
// Komponenten (CellTemplateRenderer, FilterBuilderModal-Konsumenten,
// FuturE Vorlagen-Verwaltungs-Route).
//
// Schema-Heptad-Slot 3 (Mutations):
//   - addFeatureTemplate / updateFeatureTemplate / deleteFeatureTemplate
//   - addTemplateSection / updateTemplateSection / deleteTemplateSection
//   - addTemplateWidget / updateTemplateWidget / deleteTemplateWidget
//   - setTemplateRootWidget — wegen DEFERRABLE FK separat.
//   - fetchFeatureTemplates / fetchTemplateSections / fetchTemplateWidgets
//     mit IDB-Cache-Fallback (Pattern aus atom-manifestations.ts).
//
// Konsumenten:
//   - lib/widget-foundation.ts (WV.A.6) — loadCellTemplateInstances
//     joint die Template-Tabellen.
//   - lib/cell-templates.ts (WV.A.2) — Cell-Template-Instances + Overrides.
//   - components/CellTemplateRenderer.tsx (WV.A.6) — rendert via JOINs.
//   - Vorlagen-Verwaltungs-Route (Welle C).
//
// Position-Helper: nextTemplateSectionPosition / nextTemplateWidgetPosition
// — analog `nextAtomManifestationPosition` aus atom-manifestations.ts
// (Position als numeric, Drop-In zwischen siblings via fractional indexing
// oder simple max+1 — V1 simple).

import { isNetworkError } from './mutation-queue';
import { type CacheTable, getByWorkspace, mergeRows } from './offline-cache';
import { markCacheFallback, markLiveSuccess } from './offline-state';
import { runOptimisticDelete, runOptimisticInsert, runOptimisticUpdate } from './safe-mutation';
import { supabase } from './supabase';
import type {
  FeatureTemplateRow,
  TemplateRenderPosition,
  TemplateSectionRow,
  TemplateSectionVisibility,
  TemplateVisibility,
  TemplateWidgetRow,
  TemplateWidgetType,
} from './types';

const FEATURE_TEMPLATES_TABLE: CacheTable = 'feature_templates';
const TEMPLATE_SECTIONS_TABLE: CacheTable = 'template_sections';
const TEMPLATE_WIDGETS_TABLE: CacheTable = 'template_widgets';

// Cache-Subtypes mit garantiertem workspace_id (CacheRow-Constraint —
// Plattform-Vorlagen mit workspace_id NULL werden nicht gespiegelt,
// sondern bei jedem Online-Read frisch geladen).
type CachedFeatureTemplate = FeatureTemplateRow & { workspace_id: string };
type CachedTemplateSection = TemplateSectionRow & { workspace_id: string };
type CachedTemplateWidget = TemplateWidgetRow & { workspace_id: string };

function isWorkspaceScoped<T extends { workspace_id: string | null }>(
  row: T,
): row is T & { workspace_id: string } {
  return row.workspace_id !== null;
}

// ─── Reads ─────────────────────────────────────────────────────

// Liefert alle fuer den User sichtbaren Vorlagen im Workspace
// (Plattform-Vorlagen + Workspace-shared + eigene User-privat).
// RLS regelt Filter — wir holen alles und der DB-Layer maskiert.
export async function fetchFeatureTemplatesForWorkspace(
  workspaceId: string,
): Promise<FeatureTemplateRow[]> {
  if (!workspaceId) return [];
  try {
    // Plattform-Vorlagen sind workspace_id NULL — wir holen sie via
    // separater OR-Bedingung (RLS laesst sie eh durch).
    const { data, error } = await supabase
      .from('feature_templates')
      .select('*')
      .or(`workspace_id.eq.${workspaceId},workspace_id.is.null`);
    if (error) throw error;
    const rows = (data ?? []) as FeatureTemplateRow[];
    // Cache nur die workspace-spezifischen — Plattform-Vorlagen
    // bleiben unter NULL und wuerden den workspace_id-Index
    // verwirren (CacheRow erwartet workspace_id non-null).
    const wsRows = rows.filter(isWorkspaceScoped);
    void mergeRows(FEATURE_TEMPLATES_TABLE, wsRows).catch(() => {});
    markLiveSuccess();
    return rows;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const cached = await getByWorkspace<CachedFeatureTemplate>(
      FEATURE_TEMPLATES_TABLE,
      workspaceId,
    );
    markCacheFallback();
    return cached as FeatureTemplateRow[];
  }
}

export async function fetchTemplateSectionsForWorkspace(
  workspaceId: string,
): Promise<TemplateSectionRow[]> {
  if (!workspaceId) return [];
  try {
    // workspace_id ist denormalisiert (Migration 067 Trigger), daher
    // direkter Filter ohne JOIN. Plattform-Vorlagen-Sections kommen
    // ueber `workspace_id IS NULL`-OR mit. RLS filtert eh on top.
    const { data, error } = await supabase
      .from('template_sections')
      .select('*')
      .or(`workspace_id.eq.${workspaceId},workspace_id.is.null`);
    if (error) throw error;
    const rows = (data ?? []) as TemplateSectionRow[];
    const wsRows = rows.filter(isWorkspaceScoped);
    void mergeRows(TEMPLATE_SECTIONS_TABLE, wsRows).catch(() => {});
    markLiveSuccess();
    return rows;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const cached = await getByWorkspace<CachedTemplateSection>(
      TEMPLATE_SECTIONS_TABLE,
      workspaceId,
    );
    markCacheFallback();
    return cached as TemplateSectionRow[];
  }
}

export async function fetchTemplateWidgetsForWorkspace(
  workspaceId: string,
): Promise<TemplateWidgetRow[]> {
  if (!workspaceId) return [];
  try {
    const { data, error } = await supabase
      .from('template_widgets')
      .select('*')
      .or(`workspace_id.eq.${workspaceId},workspace_id.is.null`);
    if (error) throw error;
    const rows = (data ?? []) as TemplateWidgetRow[];
    const wsRows = rows.filter(isWorkspaceScoped);
    void mergeRows(TEMPLATE_WIDGETS_TABLE, wsRows).catch(() => {});
    markLiveSuccess();
    return rows;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const cached = await getByWorkspace<CachedTemplateWidget>(TEMPLATE_WIDGETS_TABLE, workspaceId);
    markCacheFallback();
    return cached as TemplateWidgetRow[];
  }
}

// ─── Mutations: feature_templates ──────────────────────────────

export type AddFeatureTemplateInput = {
  workspaceId: string | null; // NULL nur fuer Platform-Admin-Path
  ownerUserId?: string | null;
  name: string;
  symbol?: string | null;
  symbolColor?: string | null;
  hotkeySlot?: number | null;
  isGlobal?: boolean;
  visibility: TemplateVisibility;
  layoutVersion?: number;
  titleTemplate?: string | null;
  rootWidgetId?: string | null;
  renderPosition?: TemplateRenderPosition;
  config?: Record<string, unknown>;
};

export async function addFeatureTemplate(
  input: AddFeatureTemplateInput,
): Promise<FeatureTemplateRow> {
  if (!input.name?.trim()) throw new Error('Template-Name ist Pflicht.');
  if (!['platform', 'workspace', 'user'].includes(input.visibility)) {
    throw new Error(`Ungueltige Visibility: ${input.visibility}`);
  }
  if (!input.workspaceId) {
    // Plattform-Vorlagen werden nicht ueber den Client-Mutation-Pfad
    // angelegt (nur platform_admin via SQL/MCP). Client-Pfad braucht
    // workspaceId fuer Cache.
    throw new Error('workspaceId ist Pflicht (Plattform-Vorlagen werden via Admin-MCP angelegt).');
  }
  const wsId = input.workspaceId;

  const result = await runOptimisticInsert<CachedFeatureTemplate>({
    table: FEATURE_TEMPLATES_TABLE,
    workspaceId: wsId,
    label: 'Vorlage anlegen',
    run: async () => {
      const { data, error } = await supabase
        .from('feature_templates')
        .insert({
          workspace_id: input.workspaceId,
          owner_user_id: input.ownerUserId ?? null,
          name: input.name,
          symbol: input.symbol ?? null,
          symbol_color: input.symbolColor ?? null,
          hotkey_slot: input.hotkeySlot ?? null,
          is_global: input.isGlobal ?? false,
          visibility: input.visibility,
          layout_version: input.layoutVersion ?? 1,
          title_template: input.titleTemplate ?? null,
          root_widget_id: input.rootWidgetId ?? null,
          render_position: input.renderPosition ?? 'hotkey_slot',
          config: input.config ?? {},
        })
        .select()
        .single();
      if (error) throw error;
      return data as CachedFeatureTemplate;
    },
    buildOffline: (id) => ({
      id,
      workspace_id: wsId,
      owner_user_id: input.ownerUserId ?? null,
      name: input.name,
      symbol: input.symbol ?? null,
      symbol_color: input.symbolColor ?? null,
      hotkey_slot: input.hotkeySlot ?? null,
      is_global: input.isGlobal ?? false,
      visibility: input.visibility,
      layout_version: input.layoutVersion ?? 1,
      title_template: input.titleTemplate ?? null,
      root_widget_id: input.rootWidgetId ?? null,
      render_position: input.renderPosition ?? 'hotkey_slot',
      config: input.config ?? {},
      created_at: new Date().toISOString(),
      created_by: null,
      updated_at: new Date().toISOString(),
    }),
  });
  return result as FeatureTemplateRow;
}

export type FeatureTemplatePatch = Partial<{
  name: string;
  symbol: string | null;
  symbol_color: string | null;
  hotkey_slot: number | null;
  is_global: boolean;
  layout_version: number;
  title_template: string | null;
  root_widget_id: string | null;
  render_position: TemplateRenderPosition;
  config: Record<string, unknown>;
}>;

export async function updateFeatureTemplate(
  id: string,
  patch: FeatureTemplatePatch,
): Promise<FeatureTemplateRow> {
  const result = await runOptimisticUpdate<CachedFeatureTemplate>({
    table: FEATURE_TEMPLATES_TABLE,
    id,
    patch: patch as Record<string, unknown>,
    label: 'Vorlage aendern',
    run: async () => {
      const { data, error } = await supabase
        .from('feature_templates')
        .update(patch)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as CachedFeatureTemplate;
    },
  });
  return result as FeatureTemplateRow;
}

// Setzt root_widget_id auf einen Widget — separat, weil DEFERRABLE FK.
// Use-Case: nach addFeatureTemplate + addTemplateSection + addTemplateWidget
// in derselben Transaktion, aber V1 ohne Transaktions-Wrapper auf
// Client-Seite. Caller setzt root_widget_id nachdem alle Widgets
// existieren.
export async function setTemplateRootWidget(
  templateId: string,
  rootWidgetId: string | null,
): Promise<FeatureTemplateRow> {
  return updateFeatureTemplate(templateId, { root_widget_id: rootWidgetId });
}

export async function deleteFeatureTemplate(id: string): Promise<void> {
  await runOptimisticDelete({
    table: FEATURE_TEMPLATES_TABLE,
    id,
    label: 'Vorlage loeschen',
    run: async () => {
      const { error } = await supabase.from('feature_templates').delete().eq('id', id);
      if (error) throw error;
    },
  });
}

// ─── Mutations: template_sections ──────────────────────────────

export type AddTemplateSectionInput = {
  workspaceId: string;
  templateId: string;
  position: number;
  title?: string | null;
  defaultCollapsed?: boolean;
  visibility?: TemplateSectionVisibility;
};

export async function addTemplateSection(
  input: AddTemplateSectionInput,
): Promise<TemplateSectionRow> {
  const result = await runOptimisticInsert<CachedTemplateSection>({
    table: TEMPLATE_SECTIONS_TABLE,
    workspaceId: input.workspaceId,
    label: 'Sektion anlegen',
    run: async () => {
      const { data, error } = await supabase
        .from('template_sections')
        .insert({
          template_id: input.templateId,
          position: input.position,
          title: input.title ?? null,
          default_collapsed: input.defaultCollapsed ?? false,
          visibility: input.visibility ?? 'always',
        })
        .select()
        .single();
      if (error) throw error;
      return data as CachedTemplateSection;
    },
    buildOffline: (id) => ({
      id,
      template_id: input.templateId,
      workspace_id: input.workspaceId,
      position: input.position,
      title: input.title ?? null,
      default_collapsed: input.defaultCollapsed ?? false,
      visibility: input.visibility ?? 'always',
      created_at: new Date().toISOString(),
    }),
  });
  return result as TemplateSectionRow;
}

export type TemplateSectionPatch = Partial<{
  position: number;
  title: string | null;
  default_collapsed: boolean;
  visibility: TemplateSectionVisibility;
}>;

export async function updateTemplateSection(
  id: string,
  patch: TemplateSectionPatch,
): Promise<TemplateSectionRow> {
  const result = await runOptimisticUpdate<CachedTemplateSection>({
    table: TEMPLATE_SECTIONS_TABLE,
    id,
    patch: patch as Record<string, unknown>,
    label: 'Sektion aendern',
    run: async () => {
      const { data, error } = await supabase
        .from('template_sections')
        .update(patch)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as CachedTemplateSection;
    },
  });
  return result as TemplateSectionRow;
}

export async function deleteTemplateSection(id: string): Promise<void> {
  await runOptimisticDelete({
    table: TEMPLATE_SECTIONS_TABLE,
    id,
    label: 'Sektion loeschen',
    run: async () => {
      const { error } = await supabase.from('template_sections').delete().eq('id', id);
      if (error) throw error;
    },
  });
}

// ─── Mutations: template_widgets ───────────────────────────────

export type AddTemplateWidgetInput = {
  workspaceId: string;
  sectionId: string;
  column?: number;
  position: number;
  type: TemplateWidgetType;
  sizeCols?: number;
  sizeRows?: number;
  data?: Record<string, unknown>;
  toggles?: Record<string, unknown>;
  config?: Record<string, unknown>;
};

export async function addTemplateWidget(input: AddTemplateWidgetInput): Promise<TemplateWidgetRow> {
  const result = await runOptimisticInsert<CachedTemplateWidget>({
    table: TEMPLATE_WIDGETS_TABLE,
    workspaceId: input.workspaceId,
    label: 'Widget anlegen',
    run: async () => {
      const { data, error } = await supabase
        .from('template_widgets')
        .insert({
          section_id: input.sectionId,
          column: input.column ?? 1,
          position: input.position,
          type: input.type,
          size_cols: input.sizeCols ?? 12,
          size_rows: input.sizeRows ?? 6,
          data: input.data ?? {},
          toggles: input.toggles ?? {},
          config: input.config ?? {},
        })
        .select()
        .single();
      if (error) throw error;
      return data as CachedTemplateWidget;
    },
    buildOffline: (id) => ({
      id,
      section_id: input.sectionId,
      workspace_id: input.workspaceId,
      column: input.column ?? 1,
      position: input.position,
      type: input.type,
      size_cols: input.sizeCols ?? 12,
      size_rows: input.sizeRows ?? 6,
      data: input.data ?? {},
      toggles: input.toggles ?? {},
      config: input.config ?? {},
      created_at: new Date().toISOString(),
    }),
  });
  return result as TemplateWidgetRow;
}

export type TemplateWidgetPatch = Partial<{
  column: number;
  position: number;
  type: TemplateWidgetType;
  size_cols: number;
  size_rows: number;
  data: Record<string, unknown>;
  toggles: Record<string, unknown>;
  config: Record<string, unknown>;
}>;

export async function updateTemplateWidget(
  id: string,
  patch: TemplateWidgetPatch,
): Promise<TemplateWidgetRow> {
  const result = await runOptimisticUpdate<CachedTemplateWidget>({
    table: TEMPLATE_WIDGETS_TABLE,
    id,
    patch: patch as Record<string, unknown>,
    label: 'Widget aendern',
    run: async () => {
      const { data, error } = await supabase
        .from('template_widgets')
        .update(patch)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as CachedTemplateWidget;
    },
  });
  return result as TemplateWidgetRow;
}

export async function deleteTemplateWidget(id: string): Promise<void> {
  await runOptimisticDelete({
    table: TEMPLATE_WIDGETS_TABLE,
    id,
    label: 'Widget loeschen',
    run: async () => {
      const { error } = await supabase.from('template_widgets').delete().eq('id', id);
      if (error) throw error;
    },
  });
}

// ─── Position-Helper ───────────────────────────────────────────
// V1: max-position + 1. Spaeter (Welle C Bulk-Apply) fractional
// indexing fuer Drop-In zwischen siblings ohne Re-Sort.

export function nextTemplateSectionPosition(
  templateId: string,
  sections: ReadonlyArray<TemplateSectionRow>,
): number {
  const siblings = sections.filter((s) => s.template_id === templateId);
  if (siblings.length === 0) return 1;
  return Math.max(...siblings.map((s) => s.position)) + 1;
}

export function nextTemplateWidgetPosition(
  sectionId: string,
  widgets: ReadonlyArray<TemplateWidgetRow>,
): number {
  const siblings = widgets.filter((w) => w.section_id === sectionId);
  if (siblings.length === 0) return 1;
  return Math.max(...siblings.map((w) => w.position)) + 1;
}
