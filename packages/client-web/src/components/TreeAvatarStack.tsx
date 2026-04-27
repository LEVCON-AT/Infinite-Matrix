// Mini-Avatar-Stack pro NodeTree-Row. Zeigt welche Workspace-Mitglieder
// gerade live in dieser Zeile (Knoten/Cell/Feature) sind.
//
// Variante des grossen PresenceStack im Header. Kleiner (Avatar-md
// = 18px statt 24px), keine Self-Border (Self ist der User selbst,
// taucht im Tree-Stack nie auf — Filter macht der Caller). Tooltip
// listet die Emails — Position ist durch die Tree-Row schon klar,
// kein extra "schaut: ..." noetig.

import { type Component, For, Show, createMemo } from 'solid-js';
import { type PresenceUser, avatarColorFor, avatarInitial } from '../lib/presence';

type Props = {
  users: PresenceUser[];
  max?: number;
};

const DEFAULT_MAX = 3;

const TreeAvatarStack: Component<Props> = (props) => {
  const visible = createMemo(() => props.users.slice(0, props.max ?? DEFAULT_MAX));
  const overflow = createMemo(() => Math.max(0, props.users.length - (props.max ?? DEFAULT_MAX)));
  const tooltip = createMemo(() => props.users.map((u) => u.email).join(', '));

  return (
    <Show when={props.users.length > 0}>
      <span class="tree-presence-stack" title={tooltip()} aria-label={tooltip()}>
        <For each={visible()}>
          {(u) => (
            <span
              class="tree-avatar tree-avatar-presence"
              style={{ '--avatar-color': `var(${avatarColorFor(u.email)})` }}
              aria-hidden="true"
            >
              {avatarInitial(u.email)}
            </span>
          )}
        </For>
        <Show when={overflow() > 0}>
          <span class="tree-avatar tree-avatar-overflow" aria-hidden="true">
            +{overflow()}
          </span>
        </Show>
      </span>
    </Show>
  );
};

export default TreeAvatarStack;
