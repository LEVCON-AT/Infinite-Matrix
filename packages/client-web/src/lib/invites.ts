// Workspace-Invites — Phase 1 (P1.A).
//
// Schreib-Pfad ueber Supabase-RPCs (create_invite / redeem_invite /
// revoke_invite, definiert in Migration 011). Bewusst KEIN safe-mutation-
// Wrapper: Security-Mutations brauchen synchrone Online-Bestaetigung.
// Offline-Replay nach Reconnect waere ein Token-Doppel-Use- bzw.
// RLS-Race-Risk (siehe Memory feedback_saas_security_no_offline).
//
// Lese-Pfad direkt ueber RLS-gefilterte Tabelle (admin/owner-only via
// workspace_invites_select_admin-Policy). IDB-Cache als Offline-
// Fallback fuer die Settings-Members-Page — Phase-1-Komfort, keine
// kritische Funktionalitaet.

import { signInWithMagicLink } from './auth';
import { isNetworkError } from './mutation-queue';
import { getByWorkspace, putAll } from './offline-cache';
import { markCacheFallback, markLiveSuccess } from './offline-state';
import { supabase } from './supabase';
import type { WorkspaceRole } from './types';

// ─── Typen ───────────────────────────────────────────────────────
export type InviteRole = Extract<WorkspaceRole, 'editor' | 'viewer'>;

export type InviteStatus = 'open' | 'accepted' | 'revoked' | 'expired';

// Wie es aus workspace_invites zurueckkommt — token_hash/token_lookup
// bekommen wir bewusst NICHT in den Client (waere bytea base64-encoded
// und verwirrt nur). PostgREST kann Spalten via .select() einschraenken.
export type WorkspaceInviteRow = {
  id: string;
  workspace_id: string;
  role: InviteRole;
  invited_by: string | null;
  invited_email: string | null;
  expires_at: string;
  accepted_at: string | null;
  accepted_by_user_id: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  created_at: string;
};

// Der Klartext-Token wird ausschliesslich beim CREATE einmalig zurueck
// gereicht — Settings-UI zeigt ihn im Success-Modal mit Kopier-Button,
// ein Mail-Send-Pfad nutzt ihn fuer den /invite/<token>-Link.
export type CreateInviteResult = {
  invite_id: string;
  token: string;
  expires_at: string;
};

export type RedeemInviteResult = {
  workspace_id: string;
  role: WorkspaceRole;
};

export type RevokeInviteResult = {
  invite_id: string;
  previous_state: InviteStatus;
  changed: boolean;
};

// ─── Status-Ableitung ─────────────────────────────────────────────
// Nicht aus DB — accepted_at/revoked_at sind zwei Spalten, expires_at
// ist Zeitvergleich. Rueckgabe als reiner Frontend-Helper.
export function inviteStatus(row: WorkspaceInviteRow, now: number = Date.now()): InviteStatus {
  if (row.accepted_at) return 'accepted';
  if (row.revoked_at) return 'revoked';
  if (new Date(row.expires_at).getTime() < now) return 'expired';
  return 'open';
}

// ─── Reads ────────────────────────────────────────────────────────
export async function fetchInvites(workspaceId: string): Promise<WorkspaceInviteRow[]> {
  try {
    const { data, error } = await supabase
      .from('workspace_invites')
      .select(
        'id, workspace_id, role, invited_by, invited_email, expires_at, accepted_at, accepted_by_user_id, revoked_at, revoked_by, created_at',
      )
      // RLS-Policy filtert auf admin/owner — wir muessen aber explizit
      // nach workspace_id eingrenzen, sonst kommen Invites aus anderen
      // Workspaces mit, in denen der User auch admin/owner ist
      // (Memory feedback_rls_select_filter).
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    const rows = (data ?? []) as WorkspaceInviteRow[];
    void putAll('invites', rows, workspaceId).catch((err) => {
      console.warn('[invites] cache write failed', err);
    });
    markLiveSuccess();
    return rows;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const cached = await getByWorkspace<WorkspaceInviteRow>('invites', workspaceId);
    if (cached.length === 0) throw err;
    markCacheFallback();
    return cached.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
}

// ─── Mutations (synchron-online, kein Replay) ────────────────────
export async function createInvite(
  workspaceId: string,
  role: InviteRole,
  invitedEmail: string | null = null,
): Promise<CreateInviteResult> {
  const trimmed = invitedEmail?.trim() || null;
  const { data, error } = await supabase.rpc('create_invite', {
    p_workspace_id: workspaceId,
    p_role: role,
    p_invited_email: trimmed,
  });
  if (error) throw error;
  return data as CreateInviteResult;
}

export async function redeemInvite(token: string): Promise<RedeemInviteResult> {
  const { data, error } = await supabase.rpc('redeem_invite', { p_token: token });
  if (error) throw error;
  return data as RedeemInviteResult;
}

export async function revokeInvite(inviteId: string): Promise<RevokeInviteResult> {
  const { data, error } = await supabase.rpc('revoke_invite', { p_invite_id: inviteId });
  if (error) throw error;
  return data as RevokeInviteResult;
}

// ─── Mail-Link-Helper ─────────────────────────────────────────────
// Baut die absolute URL fuer /invite/<token> auf Basis der aktuellen
// Site. Wir nehmen `location.origin` + Router-Base (aus VITE_BASE_PATH).
// Resultat: https://staging.matrix.levcon.at/app/invite/abc123...
export function buildInviteLink(token: string): string {
  const base = (import.meta.env.VITE_BASE_PATH as string | undefined) ?? '/';
  const normalized = base.endsWith('/') ? base : `${base}/`;
  return `${location.origin}${normalized}invite/${encodeURIComponent(token)}`;
}

// Mail-Versand via GoTrue Magic-Link (P1.A.4).
// Nutzt die existierende Supabase-Auth-SMTP-Konfig (Ionos). Mail laeuft
// als signInWithOtp -> User bekommt Magic-Link, klickt, landet eingeloggt
// auf /app/invite/<token>, redeem feuert automatisch.
//
// Subject + Body sind die GoTrue-Default-Magic-Link-Mail (Studio-Aufgabe
// fuer Custom-Template). Bei SMTP-Fehler: Caller faengt Exception ab und
// zeigt mailto-Fallback.
export async function sendInviteMail(token: string, invitedEmail: string): Promise<void> {
  const trimmed = invitedEmail.trim();
  if (!trimmed) throw new Error('invited_email_empty');
  await signInWithMagicLink(trimmed, `invite/${token}`);
}

// mailto:-Fallback fuer Mail-Client-basierten Versand. Kein SMTP-Pfad,
// User schickt selbst aus seinem Account. Subject + Body sind fest, der
// Link wird angehaengt.
export function buildInviteMailto(token: string, invitedEmail: string): string {
  const link = buildInviteLink(token);
  const subject = encodeURIComponent('Workspace-Einladung — Matrix');
  const body = encodeURIComponent(
    `Hallo,\n\ndu wurdest in einen Matrix-Workspace eingeladen. Klick den folgenden Link, um beizutreten:\n\n${link}\n\nDer Link ist 7 Tage gueltig und kann nur einmal verwendet werden.\n`,
  );
  return `mailto:${encodeURIComponent(invitedEmail)}?subject=${subject}&body=${body}`;
}

// ─── Fehler-Uebersetzung ──────────────────────────────────────────
// Die RPCs werfen plpgsql-Exceptions mit identifizierender message
// ('invite_invalid', 'forbidden', 'unauthenticated', 'invite_not_found',
// 'role_invalid'). Wir mappen das auf deutsche Texte fuer Toasts.
export function translateInviteError(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = String((err as { message?: string }).message ?? '').toLowerCase();
    if (msg.includes('invite_email_mismatch')) {
      return 'Diese Einladung gilt fuer eine andere E-Mail-Adresse. Logge dich mit der eingeladenen Adresse ein.';
    }
    if (msg.includes('already_member')) {
      return 'Du bist bereits Mitglied dieses Workspaces.';
    }
    if (msg.includes('invite_invalid')) {
      return 'Einladungs-Link ist ungueltig, abgelaufen oder schon eingeloest.';
    }
    if (msg.includes('invite_not_found')) {
      return 'Einladung wurde nicht gefunden.';
    }
    if (msg.includes('forbidden')) {
      return 'Keine Berechtigung — admin oder owner erforderlich.';
    }
    if (msg.includes('role_invalid')) {
      return 'Rolle ungueltig — nur Editor oder Viewer per Einladung.';
    }
    if (msg.includes('unauthenticated')) {
      return 'Bitte erneut einloggen.';
    }
  }
  return fallback;
}
