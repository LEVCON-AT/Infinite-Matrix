// Welle WV.C.5 — SlotHintToolbar (Konzept §8.4.2).
//
// 9 Slot-Buttons als globale Edit-Mode-Toolbar. Symbol oben + Hotkey-
// Zahl unten rechts. Click triggert Bulk-Wizard fuer Slot N (Touch-
// Aequivalent zur Hardware-Hotkey 1-9). Drei-Schicht-Inheritance-
// Indikator: Plattform=neutral, Workspace-Override=blauer Punkt unten
// links, User-Override=gelber Punkt unten rechts.
//
// Sichtbarkeit: Edit-Mode aktiv → Toolbar immer sichtbar (auch ohne
// Selektion, damit User vor Selektion weiss was passieren wird).
// Position in EditModeToolbar: links neben Selektions-Counter.
//
// Mobile (< 48em): collapse zu Dropdown „Slots ▾" — V1 zeigen wir die
// Slots als horizontale Scroll-Liste statt Dropdown (einfacher,
// weniger Modal-State).

import { type Component, For, Show, createMemo } from 'solid-js';
import { resolveSlotTemplateId } from '../../lib/hotkey-slots';
import { showToast } from '../../lib/toasts';
import type {
  FeatureTemplateRow,
  UserHotkeySlotRow,
  WorkspaceHotkeySlotRow,
} from '../../lib/types';
import Icon, { type IconName } from '../Icon';

export type SlotHintToolbarProps = {
  workspaceId: string;
  userId: string | null;
  workspaceSlots: ReadonlyArray<WorkspaceHotkeySlotRow>;
  userSlots: ReadonlyArray<UserHotkeySlotRow>;
  templates: ReadonlyArray<FeatureTemplateRow>;
  selectionCount: number;
  // Click-Handler: triggert Bulk-Wizard fuer Slot N. Parent-Logik
  // (C.4) entscheidet ob Wizard oeffnet oder Hint-Toast „erst Cells
  // selektieren". Wenn nicht uebergeben, default: Toast.
  onPickSlot: (slot: number, templateId: string) => void;
  // Click auf leeren Slot: Navigiert zum Templates-Picker. Caller
  // navigiert via useNavigate.
  onPickEmptySlot: (slot: number) => void;
};

const SLOT_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

// Bekannte Heroicon-Namen aus IconName-Union (lib/Icon.tsx).
// Default-Symbol fuer unbekannte Werte = `document-text`.
const KNOWN_SYMBOL_NAMES = new Set<IconName>([
  'view-columns',
  'list-bullet',
  'information-circle',
  'sparkles',
  'document-text',
  'calendar',
  'link',
  'tag',
  'eye',
  'envelope',
  'flag',
  'cog',
  'phone',
  'banknotes',
  'calculator',
  'at-symbol',
  'shield-check',
  'lock-closed',
  'users',
]);

const SlotHintToolbar: Component<SlotHintToolbarProps> = (p) => {
  // Resolved-Slot-Map: pro Slot N das Template + Override-Quelle.
  type ResolvedSlot = {
    slot: number;
    templateId: string | null;
    template: FeatureTemplateRow | null;
    isWorkspaceOverride: boolean;
    isUserOverride: boolean;
  };

  const resolvedSlots = createMemo<ResolvedSlot[]>(() => {
    const userId = p.userId ?? '';
    return SLOT_NUMBERS.map((slot) => {
      const templateId = userId
        ? resolveSlotTemplateId(slot, p.workspaceSlots, p.userSlots, p.workspaceId, userId)
        : null;
      const template = templateId ? (p.templates.find((t) => t.id === templateId) ?? null) : null;
      const wsRow = p.workspaceSlots.find((r) => r.slot === slot);
      const userRow = p.userSlots.find((r) => r.slot === slot && r.user_id === userId);
      return {
        slot,
        templateId,
        template,
        isWorkspaceOverride: !!wsRow,
        isUserOverride: !!userRow,
      };
    });
  });

  function handleClick(rs: ResolvedSlot): void {
    if (!rs.template || !rs.templateId) {
      // Leerer Slot → zum Templates-Picker.
      p.onPickEmptySlot(rs.slot);
      return;
    }
    if (p.selectionCount === 0) {
      showToast('Selektiere zuerst Cells, dann waehle einen Slot.', 'info');
      return;
    }
    p.onPickSlot(rs.slot, rs.templateId);
  }

  function symbolFor(t: FeatureTemplateRow | null): IconName {
    if (!t?.symbol) return 'document-text';
    return KNOWN_SYMBOL_NAMES.has(t.symbol as IconName) ? (t.symbol as IconName) : 'document-text';
  }

  function tooltipFor(rs: ResolvedSlot): string {
    if (!rs.template) return `Slot ${rs.slot} (leer) — klicken um Vorlage zuzuweisen`;
    const overrideInfo = rs.isUserOverride
      ? ' (User-Override)'
      : rs.isWorkspaceOverride
        ? ' (Workspace-Override)'
        : ' (Plattform-Default)';
    return `Hotkey ${rs.slot}: ${rs.template.name}${overrideInfo}`;
  }

  return (
    <div class="slot-hint-toolbar" role="toolbar" aria-label="Vorlagen-Hotkeys">
      <For each={resolvedSlots()}>
        {(rs) => (
          <button
            type="button"
            class="slot-hint-button"
            classList={{
              'slot-hint-empty': !rs.template,
              'slot-hint-occupied': !!rs.template,
              'slot-hint-no-selection': !!rs.template && p.selectionCount === 0,
            }}
            title={tooltipFor(rs)}
            aria-label={tooltipFor(rs)}
            onClick={() => handleClick(rs)}
          >
            <span class="slot-hint-symbol" aria-hidden="true">
              <Show when={rs.template} fallback={<Icon name="plus" size={14} />}>
                <Icon name={symbolFor(rs.template)} size={14} />
              </Show>
            </span>
            <span class="slot-hint-num" aria-hidden="true">
              {rs.slot}
            </span>
            <Show when={rs.isWorkspaceOverride}>
              <span class="slot-hint-dot slot-hint-dot-workspace" aria-hidden="true" />
            </Show>
            <Show when={rs.isUserOverride}>
              <span class="slot-hint-dot slot-hint-dot-user" aria-hidden="true" />
            </Show>
          </button>
        )}
      </For>
    </div>
  );
};

export default SlotHintToolbar;
