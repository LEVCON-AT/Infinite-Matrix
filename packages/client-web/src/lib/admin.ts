// Plattform-Admin-Helper (Welle B B.0.B).
//
// Frontend-API ueber die SECURITY-DEFINER-RPCs aus Migration 046.
// Sequentialitaet: alle Calls gehen synchron-online (kein Optimistic-
// Wrapper) — Admin-Aktionen sind selten + sicherheitskritisch (analog
// Memory-Regel `feedback_saas_security_no_offline.md`).

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
