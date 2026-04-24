// Realtime-Presence pro Workspace. Zeigt welche User gerade im selben
// Workspace online sind. Jeder Client tracked (email, joinedAt) und
// hoert 'sync' auf den ganzen Presence-State, der vom Supabase-Server
// gebroadcastet wird.
//
// Design: eigener Channel `presence:<wsId>`, NICHT der postgres-
// changes-Channel aus realtime.ts — beides am selben Channel zu
// mischen geht zwar, macht das Debugging aber deutlich muehsamer.
// Zwei Channels, zwei Verantwortlichkeiten.
//
// usePresence nimmt Accessors (nicht Strings) damit Workspace-Wechsel
// den Channel teardownen + neu aufbauen. Der createEffect-Rebuild
// haengt an den gelesenen Accessors; onCleanup im Effect entfernt
// den alten Channel bevor der neue entsteht.

import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';
import { supabase } from './supabase';

export type PresenceUser = {
  userId: string;
  email: string;
  joinedAt: string;
};

export function usePresence(
  workspaceId: Accessor<string>,
  selfUserId: Accessor<string>,
  selfEmail: Accessor<string>,
): Accessor<PresenceUser[]> {
  const [users, setUsers] = createSignal<PresenceUser[]>([]);

  createEffect(() => {
    const wsId = workspaceId();
    const selfId = selfUserId();
    const email = selfEmail();
    if (!wsId || !selfId) {
      setUsers([]);
      return;
    }

    const channel = supabase.channel(`presence:${wsId}`, {
      config: { presence: { key: selfId } },
    });

    const rebuild = () => {
      const raw = channel.presenceState() as Record<
        string,
        Array<{ email?: string; joinedAt?: string }>
      >;
      const list: PresenceUser[] = [];
      for (const [userId, metas] of Object.entries(raw)) {
        const meta = metas[0];
        if (!meta) continue;
        list.push({
          userId,
          email: typeof meta.email === 'string' ? meta.email : '(unbekannt)',
          joinedAt:
            typeof meta.joinedAt === 'string'
              ? meta.joinedAt
              : new Date().toISOString(),
        });
      }
      list.sort((a, b) => {
        if (a.userId === selfId) return -1;
        if (b.userId === selfId) return 1;
        return a.email.localeCompare(b.email);
      });
      // Identitaets-Check: Supabase feuert 'sync' im Sekundentakt als
      // Heartbeat, selbst wenn sich nichts geaendert hat. Jede neue
      // Array-Referenz triggert Solid-<For>-Rerender → Avatar-Spans
      // remounten → Layout-Shift → Nachbar-Elemente (z.B. die Header-
      // SearchBar) wackeln. Setzen den Signal nur, wenn Inhalt wirklich
      // abweicht (UserId-Liste + Email + joinedAt).
      const current = users();
      if (current.length === list.length) {
        let same = true;
        for (let i = 0; i < list.length; i++) {
          const a = current[i];
          const b = list[i];
          if (
            a.userId !== b.userId ||
            a.email !== b.email ||
            a.joinedAt !== b.joinedAt
          ) {
            same = false;
            break;
          }
        }
        if (same) return;
      }
      setUsers(list);
    };

    channel
      .on('presence', { event: 'sync' }, rebuild)
      .on('presence', { event: 'join' }, rebuild)
      .on('presence', { event: 'leave' }, rebuild)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          void channel.track({
            email,
            joinedAt: new Date().toISOString(),
          });
        }
      });

    onCleanup(() => {
      void channel.untrack();
      void supabase.removeChannel(channel);
      setUsers([]);
    });
  });

  return users;
}

// Deterministische Avatar-Farbe aus der Email — gleiche Email bekommt
// immer dieselbe Farbe, damit User in einer Session stabil wirken.
// FNV-1a 32-bit hash, Modulo auf eine kleine Palette aus den Design-
// Tokens.
// Nur Token-Farben verwenden, die in styles.css :root definiert sind.
// Pink/Green gibts nicht — einfach weglassen statt fehlschlagen.
const AVATAR_COLORS = [
  '--blue',
  '--teal',
  '--amber',
  '--red',
  '--purple',
] as const;

export function avatarColorFor(email: string): string {
  let hash = 2166136261;
  for (let i = 0; i < email.length; i++) {
    hash ^= email.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const idx = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[idx];
}

export function avatarInitial(email: string): string {
  return (email[0] ?? '?').toUpperCase();
}
