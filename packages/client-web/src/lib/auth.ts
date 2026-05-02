import type { Session, User } from '@supabase/supabase-js';
import { createSignal, onCleanup } from 'solid-js';
import { clearProviderCredentialCache } from './ai-assist/credential';
import { resetAiProvidersCache } from './ai-providers';
import { clearAllAliasIndex } from './alias-index';
import { clearAllMutationQueues } from './mutation-queue';
import { clearAll as clearAllOfflineCache } from './offline-cache';
import { resetOfflineState } from './offline-state';
import { resetOnboardingGate } from './onboarding-gate';
import { supabase } from './supabase';
import { clearEverExpandedCache } from './tree-expand';
import { resetWelcomeTourCache } from './welcome-tour';

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
      // AU-B1 K3 (B1-H-002 / B1-C-001): Local-User-Data komplett wipen.
      // Ohne diesen Sweep koennte ein nachfolgender User auf demselben
      // Browser den IDB-Cache + decrypted API-Key + Mutation-Queue +
      // Alias-Index des vorherigen Users sehen.
      void clearLocalUserData();
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

  // AU-B1 K11d (B1-H-008): Cross-Tab-SignOut-Sync via storage-Event.
  // Supabase-JS speichert die Session unter `sb-<projectRef>-auth-token`
  // im localStorage. Bei signOut() in Tab A wird der Key entfernt;
  // andere Tabs bekommen das `storage`-Event mit newValue=null. Dann
  // setSession(null) lokal + clearLocalUserData(). Ohne diesen Handler
  // bleibt Tab B mit aktivem Session-Signal und faellt erst beim
  // naechsten Token-Refresh oder API-Call auf 401 (Firefox-Bug:
  // Supabase-eigener Cross-Tab-Sync funktioniert dort unzuverlaessig).
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      // Wir reagieren nur auf das Supabase-Auth-Token-Key-Pattern.
      // newValue === null bedeutet Logout in einem anderen Tab.
      if (!e.key) return;
      if (!e.key.startsWith('sb-') || !e.key.endsWith('-auth-token')) return;
      if (e.newValue !== null) return;
      // Lokal session leeren + cleanup. supabase.auth merkt das
      // beim naechsten getSession()/getUser()-Roundtrip auch, aber
      // wir geben dem UI sofort Feedback.
      setSession(null);
      void clearLocalUserData();
    });
  }
}

// AU-B1 K3 (B1-H-002 / B1-C-001): zentrale Cleanup-Funktion fuer
// SIGNED_OUT. Best-effort — einzelne Failures werden geloggt aber
// blockieren den Logout-Pfad nicht.
async function clearLocalUserData(): Promise<void> {
  // Sync-Cleanups zuerst (kein await noetig).
  try {
    clearProviderCredentialCache();
  } catch (err) {
    console.warn('clearLocalUserData: clearProviderCredentialCache failed:', err);
  }
  try {
    resetAiProvidersCache();
  } catch (err) {
    console.warn('clearLocalUserData: resetAiProvidersCache failed:', err);
  }
  try {
    clearAllAliasIndex();
  } catch (err) {
    console.warn('clearLocalUserData: clearAllAliasIndex failed:', err);
  }
  try {
    resetOnboardingGate();
  } catch (err) {
    console.warn('clearLocalUserData: resetOnboardingGate failed:', err);
  }
  try {
    resetWelcomeTourCache();
  } catch (err) {
    console.warn('clearLocalUserData: resetWelcomeTourCache failed:', err);
  }
  try {
    clearEverExpandedCache();
  } catch (err) {
    console.warn('clearLocalUserData: clearEverExpandedCache failed:', err);
  }
  try {
    resetOfflineState();
  } catch (err) {
    console.warn('clearLocalUserData: resetOfflineState failed:', err);
  }
  // Async-Cleanups: IDB-Stores parallel.
  await Promise.allSettled([
    clearAllOfflineCache().catch((err) => {
      console.warn('clearLocalUserData: clearAllOfflineCache failed:', err);
    }),
    clearAllMutationQueues().catch((err) => {
      console.warn('clearLocalUserData: clearAllMutationQueues failed:', err);
    }),
  ]);
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

// AU-B1 K9 (B1-H-014): synchroner Zugriff auf die aktuelle User-ID
// fuer Code-Pfade ausserhalb von SolidJS-Reactive-Owners (z.B.
// buildOffline-Closures in mutations.ts). Liest das Signal direkt;
// gibt null wenn nicht eingeloggt.
export function currentUserIdSync(): string | null {
  return session()?.user?.id ?? null;
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

// B.1.A — SSO via Supabase OAuth-Provider. Externes Setup (Google
// Cloud Console / Microsoft Entra Client-IDs) liegt beim Plattform-
// Admin und wird auf VPS in Supabase Auth-Config gepflegt — siehe
// docs/claude/architektur.md SSO-Sektion. Der Frontend-Aufruf ist
// stabil unabhaengig davon.
//
// redirectPath analog zum Magic-Link-Flow: wird an SITE_URL angehaengt
// und an Supabase als redirectTo uebergeben.
export async function signInWithGoogle(redirectPath?: string): Promise<void> {
  const redirectTo = redirectPath ? SITE_URL + redirectPath.replace(/^\/+/, '') : SITE_URL;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
  });
  if (error) throw error;
}

export async function signInWithMicrosoft(redirectPath?: string): Promise<void> {
  const redirectTo = redirectPath ? SITE_URL + redirectPath.replace(/^\/+/, '') : SITE_URL;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'azure',
    options: { redirectTo, scopes: 'email openid profile' },
  });
  if (error) throw error;
}

export async function signInWithGitHub(redirectPath?: string): Promise<void> {
  const redirectTo = redirectPath ? SITE_URL + redirectPath.replace(/^\/+/, '') : SITE_URL;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: { redirectTo },
  });
  if (error) throw error;
}

export async function signInWithLinkedIn(redirectPath?: string): Promise<void> {
  const redirectTo = redirectPath ? SITE_URL + redirectPath.replace(/^\/+/, '') : SITE_URL;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'linkedin_oidc',
    options: { redirectTo },
  });
  if (error) throw error;
}

// B.1.B — Email + Password. Sign-In + Sign-Up + Password-Reset.
// Magic-Link bleibt als parallele Option verfuegbar.
export async function signInWithPassword(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signUpWithPassword(
  email: string,
  password: string,
  redirectPath?: string,
): Promise<void> {
  const emailRedirectTo = redirectPath ? SITE_URL + redirectPath.replace(/^\/+/, '') : SITE_URL;
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo },
  });
  if (error) throw error;
}

export async function requestPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${SITE_URL}reset-password`,
  });
  if (error) throw error;
}

export async function updatePassword(newPassword: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// B.5 — alle anderen Sessions des Users invalidieren. Aktuelle Session
// bleibt aktiv. JWT-Refresh bei den anderen Geraeten faellt fehl, sie
// landen automatisch im Login-Flow.
export async function signOutOtherSessions(): Promise<void> {
  const { error } = await supabase.auth.signOut({ scope: 'others' });
  if (error) throw error;
}

// B.5 — alle Sessions des Users (inkl. aktueller) invalidieren.
// Sinnvoll wenn der User glaubt sein Account ist kompromittiert.
export async function signOutAllSessions(): Promise<void> {
  const { error } = await supabase.auth.signOut({ scope: 'global' });
  if (error) throw error;
}

// Hilfs-Hook: fuer Komponenten, die nach Unmount nichts mehr wollen.
export function onAuthChange(cb: (s: Session | null) => void): void {
  const { data } = supabase.auth.onAuthStateChange((_e, s) => cb(s));
  onCleanup(() => data.subscription.unsubscribe());
}
