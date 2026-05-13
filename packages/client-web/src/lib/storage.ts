// Storage-Helpers fuer Avatars + Workspace-Logos (Welle D.2 + F.3).
//
// Foundation: Migration 087 legt zwei public Buckets an, RLS-Policies
// gaten Write auf Owner (avatars) bzw. Workspace-Owner+Admin
// (workspace-logos). Public-Read damit Render-Stellen die URL ohne
// signed-URL-Roundtrip einbinden koennen.
//
// Pfad-Konvention: erstes Path-Segment ist der scope-Identifier
// (user_id bzw. workspace_id), zweites Segment ein stabiles Filename
// (immer `image.{ext}`) — so kann der Upload eine eventuelle vorherige
// Datei einfach ueberschreiben statt einen orphan zu hinterlassen.

import { supabase } from './supabase';

type UploadResult = { publicUrl: string };

const ALLOWED_AVATAR_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const ALLOWED_LOGO_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']);
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

function extFromMime(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  if (mime === 'image/svg+xml') return 'svg';
  return 'bin';
}

function validate(file: File, allowed: Set<string>): void {
  if (!allowed.has(file.type)) {
    throw new Error('Nicht unterstuetzter Dateityp.');
  }
  if (file.size > MAX_BYTES) {
    throw new Error('Datei zu gross (max. 2 MB).');
  }
}

// Cachebuster-Param damit Browser nach Upload den neuen Avatar zieht
// statt aus dem CDN-Cache den alten. Random + ts reicht.
function cacheBust(url: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}v=${Date.now().toString(36)}`;
}

export async function uploadAvatar(userId: string, file: File): Promise<UploadResult> {
  validate(file, ALLOWED_AVATAR_MIME);
  const path = `${userId}/avatar.${extFromMime(file.type)}`;
  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw error;
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return { publicUrl: cacheBust(data.publicUrl) };
}

export async function deleteAvatar(userId: string, currentUrl: string | null): Promise<void> {
  // Path aus dem URL rekonstruieren (entfernt alle moeglichen Extensions
  // — wenn der User vorher PNG, jetzt JPG hatte). Wir loeschen alle
  // bekannten Extensions; Supabase ignoriert fehlende stillschweigend.
  const exts = ['jpg', 'png', 'webp', 'gif'];
  const paths = exts.map((ext) => `${userId}/avatar.${ext}`);
  void currentUrl; // nur fuer Caller-Schnittstellen-Symmetrie
  const { error } = await supabase.storage.from('avatars').remove(paths);
  if (error) throw error;
}

export async function uploadWorkspaceLogo(workspaceId: string, file: File): Promise<UploadResult> {
  validate(file, ALLOWED_LOGO_MIME);
  const path = `${workspaceId}/logo.${extFromMime(file.type)}`;
  const { error } = await supabase.storage
    .from('workspace-logos')
    .upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw error;
  const { data } = supabase.storage.from('workspace-logos').getPublicUrl(path);
  return { publicUrl: cacheBust(data.publicUrl) };
}

export async function deleteWorkspaceLogo(workspaceId: string): Promise<void> {
  const exts = ['jpg', 'png', 'webp', 'svg'];
  const paths = exts.map((ext) => `${workspaceId}/logo.${ext}`);
  const { error } = await supabase.storage.from('workspace-logos').remove(paths);
  if (error) throw error;
}
