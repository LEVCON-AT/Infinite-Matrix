import { createSignal, onCleanup } from 'solid-js';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';

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

export async function signInWithMagicLink(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${window.location.origin}/` },
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
