// MoreTab — Bottom-Sheet mit Workspace-uebergreifenden Aktionen, das
// vom 5. Tab "Mehr" geoeffnet wird. Sammelt alles was auf Desktop ueber
// Hotkeys oder kleine Header-Buttons erreichbar ist und auf Phone keinen
// eigenen Tab hat.
//
// V1-Inhalt: Edit-Mode-Toggle, Theme-Switch, Settings-Link, Logout.

import { useNavigate } from '@solidjs/router';
import type { Accessor, Component } from 'solid-js';
import { signOut } from '../../lib/auth';
import { toggleEditMode, useEditMode } from '../../lib/edit-mode';
import { toggleTheme, useTheme } from '../../lib/theme';
import Icon from '../Icon';
import BottomSheet from './BottomSheet';

type MoreTabProps = {
  open: Accessor<boolean>;
  onClose: () => void;
};

const MoreTab: Component<MoreTabProps> = (props) => {
  const navigate = useNavigate();
  const editMode = useEditMode();
  const theme = useTheme();

  return (
    <BottomSheet open={props.open} onClose={props.onClose} title="Weitere Aktionen">
      <ul class="more-tab-list">
        <li>
          <button
            type="button"
            class="more-tab-btn click-pulse"
            onClick={() => {
              toggleEditMode();
              props.onClose();
            }}
            aria-pressed={editMode()}
          >
            <Icon name="pencil" size={20} />
            <span>Editieren</span>
            <span class="more-tab-state">{editMode() ? 'an' : 'aus'}</span>
          </button>
        </li>
        <li>
          <button
            type="button"
            class="more-tab-btn click-pulse"
            onClick={() => {
              toggleTheme();
            }}
            aria-pressed={theme() === 'dark'}
          >
            <Icon name={theme() === 'dark' ? 'moon' : 'sun'} size={20} />
            <span>Theme</span>
            <span class="more-tab-state">{theme() === 'dark' ? 'dunkel' : 'hell'}</span>
          </button>
        </li>
        <li>
          <button
            type="button"
            class="more-tab-btn click-pulse"
            onClick={() => {
              navigate('/settings');
              props.onClose();
            }}
          >
            <Icon name="cog" size={20} />
            <span>Einstellungen</span>
          </button>
        </li>
        <li>
          <button
            type="button"
            class="more-tab-btn more-tab-btn-danger click-pulse"
            onClick={async () => {
              props.onClose();
              await signOut();
            }}
          >
            <Icon name="lock-closed" size={20} />
            <span>Abmelden</span>
          </button>
        </li>
      </ul>
    </BottomSheet>
  );
};

export default MoreTab;
