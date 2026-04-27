// Mini-Avatar-Stack fuer Live-Cursor-Indikatoren auf Cell/Card/
// Item/Field. Wird als absolut positioniertes Overlay rechts oben
// auf das Hover-Ziel gelegt — Voraussetzung: der Parent ist
// position:relative.
//
// Variante des TreeAvatarStack/PresenceStack — kleiner, ohne
// pointer-events (damit der darunter liegende Click-Pfad nicht
// blockiert wird), max 2 Avatare sichtbar (sonst quetscht's auf
// Cards/Items).

import { type Component, For, Show, createMemo } from 'solid-js';
import { type PresenceUser, avatarColorFor, avatarInitial } from '../lib/presence';

type Props = {
  users: PresenceUser[];
  max?: number;
};

const DEFAULT_MAX = 2;

const PresenceMini: Component<Props> = (props) => {
  const visible = createMemo(() => props.users.slice(0, props.max ?? DEFAULT_MAX));
  const overflow = createMemo(() => Math.max(0, props.users.length - (props.max ?? DEFAULT_MAX)));
  const tooltip = createMemo(() => props.users.map((u) => u.email).join(', '));

  return (
    <Show when={props.users.length > 0}>
      <span class="presence-mini" title={tooltip()} aria-label={tooltip()}>
        <For each={visible()}>
          {(u) => (
            <span
              class="presence-mini-avatar"
              style={{ '--avatar-color': `var(${avatarColorFor(u.email)})` }}
              aria-hidden="true"
            >
              {avatarInitial(u.email)}
            </span>
          )}
        </For>
        <Show when={overflow() > 0}>
          <span class="presence-mini-avatar presence-mini-avatar-overflow" aria-hidden="true">
            +{overflow()}
          </span>
        </Show>
      </span>
    </Show>
  );
};

export default PresenceMini;
