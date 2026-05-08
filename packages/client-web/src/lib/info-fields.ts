// Welle WV.B.1 — Info-Field Mutations + Reads.
//
// CRUD-Layer fuer info_fields (Migration 072). 6. Atom-Type, lebt als
// typed Cell-Field. value_type CHECK ueber 10 Werte (Konzept §12.1).
//
// Pattern: runOptimistic*-Wrapper aus lib/safe-mutation.ts (analog
// atom-manifestations.ts).
//
// Konsumenten (Welle B+C):
//   - components/CellInfoPage / Welle-A-Renderer-Foundation rendert
//     info_fields-Atome im Form-Widget.
//   - components/InfoFieldEditor (Welle B): typed Form pro value_type.
//   - MCP-Tools info_field.{add,edit,move,delete,list} (B.7).

import type { AtomKind } from './atom-manifestations';
import { isNetworkError } from './mutation-queue';
import { type CacheTable, getByWorkspace, mergeRows } from './offline-cache';
import { markCacheFallback, markLiveSuccess } from './offline-state';
import { runOptimisticDelete, runOptimisticInsert, runOptimisticUpdate } from './safe-mutation';
import { supabase } from './supabase';
import type { InfoFieldRow, InfoFieldValueType } from './types';

const INFO_FIELDS_TABLE: CacheTable = 'info_fields';

// ─── Reads ─────────────────────────────────────────────────────

export async function fetchInfoFieldsForWorkspace(workspaceId: string): Promise<InfoFieldRow[]> {
  if (!workspaceId) return [];
  try {
    const { data, error } = await supabase
      .from('info_fields')
      .select('*')
      .eq('workspace_id', workspaceId);
    if (error) throw error;
    const rows = (data ?? []) as InfoFieldRow[];
    void mergeRows(INFO_FIELDS_TABLE, rows).catch(() => {});
    markLiveSuccess();
    return rows;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const cached = await getByWorkspace<InfoFieldRow>(INFO_FIELDS_TABLE, workspaceId);
    markCacheFallback();
    return cached;
  }
}

// ─── Mutations ─────────────────────────────────────────────────

export type AddInfoFieldInput = {
  workspaceId: string;
  label: string;
  value?: string | null;
  valueType?: InfoFieldValueType;
  valueMeta?: Record<string, unknown>;
  symbolOverride?: string | null;
};

export async function addInfoField(input: AddInfoFieldInput): Promise<InfoFieldRow> {
  if (!input.label?.trim()) {
    throw new Error('Info-Feld-Label ist Pflicht.');
  }
  return runOptimisticInsert<InfoFieldRow>({
    table: INFO_FIELDS_TABLE,
    workspaceId: input.workspaceId,
    label: 'Info-Feld anlegen',
    run: async () => {
      const { data, error } = await supabase
        .from('info_fields')
        .insert({
          workspace_id: input.workspaceId,
          label: input.label,
          value: input.value ?? null,
          value_type: input.valueType ?? 'text',
          value_meta: input.valueMeta ?? {},
          symbol_override: input.symbolOverride ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data as InfoFieldRow;
    },
    buildOffline: (id) => ({
      id,
      workspace_id: input.workspaceId,
      label: input.label,
      value: input.value ?? null,
      value_type: input.valueType ?? 'text',
      value_meta: input.valueMeta ?? {},
      symbol_override: input.symbolOverride ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  });
}

export type InfoFieldPatch = Partial<{
  label: string;
  value: string | null;
  value_type: InfoFieldValueType;
  value_meta: Record<string, unknown>;
  symbol_override: string | null;
}>;

export async function updateInfoField(id: string, patch: InfoFieldPatch): Promise<InfoFieldRow> {
  return runOptimisticUpdate<InfoFieldRow>({
    table: INFO_FIELDS_TABLE,
    id,
    patch: patch as Record<string, unknown>,
    label: 'Info-Feld aendern',
    run: async () => {
      const { data, error } = await supabase
        .from('info_fields')
        .update(patch)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as InfoFieldRow;
    },
  });
}

export async function deleteInfoField(id: string): Promise<void> {
  await runOptimisticDelete({
    table: INFO_FIELDS_TABLE,
    id,
    label: 'Info-Feld loeschen',
    run: async () => {
      const { error } = await supabase.from('info_fields').delete().eq('id', id);
      if (error) throw error;
    },
  });
}

// ─── Atom-Kind-Helper ──────────────────────────────────────────
// Re-Export fuer Konsumenten die `info_field` als AtomKind benoetigen.
export const INFO_FIELD_ATOM_KIND: AtomKind = 'info_field';
