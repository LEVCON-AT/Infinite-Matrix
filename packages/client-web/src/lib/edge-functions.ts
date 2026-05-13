// Client-Helper fuer self-hosted Edge-Functions.
//
// Kong-Route: `/functions/v1/<name>` → Dispatcher `main/index.ts` →
// Sub-Function `<name>/index.ts`. Wir koennen `supabase.functions.invoke`
// nicht direkt nutzen weil der Self-Hosted-Stack den Functions-Endpoint
// nicht auto-discovert — stattdessen fetch'en wir die Kong-URL direkt
// und schicken sowohl `apikey` (Kong-Auth) als auch das User-`bearer`-
// Token (Sub-Function-Auth via `requireAuth`).

import { supabase } from './supabase';

export type EdgeFunctionError = {
  status: number;
  message: string;
};

export type EdgeFunctionResult<T> =
  | { data: T; error: null }
  | { data: null; error: EdgeFunctionError };

function getBaseUrl(): string {
  const raw = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!raw) throw new Error('VITE_SUPABASE_URL nicht gesetzt');
  return raw.replace(/\/$/, '');
}

export async function callEdgeFunction<TReq, TRes>(
  name: string,
  payload: TReq,
): Promise<EdgeFunctionResult<TRes>> {
  const base = getBaseUrl();
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) {
    return { data: null, error: { status: 401, message: 'Keine aktive Session.' } };
  }
  try {
    const res = await fetch(`${base}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: anonKey,
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload ?? {}),
    });
    let body: unknown = null;
    const text = await res.text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { error: text };
      }
    }
    if (!res.ok) {
      const message =
        body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
          ? body.error
          : `Edge-Function ${name} failed (HTTP ${res.status})`;
      return { data: null, error: { status: res.status, message } };
    }
    return { data: body as TRes, error: null };
  } catch (err) {
    return {
      data: null,
      error: {
        status: 0,
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}
