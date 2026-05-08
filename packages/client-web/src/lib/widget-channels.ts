// Welle WV.D.2 — Widget-External-Channels (Frontend-Layer).
//
// Konzept §13 (Channel-Bridges) + plan-welle-d.md §2.2.
//
// CRUD fuer widget_external_channels (Migration 077). Workspace-scope,
// Realtime-published. RLS: SELECT alle Workspace-Members, WRITE per
// can_write_workspace.
//
// Pattern aus atom-markers.ts (WV.B.3) — runOptimisticInsert/Delete.

import { isNetworkError } from './mutation-queue';
import { type CacheTable, getByWorkspace, mergeRows } from './offline-cache';
import { markCacheFallback, markLiveSuccess } from './offline-state';
import { runOptimisticDelete, runOptimisticInsert, runOptimisticUpdate } from './safe-mutation';
import { supabase } from './supabase';
import type { ChannelProvider, WidgetExternalChannelRow } from './types';

const TABLE: CacheTable = 'widget_external_channels';

// ─── Reads ─────────────────────────────────────────────────────

export async function fetchWidgetChannels(
  workspaceId: string,
): Promise<WidgetExternalChannelRow[]> {
  if (!workspaceId) return [];
  try {
    const { data, error } = await supabase
      .from('widget_external_channels')
      .select('id, widget_id, workspace_id, provider, external_ref, created_at')
      .eq('workspace_id', workspaceId);
    if (error) throw error;
    const rows = (data ?? []) as WidgetExternalChannelRow[];
    void mergeRows(TABLE, rows).catch(() => {});
    markLiveSuccess();
    return rows;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const cached = await getByWorkspace<WidgetExternalChannelRow>(TABLE, workspaceId);
    markCacheFallback();
    return cached;
  }
}

// ─── Mutations ─────────────────────────────────────────────────

export type SetWidgetChannelInput = {
  widgetId: string;
  workspaceId: string;
  provider: ChannelProvider;
  externalRef: Record<string, unknown>;
};

// Idempotent via UNIQUE (widget_id, provider). Wenn schon eine Bridge
// fuer dieses Widget+Provider existiert: Update statt Insert. Realisiert
// per upsert mit onConflict.
export async function setWidgetChannel(
  input: SetWidgetChannelInput,
): Promise<WidgetExternalChannelRow> {
  return runOptimisticInsert<WidgetExternalChannelRow>({
    table: TABLE,
    workspaceId: input.workspaceId,
    label: 'Channel verknuepfen',
    run: async () => {
      const { data, error } = await supabase
        .from('widget_external_channels')
        .upsert(
          {
            widget_id: input.widgetId,
            workspace_id: input.workspaceId,
            provider: input.provider,
            external_ref: input.externalRef,
          },
          { onConflict: 'widget_id,provider' },
        )
        .select()
        .single();
      if (error) throw error;
      return data as WidgetExternalChannelRow;
    },
    buildOffline: (id) => ({
      id,
      widget_id: input.widgetId,
      workspace_id: input.workspaceId,
      provider: input.provider,
      external_ref: input.externalRef,
      created_at: new Date().toISOString(),
    }),
  });
}

export async function updateWidgetChannelExternalRef(
  id: string,
  externalRef: Record<string, unknown>,
): Promise<WidgetExternalChannelRow> {
  return runOptimisticUpdate<WidgetExternalChannelRow>({
    table: TABLE,
    id,
    patch: { external_ref: externalRef },
    label: 'Channel-Ref aktualisieren',
    run: async () => {
      const { data, error } = await supabase
        .from('widget_external_channels')
        .update({ external_ref: externalRef })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as WidgetExternalChannelRow;
    },
  });
}

export async function deleteWidgetChannel(id: string): Promise<void> {
  await runOptimisticDelete({
    table: TABLE,
    id,
    label: 'Channel entfernen',
    run: async () => {
      const { error } = await supabase.from('widget_external_channels').delete().eq('id', id);
      if (error) throw error;
    },
  });
}
