import type { Session, User } from '@supabase/supabase-js';
import { createSignal, onCleanup } from 'solid-js';
import { supabase } from './supabase';

// Magic-Link-Redirect-URI: aus VITE_SITE_URL (Build-time-Konstante).
// Bewusst NICHT window.location.origin — sonst kann ein gefaelschter
// Origin den Redirect umleiten (ASVS V2.1.4). Falls die Env nicht
// gesetzt ist, faellt's auf window.location.origin zurueck und logt
// eine Warnung — Dev-Server (localhost) waere sonst unbenutzbar, aber
// im Prod-Build sollte VITE_SITE_URL immer gesetzt sein.
const SITE_URL = (() => {
  const fromEnv = import.meta.env.VITE_SITE_URL as string | undefined;
  if (fromEnv?.trim()) return fromEnv;
  if (typeof window !== 'undefined') {
    console.warn(
      '[auth] VITE_SITE_URL nicht gesetzt — Magic-Link-Redirect nutzt window.location.origin als Fallback. Im Prod-Build .env-Eintrag pflegen.',
    );
    return `${window.location.origin}/`;
  }
  return '/';
})();

// Globaler Session-State. Wird bei App-Start befuellt + bei onAuthStateChange aktualisiert.
const [session, setSession] = createSignal<Session | null>(null);
const [ready, setReady] = createSignal(false);

// Einmaliger Bootstrap: vorhandene Session aus Storage lesen + Subscription starten.
let bootstrapped = false;
export function bootstrapAuth(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  supabase.auth.getSession().then(({ data }) => {
    setSession(data.session);
    setReady(true);
  });

  supabase.auth.onAuthStateChange((_event, s) => {
    setSession(s);
    setReady(true);
  });
}

export function useSession() {
  return session;
}

export function useAuthReady() {
  return ready;
}

export function useUser(): () => User | null {
  return () => session()?.user ?? null;
}

// Magic-Link senden. `redirectPath` (ohne fuehrenden Slash) wird an
// SITE_URL angehaengt und an Supabase als emailRedirectTo uebergeben —
// damit der Klick auf den Mail-Link direkt auf einer bestimmten Sub-
// Route landet (z.B. invite/<token> fuer den Invite-Redeem-Flow). Ohne
// redirectPath landet der Mail-Link auf SITE_URL (Default-Verhalten).
//
// SITE_URL endet immer mit '/', daher ein evtl. fuehrender Slash am
// redirectPath wird gestrippt damit '//' nicht entstehen.
export async function signInWithMagicLink(email: string, redirectPath?: string): Promise<void> {
  const emailRedirectTo = redirectPath ? SITE_URL + redirectPath.replace(/^\/+/, '') : SITE_URL;
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// Hilfs-Hook: fuer Komponenten, die nach Unmount nichts mehr wollen.
export function onAuthChange(cb: (s: Session | null) => void): void {
  const { data } = supabase.auth.onAuthStateChange((_e, s) => cb(s));
  onCleanup(() => data.subscription.unsubscribe());
}
