// Kleiner Avatar-Stack fuer die Online-Nutzer im aktuellen Workspace.
// Maximal 4 sichtbare Avatars, der Rest wird als "+N"-Chip gebuendelt.
// Self (erster Eintrag) traegt eine dezente zweite Border-Linie, damit
// man sich selbst unter anderen wiederfindet.
//
// Phase-1.C: Tooltip zeigt zusaetzlich, wo der User gerade ist
// ("schaut: <Matrix-Name>"). Den Label-Aufloeser uebergibt der
// Parent — PresenceStack kennt nur die userIds/emails, nicht die
// node/cell-Tabellen. Workspace.tsx hat die Resources bereits geladen
// und reicht eine resolveLabel(user)-Funktion durch.

import { type Component, Index, Show } from 'solid-js';
import {
  type PresencePosition,
  type PresenceUser,
  avatarColorFor,
  avatarInitial,
  usePresence,
} from '../lib/presence';

type Props = {
  workspaceId: string;
  selfUserId: string;
  selfEmail: string;
  position: () => PresencePosition;
  resolveLabel?: (user: PresenceUser) => string | undefined;
};

const MAX_VISIBLE = 4;

const Avatar: Component<{
  user: PresenceUser;
  isSelf: boolean;
  resolveLabel?: (user: PresenceUser) => string | undefined;
}> = (p) => {
  // p.user ist via Solid-Reactive-Props automatisch reaktiv — Avatar
  // bleibt permanent gemountet dank <Index> im Parent. Nur der reaktive
  // Inhalt (Email, Color) aktualisiert sich.
  const tooltip = () => {
    const base = p.isSelf ? `${p.user.email} (Du)` : p.user.email;
    const where = p.resolveLabel?.(p.user);
    return where ? `${base} — ${where}` : base;
  };
  return (
    <span
      class="presence-avatar"
      classList={{ 'presence-avatar-self': p.isSelf }}
      style={{ '--avatar-color': `var(${avatarColorFor(p.user.email)})` }}
      title={tooltip()}
      aria-label={p.user.email}
    >
      {avatarInitial(p.user.email)}
    </span>
  );
};

const PresenceStack: Component<Props> = (p) => {
  const users = usePresence(
    () => p.workspaceId,
    () => p.selfUserId,
    () => p.selfEmail,
    () => p.position(),
  );
  const visible = () => users().slice(0, MAX_VISIBLE);
  const overflow = () => Math.max(0, users().length - MAX_VISIBLE);

  return (
    <div class="presence-stack" aria-label="Online-Nutzer">
      {/* Index statt For: positionales Rendering, die <span>-Elemente
          bleiben stabil gemountet. Selbst wenn das users()-Signal
          irgendwann doch mal fluehig updated (Reconnect, Race), wird
          der Avatar-DOM-Node nie ersetzt — nur sein Inhalt aktualisiert.
          Damit bleibt das Layout frame-stable, kein Blink, kein Shift. */}
      <Index each={visible()}>
        {(u) => (
          <Avatar user={u()} isSelf={u().userId === p.selfUserId} resolveLabel={p.resolveLabel} />
        )}
      </Index>
      <Show when={overflow() > 0}>
        <span class="presence-avatar presence-avatar-overflow" title={`+${overflow()} weitere`}>
          +{overflow()}
        </span>
      </Show>
    </div>
  );
};

export default PresenceStack;
