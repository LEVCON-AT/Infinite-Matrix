// Welle WV.C.1 — Template-Aktionsmenue (Drei-Punkte-Trigger).
//
// Action-Menu pro Vorlagen-Zeile. Konzept §7.1 — drei Trigger-Pfade:
// Drei-Punkte-Icon, Rechtsklick (V2 falls Bedarf), Plus-Button (V2).
// V1: nur Drei-Punkte-Icon mit Popover-Menue.

import { type Component, For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import type { FeatureTemplateRow } from '../../lib/types';
import Icon from '../Icon';

export type TemplateActionMenuProps = {
  template: FeatureTemplateRow;
  canWrite: boolean;
  isMine: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onSetHotkeySlot: () => void;
  onDelete: () => void;
};

const TemplateActionMenu: Component<TemplateActionMenuProps> = (p) => {
  const [open, setOpen] = createSignal(false);
  let triggerEl: HTMLButtonElement | undefined;
  let menuEl: HTMLDivElement | undefined;

  onMount(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!open()) return;
      const target = e.target as Node;
      if (triggerEl?.contains(target)) return;
      if (menuEl?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (!open()) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        triggerEl?.focus();
      }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    onCleanup(() => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    });
  });

  // Plattform-Vorlagen sind nicht editierbar/loeschbar, nur Hotkey-Slot
  // setzbar (Owner-Pfad) + duplizieren in den Workspace-Scope.
  const canEdit = () => p.canWrite && p.template.visibility !== 'platform';
  const canDelete = () => canEdit() && (p.isMine || p.template.visibility === 'workspace');

  type Action = {
    label: string;
    icon: Parameters<typeof Icon>[0]['name'];
    onClick: () => void;
    disabled?: boolean;
    danger?: boolean;
  };

  const actions = (): Action[] => [
    {
      label: 'Bearbeiten',
      icon: 'pencil',
      onClick: p.onEdit,
      disabled: !canEdit(),
    },
    {
      label: 'Duplizieren',
      icon: 'clipboard-document',
      onClick: p.onDuplicate,
      disabled: !p.canWrite,
    },
    {
      label: 'Hotkey-Slot',
      icon: 'sparkles',
      onClick: p.onSetHotkeySlot,
      disabled: !p.canWrite,
    },
    {
      label: 'Loeschen',
      icon: 'trash',
      onClick: p.onDelete,
      disabled: !canDelete(),
      danger: true,
    },
  ];

  return (
    <div class="template-action-menu">
      <button
        ref={(el) => {
          triggerEl = el;
        }}
        type="button"
        class="template-action-trigger"
        aria-haspopup="menu"
        aria-expanded={open()}
        aria-label={`Aktionen fuer ${p.template.name}`}
        onClick={() => setOpen(!open())}
      >
        <Icon name="ellipsis-horizontal" size={16} />
      </button>
      <Show when={open()}>
        <div
          ref={(el) => {
            menuEl = el;
          }}
          class="template-action-popover"
          role="menu"
        >
          <For each={actions()}>
            {(a) => (
              <button
                type="button"
                role="menuitem"
                class="template-action-item"
                classList={{ 'template-action-item-danger': !!a.danger }}
                onClick={() => {
                  if (a.disabled) return;
                  setOpen(false);
                  a.onClick();
                }}
                disabled={a.disabled}
              >
                <Icon name={a.icon} size={14} />
                <span>{a.label}</span>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

export default TemplateActionMenu;
