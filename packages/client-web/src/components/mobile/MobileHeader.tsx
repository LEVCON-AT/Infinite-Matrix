// MobileHeader — Top-Bar fuer Phone-Viewport.
//
// Layout: Hamburger | Breadcrumb-Truncate | Avatare(2) + Bell.
// 56px Hoehe + safe-area-inset-top als padding. Sticky via fixed-
// position. Tap auf Breadcrumb-... zeigt vollen Pfad als Bottom-Sheet
// (V1: nur kuerzt; Pfad-Sheet folgt in S5-Polish wenn benoetigt).

import { type Accessor, type Component, For } from 'solid-js';
import { toggleEditMode, useEditMode } from '../../lib/edit-mode';
import Icon from '../Icon';
import NotificationBell from '../NotificationBell';

type MobileHeaderProps = {
  workspaceId: string;
  onHamburger: () => void;
  breadcrumb: Accessor<string[]>;
};

const MobileHeader: Component<MobileHeaderProps> = (props) => {
  const editMode = useEditMode();

  // Truncate auf max. 3 Segmente. Wenn mehr: ersetzte mittlere durch '...'.
  const truncated = (): string[] => {
    const path = props.breadcrumb();
    if (path.length <= 3) return path;
    return [path[0], '...', path[path.length - 1]];
  };

  return (
    <header class="mobile-header" role="banner">
      <button
        type="button"
        class="mobile-header-btn click-pulse"
        onClick={props.onHamburger}
        aria-label="Tree-Drawer oeffnen"
      >
        <Icon name="bars-3" size={20} />
      </button>
      <nav class="mobile-header-breadcrumb" aria-label="Pfad">
        <For each={truncated()}>
          {(seg, idx) => (
            <>
              <span class="mobile-header-breadcrumb-seg">{seg}</span>
              {idx() < truncated().length - 1 && (
                <span class="mobile-header-breadcrumb-sep" aria-hidden="true">
                  /
                </span>
              )}
            </>
          )}
        </For>
      </nav>
      <div class="mobile-header-actions">
        <button
          type="button"
          class="mobile-header-btn click-pulse"
          classList={{ 'mobile-header-btn-active': editMode() }}
          onClick={toggleEditMode}
          aria-pressed={editMode()}
          aria-label={editMode() ? 'Editieren beenden' : 'Editieren'}
        >
          <Icon name="pencil" size={18} />
        </button>
        <NotificationBell workspaceId={props.workspaceId} />
      </div>
    </header>
  );
};

export default MobileHeader;
