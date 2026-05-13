// Welle WV.A.6 — TemplateSectionRenderer.
//
// Rendert eine template_sections-Zeile mit Header (wenn title) und
// Grid-Layout fuer die enthaltenen Widgets. Collapse-State per Section
// (default_collapsed) — User-Toggle persistiert spaeter (Welle C) per
// User-Preference (separate Tabelle, nicht in template_sections selbst).

import { type Component, For, Show, createSignal } from 'solid-js';
import type { ResolvedSection } from '../lib/widget-foundation';
import { TEMPLATE_GRID_COLS } from '../lib/widget-foundation';
import Icon from './Icon';
import TemplateWidgetRenderer from './TemplateWidgetRenderer';

export type TemplateSectionRendererProps = {
  section: ResolvedSection;
  editMode?: boolean;
  onResetOverride?: (overrideId: string) => void;
  // Welle WV.D.3.g — Channel-Bridge-Picker. Caller (CellTemplateRenderer)
  // entscheidet was passiert (V1: oeffnet ChannelPickerModal).
  onPickChannel?: (widgetId: string) => void;
  // Welle WV.D.5.a — DriveWidget braucht cell-Kontext fuer Link-Action.
  cellId?: string;
  workspaceId?: string;
};

const TemplateSectionRenderer: Component<TemplateSectionRendererProps> = (p) => {
  const [collapsed, setCollapsed] = createSignal(p.section.default_collapsed);

  // Visibility=edit_only: nur im Edit-Mode zeigen.
  const isVisible = () => p.section.visibility === 'always' || (p.editMode ?? false);

  return (
    <Show when={isVisible()}>
      <section class="template-section" data-section-id={p.section.id}>
        <Show when={p.section.title}>
          <header class="template-section-head">
            <button
              type="button"
              class="template-section-toggle"
              aria-expanded={!collapsed()}
              onClick={() => setCollapsed((v) => !v)}
            >
              <Icon name={collapsed() ? 'chevron-right' : 'chevron-down'} size={14} />
              <span class="template-section-title">{p.section.title}</span>
            </button>
          </header>
        </Show>
        <Show when={!collapsed()}>
          <div class="template-section-grid" style={{ '--template-grid-cols': TEMPLATE_GRID_COLS }}>
            <For each={p.section.widgets}>
              {(widget) => (
                <TemplateWidgetRenderer
                  widget={widget}
                  editMode={p.editMode}
                  onResetOverride={p.onResetOverride}
                  channel={widget.channel}
                  onPickChannel={p.onPickChannel ? () => p.onPickChannel?.(widget.id) : undefined}
                  cellId={p.cellId}
                  workspaceId={p.workspaceId}
                />
              )}
            </For>
          </div>
        </Show>
      </section>
    </Show>
  );
};

export default TemplateSectionRenderer;
