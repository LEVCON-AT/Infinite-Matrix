// Kleiner Avatar-Stack fuer die Online-Nutzer im aktuellen Workspace.
// Maximal 4 sichtbare Avatars, der Rest wird als "+N"-Chip gebuendelt.
// Self (erster Eintrag) traegt eine dezente zweite Border-Linie, damit
// man sich selbst unter anderen wiederfindet.

import { For, Show, type Component } from 'solid-js';
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

const Avatar: Component<{ user: PresenceUser; isSelf: boolean }> = (p) => {
  const colorVar = () => avatarColorFor(p.user.email);
  return (
    <span
      class="presence-avatar"
      classList={{ 'presence-avatar-self': p.isSelf }}
      style={{ '--avatar-color': `var(${colorVar()})` }}
      title={p.isSelf ? `${p.user.email} (Du)` : p.user.email}
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
  );
  const visible = () => users().slice(0, MAX_VISIBLE);
  const overflow = () => Math.max(0, users().length - MAX_VISIBLE);

  return (
    <div class="presence-stack" aria-label="Online-Nutzer">
      <For each={visible()}>
        {(u) => <Avatar user={u} isSelf={u.userId === p.selfUserId} />}
      </For>
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
