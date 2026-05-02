// Calendar V2 — Subscription-Token-Mgmt.
//
// Der User kann pro Workspace einen Live-ICS-Feed-Token anlegen, dessen
// URL in Outlook/Google/Apple Calendar abonnierbar ist. Token wird in
// public.calendar_subscriptions gespeichert (Plain weil URL-zugaenglich).

import { supabase } from './supabase';

const FEED_BASE_URL =
  (import.meta.env.VITE_CALENDAR_FEED_URL as string | undefined) ??
  'https://staging.matrix.levcon.at/api/calendar';

export type CalendarSubscription = {
  token: string;
  url: string;
  created_at: string;
  last_accessed_at: string | null;
};

export async function getCalendarSubscription(
  workspaceId: string,
): Promise<CalendarSubscription | null> {
  const { data, error } = await supabase.rpc('get_my_calendar_subscription', {
    p_workspace_id: workspaceId,
  });
  if (error) throw error;
  if (!data?.exists) return null;
  return {
    token: data.token,
    url: `${FEED_BASE_URL}/${data.token}.ics`,
    created_at: data.created_at,
    last_accessed_at: data.last_accessed_at,
  };
}

export async function createCalendarSubscription(
  workspaceId: string,
): Promise<CalendarSubscription> {
  const { data, error } = await supabase.rpc('create_calendar_subscription', {
    p_workspace_id: workspaceId,
  });
  if (error) throw error;
  return {
    token: data.token,
    url: `${FEED_BASE_URL}/${data.token}.ics`,
    created_at: new Date().toISOString(),
    last_accessed_at: null,
  };
}

export async function revokeCalendarSubscription(workspaceId: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_calendar_subscription', {
    p_workspace_id: workspaceId,
  });
  if (error) throw error;
}
