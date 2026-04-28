// User-AI-Provider-Liste (Phase 2 Welle A.0).
//
// Read: View `user_ai_providers_safe` (ohne api_key_encrypted-Spalte).
// Mutations: SECURITY DEFINER RPCs `set_ai_provider` /
// `delete_ai_provider` / `set_ai_provider_default`. Direkter Insert
// von der Tabelle ist policy-blockiert — alle Schreibvorgaenge MUESSEN
// ueber RPCs gehen, damit Encryption garantiert ist.
//
// Read-Cache: localStorage pro User. Provider-Liste ist klein (< 5
// pro User typischerweise). Pattern aus members.ts uebernommen.
//
// Anti-Pattern Memory feedback_saas_security_no_offline gilt analog:
// Schreibvorgaenge sind security-sensitiv (Key-Storage) und laufen
// synchron-online ohne safe-mutation-Wrapper. Kein Offline-Replay.

import { type Accessor, createMemo, createResource } from 'solid-js';
import { clearProviderCredentialCache } from './ai-assist/credential';
import { useUser } from './auth';
import { isNetworkError } from './mutation-queue';
import { markCacheFallback } from './offline-state';
import { supabase } from './supabase';
import type { AiProvider, AiProviderInput, AiProviderKind } from './types';

const CACHE_KEY = (userId: string) => `ai-providers-cache:${userId}`;

function readCache(userId: string): AiProvider[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AiProvider[]) : null;
  } catch {
    return null;
  }
}

function writeCache(userId: string, list: AiProvider[]): void {
  try {
    localStorage.setItem(CACHE_KEY(userId), JSON.stringify(list));
  } catch {
    // QuotaExceededError — Cache ist Bonus.
  }
}

function clearCache(userId: string): void {
  try {
    localStorage.removeItem(CACHE_KEY(userId));
  } catch {
    // ignore
  }
}

export async function fetchAiProviders(userId: string): Promise<AiProvider[]> {
  try {
    const { data, error } = await supabase
      .from('user_ai_providers_safe')
      .select('id, kind, label, model_name, is_default, created_at, updated_at')
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });
    if (error) throw error;
    const list = (data ?? []) as AiProvider[];
    writeCache(userId, list);
    return list;
  } catch (err) {
    if (isNetworkError(err)) {
      const cached = readCache(userId);
      if (cached) {
        markCacheFallback();
        return cached;
      }
    }
    throw err;
  }
}

// Cache-Invalidate-Helper: nach jeder Mutation den decrypted-Key-Cache
// in lib/ai-assist/credential leeren. Sonst nutzt der naechste runAssist
// den alten Default-Provider, obwohl der User in Settings gewechselt hat.
// Plus: cachedAccessor von useHasDefaultProvider zuruecksetzen, damit der
// AiProviderHint (Banner) sofort verschwindet/erscheint.
function invalidateProviderCaches(): void {
  clearProviderCredentialCache();
  cachedAccessor = null;
}

export async function setAiProvider(input: AiProviderInput): Promise<AiProvider> {
  const { data, error } = await supabase.rpc('set_ai_provider', {
    p_id: input.id ?? null,
    p_kind: input.kind,
    p_label: input.label,
    p_api_key: input.apiKey ?? null,
    p_model_name: input.modelName ?? null,
    p_set_default: input.setDefault ?? false,
  });
  if (error) throw error;
  invalidateProviderCaches();
  return data as AiProvider;
}

export async function deleteAiProvider(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_ai_provider', { p_id: id });
  if (error) throw error;
  invalidateProviderCaches();
}

export async function setAiProviderDefault(id: string): Promise<void> {
  const { error } = await supabase.rpc('set_ai_provider_default', { p_id: id });
  if (error) throw error;
  invalidateProviderCaches();
}

// ─── Provider-Console-Direct-Links ──────────────────────────────
// In AddProviderModal + Onboarding-Wizard (A.4) gerendert. Ein Pfad
// zur Wahrheit — wenn Anthropic die URL aendert, hier patchen.
export const PROVIDER_CONSOLE_URLS: Record<AiProviderKind, string> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  gemini: 'https://aistudio.google.com/apikey',
};

export const PROVIDER_LABELS: Record<AiProviderKind, string> = {
  anthropic: 'Anthropic Claude',
  openai: 'OpenAI GPT',
  gemini: 'Google Gemini',
};

// Default-Modell pro Provider-Kind. User darf ueberschreiben.
export const PROVIDER_DEFAULT_MODELS: Record<AiProviderKind, string> = {
  anthropic: 'claude-opus-4-7',
  openai: 'gpt-4o',
  gemini: 'gemini-2.5-pro',
};

// ─── Resource + Has-Default-Helper ──────────────────────────────
// Globaler Indikator fuer den Persistent-Hint (AiProviderHint.tsx).
// Liest die Provider-Liste einmal pro User und exposed booleschen
// Accessor. Wird von App.tsx aufgerufen, nicht von einzelnen Pages.

let cachedAccessor: Accessor<boolean> | null = null;

export function useHasDefaultProvider(): Accessor<boolean> {
  if (cachedAccessor) return cachedAccessor;
  const user = useUser();
  const [providers] = createResource(
    () => user()?.id ?? null,
    async (uid) => {
      try {
        return await fetchAiProviders(uid);
      } catch (err) {
        console.error('useHasDefaultProvider fetch:', err);
        return [];
      }
    },
  );
  cachedAccessor = createMemo(() => {
    const list = providers();
    if (!list) return false;
    return list.some((p) => p.is_default);
  });
  return cachedAccessor;
}

// Cache-Reset bei Logout — sonst zeigt der naechste User die alte
// Provider-Liste. Wird in lib/auth.ts beim SIGN_OUT-Event gerufen.
export function resetAiProvidersCache(userId?: string): void {
  cachedAccessor = null;
  if (userId) clearCache(userId);
}
