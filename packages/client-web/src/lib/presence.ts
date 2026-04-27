// Realtime-Presence pro Workspace. Zeigt welche User gerade im selben
// Workspace online sind. Jeder Client tracked (email, joinedAt) und
// hoert 'sync' auf den ganzen Presence-State, der vom Supabase-Server
// gebroadcastet wird.
//
// Phase-1.C: Erweiterung um Position-Tracking (nodeId/cellId/feature)
// und Activity-Level-Gating. Drei Stufen:
//   - 'off'     -> Channel wird gar nicht subscribed, User taucht nicht auf.
//   - 'present' -> wie zuvor: nur {email, joinedAt}.
//   - 'full'    -> zusaetzlich Position aus dem Route-Stand.
// Incognito-Signal (lib/incognito.ts) ueberschreibt den Level temporaer
// auf 'off'.
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
//
// Position-Update beim Route-Wechsel triggert KEINEN Channel-Rebuild.
// Stattdessen wird channel.track(payload) erneut gefeuert — Supabase
// merged das per Presence-Key. Throttle (200 ms) verhindert WS-Spam
// bei schnellem Klick-durch im Tree.

import { type Accessor, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { useIncognito } from './incognito';
import { useActivityLevel } from './settings';
import { supabase } from './supabase';

// Feature-Section innerhalb einer Cell. Spiegelt cellSection() in
// Workspace.tsx (Z. 140). Wenn man nur auf einem Matrix/Board-Knoten
// steht (kein Drill in eine Cell), bleibt feature undefined und nur
// nodeId ist gesetzt.
export type PresenceFeature = 'info' | 'checklists' | 'docs';

export type PresencePosition = {
  nodeId?: string;
  cellId?: string;
  feature?: PresenceFeature;
  // P1.D: Live-Cursor-Indikatoren. Aendern sich oft (mouseenter/leave),
  // bleiben aber im selben 200ms-Throttle-Fenster wie der Rest. Pro
  // Page-Typ ein eigenes Hover-Feld:
  //   hoverCellId  — auf der Matrix-Page (welche Cell wird gehovered)
  //   hoverCardId  — auf der Board-Page (welche Card)
  //   hoverItemId  — in CellChecklistsPage (welches Checklist-Item)
  //   hoverFieldId — in CellInfoPage (welches Feld oder welcher Link)
  hoverCellId?: string;
  hoverCardId?: string;
  hoverItemId?: string;
  hoverFieldId?: string;
};

export type PresenceUser = {
  userId: string;
  email: string;
  joinedAt: string;
  nodeId?: string;
  cellId?: string;
  feature?: PresenceFeature;
  hoverCellId?: string;
  hoverCardId?: string;
  hoverItemId?: string;
  hoverFieldId?: string;
};

const POSITION_THROTTLE_MS = 200;

function isFeature(v: unknown): v is PresenceFeature {
  return v === 'info' || v === 'checklists' || v === 'docs';
}

export function usePresence(
  workspaceId: Accessor<string>,
  selfUserId: Accessor<string>,
  selfEmail: Accessor<string>,
  position: Accessor<PresencePosition>,
): Accessor<PresenceUser[]> {
  const [users, setUsers] = createSignal<PresenceUser[]>([]);
  const activityLevel = useActivityLevel();
  const incognito = useIncognito();

  // Effektiver Sichtbarkeits-Level: Incognito ueberschreibt Settings.
  const effectiveLevel = createMemo(() => (incognito() ? 'off' : activityLevel()));

  // Supabase emittiert `onAuthStateChange` auch bei reinen Token-Refreshs
  // (TOKEN_REFRESHED ohne Identity-Wechsel). Das produziert ein neues
  // Session-Object → neue User-Reference → `user()` emittiert → unser
  // Effect unten wuerde den Presence-Channel voellig abreissen und neu
  // aufbauen — das fuehrt zu einem Avatar-Blink im Sekunden-/Minuten-
  // Takt. Die createMemos stabilisieren die Effect-Deps auf String-
  // Equality (createMemo default `equals:===`): solange ID, Email und
  // WsId wirklich gleich sind, emittiert das Memo nicht und der Effect
  // laeuft nicht erneut.
  const wsIdMemo = createMemo(() => workspaceId());
  const selfIdMemo = createMemo(() => selfUserId());
  const emailMemo = createMemo(() => selfEmail());

  createEffect(() => {
    const wsId = wsIdMemo();
    const selfId = selfIdMemo();
    const email = emailMemo();
    const level = effectiveLevel();
    if (!wsId || !selfId || level === 'off') {
      setUsers([]);
      return;
    }

    // Ein einzelner joinedAt-Timestamp pro Channel-Lebenszeit. Bei
    // Reconnects/Re-Subscribes wird track() erneut aufgerufen, aber
    // mit demselben Timestamp — so aendert sich die Meta-Payload nicht
    // und die Equality-Gate im rebuild() blockt unnoetige setUsers-
    // Aufrufe.
    const sessionJoinedAt = new Date().toISOString();

    const channel = supabase.channel(`presence:${wsId}`, {
      config: { presence: { key: selfId } },
    });

    const buildPayload = (): Record<string, unknown> => {
      const payload: Record<string, unknown> = {
        email,
        joinedAt: sessionJoinedAt,
      };
      if (effectiveLevel() === 'full') {
        const pos = position();
        if (pos.nodeId) payload.nodeId = pos.nodeId;
        if (pos.cellId) payload.cellId = pos.cellId;
        if (pos.feature) payload.feature = pos.feature;
        if (pos.hoverCellId) payload.hoverCellId = pos.hoverCellId;
        if (pos.hoverCardId) payload.hoverCardId = pos.hoverCardId;
        if (pos.hoverItemId) payload.hoverItemId = pos.hoverItemId;
        if (pos.hoverFieldId) payload.hoverFieldId = pos.hoverFieldId;
      }
      return payload;
    };

    const rebuild = () => {
      const raw = channel.presenceState() as Record<
        string,
        Array<{
          email?: string;
          joinedAt?: string;
          nodeId?: string;
          cellId?: string;
          feature?: string;
          hoverCellId?: string;
          hoverCardId?: string;
          hoverItemId?: string;
          hoverFieldId?: string;
        }>
      >;
      // Stale-State-Filter: Auf Staging feuert der Realtime-Server
      // periodisch CHANNEL_ERROR → SUBSCRIBED (~1 s-Takt). In dem Re-
      // Subscribe-Fenster ist channel.presenceState() kurz leer, bevor
      // unser eigener track() wieder durchkommt (~35 ms spaeter).
      // Diesen Zwischenstand darf das UI nicht sehen — sonst unmountet/
      // remountet der Avatar im Blink-Rhythmus. Solange wir subscribed
      // sind, MUESSEN wir selbst im Presence-State sein. Fehlt self
      // → stale, rebuild ignorieren, auf das naechste sync warten.
      if (selfId && !(selfId in raw)) {
        return;
      }
      const list: PresenceUser[] = [];
      for (const [userId, metas] of Object.entries(raw)) {
        const meta = metas[0];
        if (!meta) continue;
        const entry: PresenceUser = {
          userId,
          email: typeof meta.email === 'string' ? meta.email : '(unbekannt)',
          joinedAt: typeof meta.joinedAt === 'string' ? meta.joinedAt : sessionJoinedAt,
        };
        if (typeof meta.nodeId === 'string') entry.nodeId = meta.nodeId;
        if (typeof meta.cellId === 'string') entry.cellId = meta.cellId;
        if (isFeature(meta.feature)) entry.feature = meta.feature;
        if (typeof meta.hoverCellId === 'string') entry.hoverCellId = meta.hoverCellId;
        if (typeof meta.hoverCardId === 'string') entry.hoverCardId = meta.hoverCardId;
        if (typeof meta.hoverItemId === 'string') entry.hoverItemId = meta.hoverItemId;
        if (typeof meta.hoverFieldId === 'string') entry.hoverFieldId = meta.hoverFieldId;
        list.push(entry);
      }
      list.sort((a, b) => {
        if (a.userId === selfId) return -1;
        if (b.userId === selfId) return 1;
        return a.email.localeCompare(b.email);
      });
      // Identitaets-Check: Supabase feuert 'sync' als Heartbeat alle
      // ~30s im Normalbetrieb, aber bei Reconnect/Flaky-WS haeufiger.
      // joinedAt ignorieren — wird nie gerendert, und Server-Payloads
      // koennen es minimal anders serialisieren. Identitaet besteht aus
      // userId/email/Position-Trio — wenn sich nichts davon aendert,
      // setUsers ueberspringen.
      const current = users();
      if (current.length === list.length) {
        let same = true;
        for (let i = 0; i < list.length; i++) {
          const a = current[i];
          const b = list[i];
          if (
            a.userId !== b.userId ||
            a.email !== b.email ||
            a.nodeId !== b.nodeId ||
            a.cellId !== b.cellId ||
            a.feature !== b.feature ||
            a.hoverCellId !== b.hoverCellId ||
            a.hoverCardId !== b.hoverCardId ||
            a.hoverItemId !== b.hoverItemId ||
            a.hoverFieldId !== b.hoverFieldId
          ) {
            same = false;
            break;
          }
        }
        if (same) return;
      }
      setUsers(list);
    };

    let throttleTimer: ReturnType<typeof setTimeout> | null = null;
    let isSubscribed = false;

    const flushTrack = () => {
      throttleTimer = null;
      if (!isSubscribed) return;
      void channel.track(buildPayload());
    };

    const scheduleTrack = () => {
      if (!isSubscribed) return;
      if (throttleTimer) return;
      throttleTimer = setTimeout(flushTrack, POSITION_THROTTLE_MS);
    };

    channel
      .on('presence', { event: 'sync' }, rebuild)
      .on('presence', { event: 'join' }, rebuild)
      .on('presence', { event: 'leave' }, rebuild)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          isSubscribed = true;
          void channel.track(buildPayload());
        }
      });

    // Reaktiver Position-Update-Pfad: bei 'full' triggert jede
    // position()/effectiveLevel()-Aenderung einen throttled track().
    // Bei 'present' lesen wir position() bewusst nicht — keine
    // unnoetigen Updates.
    createEffect(() => {
      const lvl = effectiveLevel();
      if (lvl !== 'full') return;
      // Position lesen damit der Effect bei Aenderung re-runs.
      position();
      scheduleTrack();
    });

    onCleanup(() => {
      if (throttleTimer) {
        clearTimeout(throttleTimer);
        throttleTimer = null;
      }
      isSubscribed = false;
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
const AVATAR_COLORS = ['--blue', '--teal', '--amber', '--red', '--purple'] as const;

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
