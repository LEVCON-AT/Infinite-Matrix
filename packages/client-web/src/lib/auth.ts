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

// Account-Health-Signal: true wenn die JWT-Session lokal existiert, der
// Server-side User aber nicht mehr (admin removed, account-deletion etc.).
// App.tsx zeigt einen Toast + redirect zu /login. Wird beim naechsten
// erfolgreichen SIGN_IN-Event wieder zurueckgesetzt.
const [accountInvalid, setAccountInvalid] = createSignal(false);

// Einmaliger Bootstrap: vorhandene Session aus Storage lesen + Subscription starten.
let bootstrapped = false;
export function bootstrapAuth(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  void (async () => {
    const { data } = await supabase.auth.getSession();
    setSession(data.session);
    setReady(true);
    if (data.session) {
      void validateUserExists();
    }
  })();

  supabase.auth.onAuthStateChange((event, s) => {
    setSession(s);
    setReady(true);
    if (event === 'SIGNED_OUT') {
      setAccountInvalid(false);
    } else if (
      s &&
      (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED')
    ) {
      // Bei jedem neuen oder aufgefrischten Token gegenchecken, ob der
      // User serverseitig noch existiert. TOKEN_REFRESHED feuert auch
      // periodisch (alle ~50 min default) — gibt uns eine quasi-periodische
      // Health-Check ohne expliziten Timer.
      void validateUserExists();
    }
  });
}

// Pruefe, ob der User aus der aktuellen JWT-Session serverseitig noch
// existiert. supabase.auth.getUser() validiert den Token gegen GoTrue
// (und damit gegen auth.users) — bei geloeschtem User kommt error oder
// data.user=null zurueck.
//
// Bei "Account weg": local-only signOut (kein Network-Round-Trip, weil
// der Server uns sowieso 403en wuerde) + accountInvalid-Flag setzen,
// damit App.tsx einen Toast zeigt + zur Login-Page schickt.
async function validateUserExists(): Promise<void> {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) {
      setAccountInvalid(true);
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } catch {
        // Lokaler signOut darf nicht haengen — Storage-Fehler ignorieren.
      }
      setSession(null);
    }
  } catch {
    // Netzfehler — wir sind offline; Session bleibt erhalten, accountInvalid
    // bleibt false. Beim naechsten Online-Roundtrip wird neu validiert.
  }
}

export function useSession() {
  return session;
}

export function useAuthReady() {
  return ready;
}

// True, sobald validateUserExists einen geloeschten Account erkannt hat.
// Wird beim naechsten erfolgreichen SIGN_IN-Event auf false zurueckgesetzt.
export function useAccountInvalid() {
  return accountInvalid;
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
