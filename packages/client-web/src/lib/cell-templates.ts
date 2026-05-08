// Welle WV.A.2 — Cell-Template-Instances + Sparse-Overrides.
//
// CRUD-Layer fuer cell_template_instances + cell_widget_overrides
// (Migration 068). Steuert wie eine Cell mit einer Vorlage verbunden
// ist und welche Widget-Felder der User pro Cell-Instanz ueberschreibt.
//
// Schema-Heptad-Slot 3 (Mutations):
//   - applyTemplateToCell — eine Vorlage einer Cell hinzufuegen.
//   - removeTemplateFromCell — Junction loeschen (Overrides via
//     CASCADE mit gehen).
//   - setLayoutVersion — re-baselinen nach Vorlagen-Update.
//   - upsertWidgetOverride — User-Patch auf Widget-Daten setzen.
//   - resetWidgetOverride — Override loeschen → zurueck auf Vorlage.
//   - fetchCellTemplateInstancesForWorkspace / -ForCell.
//   - fetchCellWidgetOverridesForInstance.
//
// Konsumenten:
//   - lib/widget-foundation.ts (WV.A.6) — joint die Tabellen pro Cell.
//   - components/CellTemplateRenderer.tsx (WV.A.6) — rendert.
//   - lib/templates.ts (WV.A.1) — Vorlagen-CRUD lebt dort.
//
// Reset-to-Template: DELETE der Override-Row. Konzept §6.5.

import { isNetworkError } from './mutation-queue';
import { type CacheTable, getByWorkspace, mergeRows } from './offline-cache';
import { markCacheFallback, markLiveSuccess } from './offline-state';
import { runOptimisticDelete, runOptimisticInsert, runOptimisticUpdate } from './safe-mutation';
import { supabase } from './supabase';
import type { CellTemplateInstanceRow, CellWidgetOverrideRow } from './types';

const CELL_TEMPLATE_INSTANCES_TABLE: CacheTable = 'cell_template_instances';
const CELL_WIDGET_OVERRIDES_TABLE: CacheTable = 'cell_widget_overrides';

// ─── Reads ─────────────────────────────────────────────────────

export async function fetchCellTemplateInstancesForWorkspace(
  workspaceId: string,
): Promise<CellTemplateInstanceRow[]> {
  if (!workspaceId) return [];
  try {
    const { data, error } = await supabase
      .from('cell_template_instances')
      .select('*')
      .eq('workspace_id', workspaceId);
    if (error) throw error;
    const rows = (data ?? []) as CellTemplateInstanceRow[];
    void mergeRows(CELL_TEMPLATE_INSTANCES_TABLE, rows).catch(() => {});
    markLiveSuccess();
    return rows;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const cached = await getByWorkspace<CellTemplateInstanceRow>(
      CELL_TEMPLATE_INSTANCES_TABLE,
      workspaceId,
    );
    markCacheFallback();
    return cached;
  }
}

export async function fetchCellWidgetOverridesForWorkspace(
  workspaceId: string,
): Promise<CellWidgetOverrideRow[]> {
  if (!workspaceId) return [];
  try {
    const { data, error } = await supabase
      .from('cell_widget_overrides')
      .select('*')
      .eq('workspace_id', workspaceId);
    if (error) throw error;
    const rows = (data ?? []) as CellWidgetOverrideRow[];
    void mergeRows(CELL_WIDGET_OVERRIDES_TABLE, rows).catch(() => {});
    markLiveSuccess();
    return rows;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const cached = await getByWorkspace<CellWidgetOverrideRow>(
      CELL_WIDGET_OVERRIDES_TABLE,
      workspaceId,
    );
    markCacheFallback();
    return cached;
  }
}

// ─── Mutations: cell_template_instances ────────────────────────

export type ApplyTemplateInput = {
  workspaceId: string;
  cellId: string;
  templateId: string;
  // layoutVersion vom Caller bestimmt (typischer Pfad: aus aktuellem
  // feature_templates.layout_version pinnen).
  layoutVersion: number;
  appliedBy?: string | null;
};

export async function applyTemplateToCell(
  input: ApplyTemplateInput,
): Promise<CellTemplateInstanceRow> {
  return runOptimisticInsert<CellTemplateInstanceRow>({
    table: CELL_TEMPLATE_INSTANCES_TABLE,
    workspaceId: input.workspaceId,
    label: 'Vorlage zur Cell hinzufuegen',
    run: async () => {
      const { data, error } = await supabase
        .from('cell_template_instances')
        .insert({
          cell_id: input.cellId,
          template_id: input.templateId,
          // workspace_id pflegt der Trigger aus cell.workspace_id —
          // wir senden NULL und lassen den Trigger ueberschreiben.
          // (Fuer Optimistic-Cache senden wir den erwarteten Wert.)
          workspace_id: input.workspaceId,
          layout_version: input.layoutVersion,
          applied_by: input.appliedBy ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data as CellTemplateInstanceRow;
    },
    buildOffline: (id) => ({
      id,
      cell_id: input.cellId,
      template_id: input.templateId,
      workspace_id: input.workspaceId,
      layout_version: input.layoutVersion,
      applied_at: new Date().toISOString(),
      applied_by: input.appliedBy ?? null,
    }),
  });
}

// Re-Baseline: setzt layout_version auf den aktuellen Wert der
// Vorlage. Caller liest feature_templates.layout_version vorher und
// reicht ihn rein.
export async function setInstanceLayoutVersion(
  id: string,
  layoutVersion: number,
): Promise<CellTemplateInstanceRow> {
  return runOptimisticUpdate<CellTemplateInstanceRow>({
    table: CELL_TEMPLATE_INSTANCES_TABLE,
    id,
    patch: { layout_version: layoutVersion },
    label: 'Vorlage neu baselinen',
    run: async () => {
      const { data, error } = await supabase
        .from('cell_template_instances')
        .update({ layout_version: layoutVersion })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as CellTemplateInstanceRow;
    },
  });
}

export async function removeTemplateFromCell(id: string): Promise<void> {
  await runOptimisticDelete({
    table: CELL_TEMPLATE_INSTANCES_TABLE,
    id,
    label: 'Vorlage von Cell entfernen',
    run: async () => {
      const { error } = await supabase.from('cell_template_instances').delete().eq('id', id);
      if (error) throw error;
    },
  });
}

// ─── Mutations: cell_widget_overrides ──────────────────────────

export type UpsertWidgetOverrideInput = {
  workspaceId: string;
  instanceId: string;
  widgetId: string;
  overrideData: Record<string, unknown>;
};

// Upsert: existing Override patchen oder neu anlegen. Wir nutzen
// PostgREST `on_conflict=instance_id,widget_id` damit der Trigger
// updated_at aktualisiert.
export async function upsertWidgetOverride(
  input: UpsertWidgetOverrideInput,
): Promise<CellWidgetOverrideRow> {
  // PostgREST upsert via insert mit onConflict-Header. Die safe-mutation-
  // Wrapper sind primaer fuer pure insert/update — fuer upsert nehmen
  // wir den runOptimisticInsert-Pfad und fangen die UNIQUE-Verletzung
  // serverseitig via on_conflict.
  return runOptimisticInsert<CellWidgetOverrideRow>({
    table: CELL_WIDGET_OVERRIDES_TABLE,
    workspaceId: input.workspaceId,
    label: 'Widget-Override setzen',
    run: async () => {
      const { data, error } = await supabase
        .from('cell_widget_overrides')
        .upsert(
          {
            instance_id: input.instanceId,
            widget_id: input.widgetId,
            workspace_id: input.workspaceId,
            override_data: input.overrideData,
          },
          { onConflict: 'instance_id,widget_id' },
        )
        .select()
        .single();
      if (error) throw error;
      return data as CellWidgetOverrideRow;
    },
    buildOffline: (id) => ({
      id,
      instance_id: input.instanceId,
      widget_id: input.widgetId,
      workspace_id: input.workspaceId,
      override_data: input.overrideData,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  });
}

// Reset-to-Template: DELETE der Override-Row → Widget rendert wieder
// nur aus template_widgets.data (Konzept §6.5).
export async function resetWidgetOverride(id: string): Promise<void> {
  await runOptimisticDelete({
    table: CELL_WIDGET_OVERRIDES_TABLE,
    id,
    label: 'Override zuruecksetzen',
    run: async () => {
      const { error } = await supabase.from('cell_widget_overrides').delete().eq('id', id);
      if (error) throw error;
    },
  });
}
