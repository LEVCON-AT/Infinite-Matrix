// Welle N.3 — Notifications Client-Lib.
//
// Liest pro-User-Notifications aus public.notifications (RLS self-only,
// gefuellt via Trigger AFTER INSERT auf workspace_events). Realtime-
// Subscribe fuer Live-Badge + Drawer-Refresh ohne Polling.
//
// Mark-Read laeuft via SECURITY DEFINER-RPCs (Migration 062).

import {
  type CacheTable,
  getByWorkspace,
  mergeRows,
  putOne,
} from './offline-cache';
import { isNetworkError } from './mutation-queue';
import { markCacheFallback, markLiveSuccess } from './offline-state';
import { supabase } from './supabase';
import type { WorkspaceEventKind } from './webhooks';

const NOTIFICATIONS_TABLE: CacheTable = 'notifications';

export type Notification = {
  id: string;
  user_id: string;
  workspace_id: string;
  event_id: string | null;
  kind: WorkspaceEventKind;
  title: string;
  body: string | null;
  link_to: string | null;
  actor_user_id: string | null;
  read_at: string | null;
  created_at: string;
};

// ─── Reads ─────────────────────────────────────────────────────
export async function fetchNotifications(
  workspaceId?: string,
  limit = 50,
): Promise<Notification[]> {
  try {
    let q = supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (workspaceId) q = q.eq('workspace_id', workspaceId);
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data ?? []) as Notification[];
    void mergeRows(NOTIFICATIONS_TABLE, rows).catch(() => {});
    markLiveSuccess();
    return rows;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    if (workspaceId) {
      const cached = await getByWorkspace<Notification>(NOTIFICATIONS_TABLE, workspaceId);
      markCacheFallback();
      return cached
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
        .slice(0, limit);
    }
    markCacheFallback();
    return [];
  }
}

export async function fetchUnreadCount(workspaceId?: string): Promise<number> {
  try {
    const { data, error } = await supabase.rpc('get_unread_notification_count', {
      p_workspace_id: workspaceId ?? null,
    });
    if (error) throw error;
    return (data as number | null) ?? 0;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    return 0;
  }
}

// ─── Mutations ─────────────────────────────────────────────────
export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase.rpc('mark_notification_read', { p_id: id });
  if (error) throw error;
  // Cache-Patch, damit der Drawer ohne Refetch das Read-Flag zeigt.
  const { data: row } = await supabase
    .from('notifications')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (row) void putOne(NOTIFICATIONS_TABLE, row as Notification);
}

export async function markAllNotificationsRead(workspaceId?: string): Promise<number> {
  const { data, error } = await supabase.rpc('mark_all_notifications_read', {
    p_workspace_id: workspaceId ?? null,
  });
  if (error) throw error;
  return ((data as { marked_read?: number } | null)?.marked_read ?? 0);
}

// ─── Realtime ──────────────────────────────────────────────────
// Subscribed im Workspace.tsx nach Session-Init. Callback bekommt jede
// Notification-Aenderung (INSERT bei Fan-Out, UPDATE bei mark_read).
// User-ID ist filter — RLS würde es sowieso filtern, aber der Filter
// spart unnoetige Channel-Events.
export function subscribeToNotifications(
  userId: string,
  onChange: (n: Notification, eventType: 'INSERT' | 'UPDATE' | 'DELETE') => void,
): { unsubscribe: () => void } {
  const channel = supabase
    .channel(`notifications:${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        const newRow = (payload.new ?? null) as Notification | null;
        const oldRow = (payload.old ?? null) as Notification | null;
        const row = newRow ?? oldRow;
        if (!row) return;
        onChange(row, payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE');
      },
    )
    .subscribe();

  return {
    unsubscribe: () => {
      void supabase.removeChannel(channel);
    },
  };
}
