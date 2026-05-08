// Welle WV.A.6 — TemplateWidgetRenderer (Widget-Type-Dispatcher).
//
// Pre-Welle-A V1: rendert pro WidgetType einen sauberen Stub mit
// Type-Badge + Outdated-Hint + Override-Marker. Echtes Wiring an
// existing BoardView/ChecklistPanel/CellInfoPage kommt in Welle B+C
// (wenn Cell-Path durch den Renderer geht statt direkter Feature-Anlage).
//
// Heute haben Cells ihre Features (info/board/matrix/checklists) direkt
// als Cell-Eigenschaft. Nach dem Vorlagen-Refactor (Welle C) bekommen
// sie ihre Render-Definition aus cell_template_instances. Bis dahin
// rendert dieser Component die Stub-Sicht damit Vorlagen sichtbar sind
// ohne den heutigen Cell-Path zu brechen.
//
// Konzept-Verankerung: §6.5 Widget-System, §6.6 Render-Layout.

import { type Component, Match, Show, Switch } from 'solid-js';
import type { WidgetExternalChannelRow } from '../lib/types';
import type { ResolvedWidget } from '../lib/widget-foundation';
import ChannelWidget from './ChannelWidget';
import Icon from './Icon';

export type TemplateWidgetRendererProps = {
  widget: ResolvedWidget;
  // Edit-Mode-Toggle: zeigt Reset-Button bei hasOverride + andere
  // Edit-Affordances als Overlay (Zero-Shift, Memory
  // `feedback_zero_shift_edit_mode.md`).
  editMode?: boolean;
  // Reset-Action — Caller (CellTemplateRenderer) loescht den Override
  // via lib/cell-templates.ts resetWidgetOverride.
  onResetOverride?: (overrideId: string) => void;
  // Welle WV.D.3.g — Channel-Bridge-Lookup (widget_external_channels-
  // Row fuer dieses Widget). null = noch nicht verknuepft. Caller
  // (CellTemplateRenderer) filtert aus seiner wsWidgetChannels-Resource.
  channel?: WidgetExternalChannelRow | null;
  // Edit-Mode-CTA: Caller oeffnet einen Picker fuer Channel-Auswahl.
  onPickChannel?: () => void;
};

const TemplateWidgetRenderer: Component<TemplateWidgetRendererProps> = (p) => {
  return (
    <div
      class="template-widget"
      classList={{ 'template-widget-overridden': p.widget.hasOverride }}
      style={{
        'grid-column': `span ${p.widget.size_cols}`,
        'grid-row': `span ${p.widget.size_rows}`,
      }}
      data-widget-type={p.widget.type}
    >
      <header class="template-widget-head">
        <span class={`template-widget-type template-widget-type-${p.widget.type}`}>
          <WidgetTypeIcon type={p.widget.type} />
          <span class="template-widget-type-label">{widgetTypeLabel(p.widget.type)}</span>
        </span>
        <Show when={p.widget.hasOverride && p.editMode && p.widget.overrideId}>
          {(overrideId) => (
            <button
              type="button"
              class="template-widget-reset"
              title="Auf Vorlage zuruecksetzen"
              onClick={() => p.onResetOverride?.(overrideId())}
            >
              <Icon name="arrow-uturn-left" size={12} />
            </button>
          )}
        </Show>
      </header>
      <div class="template-widget-body">
        <Switch fallback={<p class="template-widget-stub-hint">{widgetStubHint(p.widget.type)}</p>}>
          <Match when={p.widget.type === 'channel'}>
            <ChannelWidget
              channel={p.channel ?? null}
              editMode={p.editMode}
              onPickChannel={p.onPickChannel}
            />
          </Match>
        </Switch>
      </div>
    </div>
  );
};

const WidgetTypeIcon: Component<{ type: ResolvedWidget['type'] }> = (p) => {
  return (
    <Switch>
      <Match when={p.type === 'kanban'}>
        <Icon name="view-columns" size={14} />
      </Match>
      <Match when={p.type === 'checklist'}>
        <Icon name="list-bullet" size={14} />
      </Match>
      <Match when={p.type === 'info'}>
        <Icon name="information-circle" size={14} />
      </Match>
      <Match when={p.type === 'doc'}>
        <Icon name="document-text" size={14} />
      </Match>
      <Match when={p.type === 'link'}>
        <Icon name="link" size={14} />
      </Match>
      <Match when={p.type === 'calendar'}>
        <Icon name="calendar" size={14} />
      </Match>
      <Match when={p.type === 'smart_summary'}>
        <Icon name="sparkles" size={14} />
      </Match>
      <Match when={p.type === 'channel'}>
        <Icon name="chat-bubble" size={14} />
      </Match>
    </Switch>
  );
};

function widgetTypeLabel(t: ResolvedWidget['type']): string {
  if (t === 'kanban') return 'Kanban';
  if (t === 'checklist') return 'Liste';
  if (t === 'info') return 'Info';
  if (t === 'doc') return 'Doku';
  if (t === 'link') return 'Link';
  if (t === 'calendar') return 'Kalender';
  if (t === 'channel') return 'Channel';
  return 'Smart Summary';
}

function widgetStubHint(t: ResolvedWidget['type']): string {
  if (t === 'kanban') return 'Kanban-Board (Foundation — volles Wiring in Welle C).';
  if (t === 'checklist') return 'Checkliste (Foundation — volles Wiring in Welle C).';
  if (t === 'info') return 'Info-Felder (Foundation — volles Wiring in Welle C).';
  if (t === 'doc') return 'Doku (Foundation — volles Wiring in Welle C).';
  if (t === 'link') return 'Link (Foundation — volles Wiring in Welle C).';
  if (t === 'calendar') return 'Kalender (Foundation — volles Wiring in Welle C).';
  if (t === 'channel') return 'Channel-Bridge — verknuepfe einen Slack/Teams/Mail-Channel.';
  return 'Smart Summary (Foundation — Inhalt kommt in Welle F).';
}

export default TemplateWidgetRenderer;
