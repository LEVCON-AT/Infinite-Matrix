// QuickActionSheet — Bottom-Sheet hinter dem zentralen FAB.
//
// Mobile-Pendant zur Desktop-Command-Palette (^-Hotkey). Suchfeld oben
// (V1: noch ohne Live-Search — leitet an HeaderSearchBar weiter), darunter
// kontextuelle Aktionen (Aufgabe / Doku / Object / Tag). V1-Aktionen
// triggern Toast-Hinweise; volle Implementierung folgt mit AtomPicker-
// Migration in S9.

import { useNavigate } from '@solidjs/router';
import type { Accessor, Component } from 'solid-js';
import { showToast } from '../../lib/toasts';
import Icon from '../Icon';
import BottomSheet from './BottomSheet';

type QuickActionSheetProps = {
  workspaceId: string;
  open: Accessor<boolean>;
  onClose: () => void;
};

const QuickActionSheet: Component<QuickActionSheetProps> = (props) => {
  const navigate = useNavigate();

  const fireAction = (label: string): void => {
    showToast(`${label}: kommt in einem naechsten Sprint.`, 'info');
    props.onClose();
  };

  return (
    <BottomSheet open={props.open} onClose={props.onClose} title="Schnellaktion">
      <div class="quick-action-search-wrap">
        <Icon name="search" size={18} />
        <input
          type="search"
          class="quick-action-search-input"
          placeholder="Suchen oder Befehl …"
          aria-label="Suche oder Befehl"
        />
      </div>
      <ul class="quick-action-list">
        <li>
          <button
            type="button"
            class="quick-action-btn click-pulse"
            onClick={() => fireAction('Aufgabe anlegen')}
          >
            <Icon name="check-circle" size={20} />
            <span>Aufgabe</span>
          </button>
        </li>
        <li>
          <button
            type="button"
            class="quick-action-btn click-pulse"
            onClick={() => fireAction('Doku anlegen')}
          >
            <Icon name="document-text" size={20} />
            <span>Doku</span>
          </button>
        </li>
        <li>
          <button
            type="button"
            class="quick-action-btn click-pulse"
            onClick={() => {
              navigate(`/w/${props.workspaceId}/objects`);
              props.onClose();
            }}
          >
            <Icon name="archive-box" size={20} />
            <span>Objekte</span>
          </button>
        </li>
        <li>
          <button
            type="button"
            class="quick-action-btn click-pulse"
            onClick={() => fireAction('Tag erstellen')}
          >
            <Icon name="tag" size={20} />
            <span>Tag</span>
          </button>
        </li>
      </ul>
    </BottomSheet>
  );
};

export default QuickActionSheet;
