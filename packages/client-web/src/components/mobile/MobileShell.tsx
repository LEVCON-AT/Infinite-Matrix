// MobileShell — Phone-Layer (Top-Header + Bottom-Nav + FAB).
//
// Rendert sich nur wenn body[data-viewport="phone"]. Sitzt als fixed-
// position-Overlay UEBER der existing Workspace-Shell (.ws-shell), die
// CSS-seitig auf Phone die Sidebar via display:none ausblendet und den
// Main-Bereich Vollbreite macht. Damit greift der Mobile-Refit ohne
// die 1781-Zeilen-Workspace.tsx zu re-architekturieren.
//
// Wir mounten nur die statische Hülle. Die Sub-Komponenten (Header,
// Bottom-Nav, FAB-Sheet, More-Tab-Sheet) leben in eigenen Dateien
// und werden hier zusammengesteckt. State (Drawer-Open, Sheet-Open,
// Active-Tab) lebt in Solid-Signals.

import { type Component, Show, createSignal } from 'solid-js';
import { useMobile } from '../../lib/use-mobile';
import MobileBottomNav from './MobileBottomNav';
import MobileHeader from './MobileHeader';
import MoreTab from './MoreTab';
import QuickActionSheet from './QuickActionSheet';

type MobileShellProps = {
  workspaceId: string;
  onOpenTreeDrawer: () => void;
  breadcrumb: () => string[];
};

const MobileShell: Component<MobileShellProps> = (props) => {
  const mobile = useMobile();
  const [quickOpen, setQuickOpen] = createSignal(false);
  const [moreOpen, setMoreOpen] = createSignal(false);

  return (
    <Show when={mobile.phone()}>
      <MobileHeader
        workspaceId={props.workspaceId}
        onHamburger={props.onOpenTreeDrawer}
        breadcrumb={props.breadcrumb}
      />
      <MobileBottomNav
        workspaceId={props.workspaceId}
        onTreeTap={props.onOpenTreeDrawer}
        onFabTap={() => setQuickOpen(true)}
        onMoreTap={() => setMoreOpen(true)}
      />
      <QuickActionSheet
        workspaceId={props.workspaceId}
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
      />
      <MoreTab open={moreOpen} onClose={() => setMoreOpen(false)} />
    </Show>
  );
};

export default MobileShell;
