// Plattform-Admin-Helper (Welle B B.0.B).
//
// Frontend-API ueber die SECURITY-DEFINER-RPCs aus Migration 046.
// Sequentialitaet: alle Calls gehen synchron-online (kein Optimistic-
// Wrapper) — Admin-Aktionen sind selten + sicherheitskritisch (analog
// Memory-Regel `feedback_saas_security_no_offline.md`).

import { type Accessor, createSignal } from 'solid-js';
import { onAuthChange } from './auth';
import { supabase } from './supabase';

export type SystemConfigEntry = {
  key: string;
  value: Record<string, unknown>;
  description: string | null;
  updated_at: string;
  updated_by: string | null;
};

export type PlatformAdminEntry = {
  user_id: string;
  email: string;
  granted_at: string;
  granted_by: string | null;
  note: string | null;
};

// ─── Identity ───────────────────────────────────────────────────
export async function isPlatformAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_platform_admin');
  if (error) {
    console.error('isPlatformAdmin:', error);
    return false;
  }
  return data === true;
}

// ─── Cached Admin-Status (B.0.G) ────────────────────────────────
// Reaktives Solid-Signal damit Konsumenten (alias-resolve, command-
// palette, conditional-Rendering) synchron pruefen koennen ob der
// aktuelle User Plattform-Admin ist. Refresh-Trigger:
//   - Lazy-Bootstrap beim ersten useIsPlatformAdmin()-Aufruf.
//   - Auth-Change (signIn/signOut) → onAuthChange-Listener.
// Default false (Fail-closed: ohne bestaetigten Admin-Status ist
// User non-Admin).
const [adminCache, setAdminCache] = createSignal<boolean>(false);
let adminBootstrapped = false;
let adminRefreshing = false;

async function refreshAdminStatus(): Promise<void> {
  if (adminRefreshing) return;
  adminRefreshing = true;
  try {
    const result = await isPlatformAdmin();
    setAdminCache(result);
  } finally {
    adminRefreshing = false;
  }
}

export function useIsPlatformAdmin(): Accessor<boolean> {
  if (!adminBootstrapped) {
    adminBootstrapped = true;
    void refreshAdminStatus();
    onAuthChange(() => {
      void refreshAdminStatus();
    });
  }
  return adminCache;
}

// Synchroner Cache-Read fuer Stellen wo kein Solid-Reactive-Context
// existiert (z.B. lib/alias-resolve.ts in einem async-Helper).
// Returns false wenn noch nicht bootstrapped — Erst-Bootstrap geschieht
// in App.tsx beim Boot, sodass der Cache vor erstem ^-Tippen warm ist.
export function isPlatformAdminCached(): boolean {
  return adminCache();
}

// B.0.D: admin-only Lookup, gibt null zurueck wenn keine Email matched.
export async function findUserIdByEmail(email: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('find_user_id_by_email', { p_email: email });
  if (error) throw error;
  return (data as string | null) ?? null;
}

// ─── Admin-Stats (B.0.F) ────────────────────────────────────────
export type AdminStats = {
  users_total: number;
  users_active_30d: number;
  workspaces_total: number;
  tasks_total: number;
  task_manifestations_total: number;
  atom_manifestations_total: number;
  audit_events_24h: number;
  as_of: string;
};

export async function getAdminStats(): Promise<AdminStats> {
  const { data, error } = await supabase.rpc('get_admin_stats');
  if (error) throw error;
  return data as AdminStats;
}

// ─── system_audit_log (B.0.E) ───────────────────────────────────
export type AuditLogEntry = {
  id: string;
  action: string;
  actor_id: string | null;
  workspace_id: string | null;
  workspace_name: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export type AuditLogFilter = {
  actionPrefix?: string; // ilike-Match auf action
  limit?: number;
  offset?: number;
};

// Direct-Query — RLS aus Migration 046 erlaubt platform_admins SELECT.
// Sortiert nach created_at DESC; die action+created_at-Indexes greifen.
export async function listSystemAuditLog(filter: AuditLogFilter = {}): Promise<AuditLogEntry[]> {
  const limit = Math.max(1, Math.min(filter.limit ?? 100, 500));
  const offset = Math.max(0, filter.offset ?? 0);
  let q = supabase
    .from('system_audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (filter.actionPrefix && filter.actionPrefix.trim().length > 0) {
    const pat = `${filter.actionPrefix.trim().replace(/[%_]/g, (m) => `\\${m}`)}%`;
    q = q.ilike('action', pat);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as AuditLogEntry[];
}

// ─── system_config ──────────────────────────────────────────────
export async function listSystemConfig(): Promise<SystemConfigEntry[]> {
  const { data, error } = await supabase.rpc('list_system_config');
  if (error) throw error;
  return (data ?? []) as SystemConfigEntry[];
}

export async function getSystemConfig(key: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase.rpc('get_system_config', { p_key: key });
  if (error) throw error;
  return (data as Record<string, unknown>) ?? null;
}

export async function setSystemConfig(
  key: string,
  value: Record<string, unknown>,
  description?: string | null,
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc('set_system_config', {
    p_key: key,
    p_value: value,
    p_description: description ?? null,
  });
  if (error) throw error;
  return (data as Record<string, unknown>) ?? {};
}

export async function deleteSystemConfig(key: string): Promise<void> {
  const { error } = await supabase.rpc('delete_system_config', { p_key: key });
  if (error) throw error;
}

// ─── Platform-Admins ────────────────────────────────────────────
export async function listPlatformAdmins(): Promise<PlatformAdminEntry[]> {
  const { data, error } = await supabase.rpc('list_platform_admins');
  if (error) throw error;
  return (data ?? []) as PlatformAdminEntry[];
}

export async function grantPlatformAdmin(userId: string, note?: string | null): Promise<void> {
  const { error } = await supabase.rpc('grant_platform_admin', {
    p_user_id: userId,
    p_note: note ?? null,
  });
  if (error) throw error;
}

export async function revokePlatformAdmin(userId: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_platform_admin', { p_user_id: userId });
  if (error) throw error;
}
