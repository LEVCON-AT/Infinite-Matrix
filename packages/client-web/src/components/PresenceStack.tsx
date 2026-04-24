// Kleiner Avatar-Stack fuer die Online-Nutzer im aktuellen Workspace.
// Maximal 4 sichtbare Avatars, der Rest wird als "+N"-Chip gebuendelt.
// Self (erster Eintrag) traegt eine dezente zweite Border-Linie, damit
// man sich selbst unter anderen wiederfindet.

import { Index, Show, type Component } from 'solid-js';
import {
  avatarColorFor,
  avatarInitial,
  usePresence,
  type PresenceUser,
} from '../lib/presence';

type Props = {
  workspaceId: string;
  selfUserId: string;
  selfEmail: string;
};

const MAX_VISIBLE = 4;

const Avatar: Component<{ user: () => PresenceUser; isSelf: () => boolean }> = (p) => {
  const email = () => p.user().email;
  const colorVar = () => avatarColorFor(email());
  return (
    <span
      class="presence-avatar"
      classList={{ 'presence-avatar-self': p.isSelf() }}
      style={{ '--avatar-color': `var(${colorVar()})` }}
      title={p.isSelf() ? `${email()} (Du)` : email()}
      aria-label={email()}
    >
      {avatarInitial(email())}
    </span>
  );
};

const PresenceStack: Component<Props> = (p) => {
  const users = usePresence(
    () => p.workspaceId,
    () => p.selfUserId,
    () => p.selfEmail,
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
        {(u) => <Avatar user={u} isSelf={() => u().userId === p.selfUserId} />}
      </Index>
      <Show when={overflow() > 0}>
        <span
          class="presence-avatar presence-avatar-overflow"
          title={`+${overflow()} weitere`}
        >
          +{overflow()}
        </span>
      </Show>
    </div>
  );
};

export default PresenceStack;
