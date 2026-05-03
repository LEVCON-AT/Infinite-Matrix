// MobileBottomNav — 5-Tab-Persistent-Navigation.
//
// Layout: Tree | Matrix | (+) | Calendar | More
//          tab    tab    fab    tab     tab
//
// FAB ist 56x56, schwebt mit `bottom: calc(safe-area-inset-bottom + 0.75rem)`,
// die anderen Tabs sind 44x44 Touch-Targets in der Bar.
//
// Aktive Tab-Bestimmung: aus location.pathname. /w/:wsId/calendar →
// Calendar aktiv, /w/:wsId/n/:id → Matrix aktiv, etc. Tree-Tab oeffnet
// Drawer (kein Routing). More-Tab oeffnet Bottom-Sheet (kein Routing).

import { useLocation, useNavigate } from '@solidjs/router';
import { type Component } from 'solid-js';
import Icon from '../Icon';

type MobileBottomNavProps = {
  workspaceId: string;
  onTreeTap: () => void;
  onFabTap: () => void;
  onMoreTap: () => void;
};

const MobileBottomNav: Component<MobileBottomNavProps> = (props) => {
  const location = useLocation();
  const navigate = useNavigate();

  const isMatrixRoute = (): boolean => {
    const p = location.pathname;
    return p.startsWith(`/w/${props.workspaceId}/n/`) || p === `/w/${props.workspaceId}`;
  };
  const isCalendarRoute = (): boolean =>
    location.pathname.startsWith(`/w/${props.workspaceId}/calendar`);

  return (
    <nav class="mobile-bottom-nav" role="navigation" aria-label="Mobile-Hauptnavigation">
      <button
        type="button"
        class="mobile-bottom-nav-tab click-pulse"
        onClick={props.onTreeTap}
        aria-label="Tree-Drawer"
      >
        <Icon name="list-bullet" size={20} />
        <span>Tree</span>
      </button>
      <button
        type="button"
        class="mobile-bottom-nav-tab click-pulse"
        classList={{ 'mobile-bottom-nav-tab-active': isMatrixRoute() }}
        onClick={() => navigate(`/w/${props.workspaceId}`)}
        aria-label="Matrix"
        aria-current={isMatrixRoute() ? 'page' : undefined}
        data-mobile-drop-tab={`/w/${props.workspaceId}`}
      >
        <Icon name="squares-2x2" size={20} />
        <span>Matrix</span>
      </button>
      <button
        type="button"
        class="mobile-bottom-nav-fab click-pulse"
        onClick={props.onFabTap}
        aria-label="Schnellaktion oeffnen"
      >
        <Icon name="plus" size={24} />
      </button>
      <button
        type="button"
        class="mobile-bottom-nav-tab click-pulse"
        classList={{ 'mobile-bottom-nav-tab-active': isCalendarRoute() }}
        onClick={() => navigate(`/w/${props.workspaceId}/calendar`)}
        aria-label="Kalender"
        aria-current={isCalendarRoute() ? 'page' : undefined}
        data-mobile-drop-tab={`/w/${props.workspaceId}/calendar`}
      >
        <Icon name="calendar" size={20} />
        <span>Kalender</span>
      </button>
      <button
        type="button"
        class="mobile-bottom-nav-tab click-pulse"
        onClick={props.onMoreTap}
        aria-label="Weitere Aktionen"
      >
        <Icon name="ellipsis-horizontal" size={20} />
        <span>Mehr</span>
      </button>
    </nav>
  );
};

export default MobileBottomNav;
