// Mini-Static-Avatar fuer den Knoten-Ersteller (NT.3). Zeigt den User
// der den Knoten erstellt hat — als kleiner Klick-Avatar, der zur
// Members-Page mit Hash-Anker auf die entsprechende Member-Row springt.
//
// Tooltip: "Erstellt von <email>"; bei NULL-Member (User-geloescht oder
// Service-Role-Insert ohne explicit-Param): "Ersteller unbekannt" +
// disabled-Look. Settings-Layout (P1.S) hat den Hash-Scroll-Effect
// schon — wir setzen nur den Anker beim Navigate.

import { useNavigate } from '@solidjs/router';
import { type Component, createMemo } from 'solid-js';
import type { WorkspaceMember } from '../lib/members';
import { avatarColorFor } from '../lib/presence';

type Props = {
  member: WorkspaceMember | null;
  workspaceId: string;
};

const TreeAvatar: Component<Props> = (props) => {
  const navigate = useNavigate();
  const initial = createMemo(() => {
    const m = props.member;
    if (!m) return '?';
    const src = m.display_name?.trim() || m.email || '?';
    return src.slice(0, 1).toUpperCase();
  });
  const tooltip = createMemo(() => {
    const m = props.member;
    if (!m) return 'Ersteller unbekannt';
    return `Erstellt von ${m.email ?? m.display_name ?? 'Mitglied'}`;
  });
  const colorVar = createMemo(() => {
    const m = props.member;
    return m?.email ? avatarColorFor(m.email) : '--text3';
  });

  const onClick = (e: MouseEvent) => {
    if (!props.member) return;
    // stopPropagation reicht in NodeTree heute — TreeItem-Click ist
    // ein Standard-onClick auf dem A-Tag, kein Capture/Pointerdown.
    // Bei Risiko-Wiedervorlage R4 (memory) tauscht man auf
    // pointerdown+stopImmediatePropagation.
    e.stopPropagation();
    e.preventDefault();
    navigate(`/w/${props.workspaceId}/settings/workspace/members#user-${props.member.user_id}`);
  };

  return (
    <button
      type="button"
      class="tree-avatar tree-avatar-creator"
      classList={{ 'tree-avatar-unknown': !props.member }}
      style={{ '--avatar-color': `var(${colorVar()})` }}
      title={tooltip()}
      aria-label={tooltip()}
      onClick={onClick}
      disabled={!props.member}
    >
      {initial()}
    </button>
  );
};

export default TreeAvatar;
