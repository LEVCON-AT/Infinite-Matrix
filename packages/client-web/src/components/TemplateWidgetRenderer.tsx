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
import DriveWidget from './DriveWidget';
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
  // Welle WV.D.5.a — DriveWidget braucht cellId+workspaceId fuer den
  // „Datei verknuepfen"-Button (addCellAtomLink). Caller (CellTemplateRenderer)
  // gibt cell-Kontext weiter.
  cellId?: string;
  workspaceId?: string;
};

const TemplateWidgetRenderer: Component<TemplateWidgetRendererProps> = (p) => {
  return (
    <div
      class="template-widget"
      classList={{
        'template-widget-overridden': p.widget.hasOverride,
        'template-widget-edit-in-view': editInViewToggle(p.widget.toggles, p.widget.type),
      }}
      style={{
        '--widget-size-cols': p.widget.size_cols,
        '--widget-size-rows': p.widget.size_rows,
      }}
      data-widget-type={p.widget.type}
      data-edit-in-view={editInViewToggle(p.widget.toggles, p.widget.type) ? 'true' : 'false'}
      data-markers-star={markersToggles(p.widget.toggles).workspaceStar ? 'true' : 'false'}
      data-markers-eye={markersToggles(p.widget.toggles).privateEye ? 'true' : 'false'}
    >
      {/* §13.4 Header-Toggle (default true). Wenn aus: Header + Type-Badge
          + Reset-Button entfallen — z.B. fuer Hero-Doc-Embed ohne Chrome.
          Edit-Mode-Reset-Button geht im Off-Modus mit verloren — bewusst,
          User schaltet den Header zurueck-an wenn er das Widget anders
          konfigurieren will. */}
      <Show when={headerToggle(p.widget.toggles)}>
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
      </Show>
      <div class="template-widget-body">
        <Show
          when={sourceMode(p.widget.toggles) !== 'off'}
          fallback={
            <p class="template-widget-stub-hint">
              Datenquelle „aus" — Widget rendert leer (Designer/Toggles).
            </p>
          }
        >
          <Switch
            fallback={<p class="template-widget-stub-hint">{widgetStubHint(p.widget.type)}</p>}
          >
            <Match when={p.widget.type === 'channel'}>
              <ChannelWidget
                channel={p.channel ?? null}
                editMode={p.editMode}
                onPickChannel={p.onPickChannel}
              />
            </Match>
            <Match when={p.widget.type === 'drive'}>
              <DriveWidget
                channel={p.channel ?? null}
                editMode={p.editMode}
                onPickChannel={p.onPickChannel}
                cellId={p.cellId}
                workspaceId={p.workspaceId}
              />
            </Match>
          </Switch>
        </Show>
      </div>
      {/* §13.1 Comment-Channel-Toggle V1 — Stub-Section unter dem Widget.
          extern/native Render-Modus folgt in V2 (Channel-Bridge-Wiring
          fuer extern, atom_comments-Tabelle + Realtime fuer native). */}
      <Show when={commentsMode(p.widget.toggles) !== 'off'}>
        <section class="template-widget-comments-stub" data-mode={commentsMode(p.widget.toggles)}>
          <span class="template-widget-comments-icon" aria-hidden="true">
            <Icon name="chat-bubble" size={12} />
          </span>
          <span class="template-widget-comments-label">
            {commentsMode(p.widget.toggles) === 'extern'
              ? 'Kommentare extern (Provider folgt in V2)'
              : 'Kommentare nativ (atom_comments folgt in V2)'}
          </span>
        </section>
      </Show>
      {/* §13.2 Attachment-Source-Toggle V1 — Stub-Section unter dem Widget.
          cloud/native Render-Modus folgt in V2 (DriveProvider-Wiring fuer
          cloud, Supabase-Storage-Bucket fuer native). */}
      <Show when={attachmentsMode(p.widget.toggles) !== 'off'}>
        <section
          class="template-widget-attachments-stub"
          data-mode={attachmentsMode(p.widget.toggles)}
        >
          <span class="template-widget-attachments-icon" aria-hidden="true">
            <Icon name="archive-box" size={12} />
          </span>
          <span class="template-widget-attachments-label">
            {attachmentsMode(p.widget.toggles) === 'cloud'
              ? 'Anhaenge Cloud (Provider folgt in V2)'
              : 'Anhaenge nativ (Storage-Bucket folgt in V2)'}
          </span>
        </section>
      </Show>
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
      <Match when={p.type === 'drive'}>
        <Icon name="cloud" size={14} />
      </Match>
    </Switch>
  );
};

// Welle WV.D.8 — Source-Mode aus widget.toggles.source. Default 'extern'.
function sourceMode(toggles: Record<string, unknown>): 'extern' | 'native' | 'off' {
  const v = (toggles as { source?: string })?.source;
  if (v === 'native' || v === 'off') return v;
  return 'extern';
}

// §13.4 — Header-Toggle aus widget.toggles.header. Default true (Header
// sichtbar). Wenn explizit false gesetzt: Renderer skipped die Header-
// Section komplett (Hero-Embed-Pattern).
function headerToggle(toggles: Record<string, unknown>): boolean {
  const v = (toggles as { header?: unknown })?.header;
  if (v === false) return false;
  return true;
}

// §13.5 — edit_in_view-Toggle aus widget.toggles.edit_in_view. Default
// pro Widget-Type (siehe Konzept §13.5):
//   task-list / kanban / checklist  → true  (Inline-Edit natural)
//   info / doc / link / calendar / smart_summary / channel / drive → false
// Caller-Code wertet das via classList aus (.template-widget-edit-in-view)
// oder via data-edit-in-view-Attribut. V1: nur am Wrapper exponiert,
// Sub-Renderer (BoardView / ChecklistPanel / Channel / Drive) konsumieren
// es noch nicht — Inline-Edit-Pfad bleibt heute Edit-Mode-gated. V2:
// Sub-Renderer lesen den Toggle und schalten Edit-Affordances unabhaengig
// vom Cell-Edit-Mode frei.
function editInViewToggle(toggles: Record<string, unknown>, type: ResolvedWidget['type']): boolean {
  const v = (toggles as { edit_in_view?: unknown })?.edit_in_view;
  if (typeof v === 'boolean') return v;
  // Default per Widget-Type.
  return type === 'kanban' || type === 'checklist';
}

// §13.3 — Marker-Toggles (workspace_star + private_eye). Defaults beide
// true (Marker-Bar sichtbar). Wenn ein Toggle explizit false: die zugehoerige
// Marker-Funktion wird im Widget unterdrueckt. V1 expose-only — der Helper
// + die data-markers-*-Attribute am Wrapper sind heute fuer Sub-Renderer
// lesbar; aktuell rendert keiner der Marker-Caller (BoardView /
// CardOverlay / ChecklistPanel / DocsPopup / TaskDetail / ImportedEventDetail)
// innerhalb des TemplateWidgetRenderer-Dispatchers, deshalb hat das Flag
// heute keine sichtbare Wirkung. Wiring kommt mit Welle C, wenn Cells
// ihre Render-Definition aus cell_template_instances ziehen und die
// AtomMarkerBar-Calls die data-Attribute auswerten koennen.
function markersToggles(toggles: Record<string, unknown>): {
  workspaceStar: boolean;
  privateEye: boolean;
} {
  const m = (toggles as { markers?: { workspace_star?: unknown; private_eye?: unknown } })?.markers;
  return {
    workspaceStar: m?.workspace_star !== false,
    privateEye: m?.private_eye !== false,
  };
}

// §13.1 — Comment-Channel-Toggle. Default 'off'. extern = Channel-Bridge-
// Provider, native = atom_comments-Tabelle. V1 expose-only (Stub-Section
// im Renderer + 3-state-Radio im Inspector); volles Wiring V2.
function commentsMode(toggles: Record<string, unknown>): 'off' | 'extern' | 'native' {
  const c = (toggles as { comments?: { mode?: string } })?.comments;
  const v = c?.mode;
  if (v === 'extern' || v === 'native') return v;
  return 'off';
}

// §13.2 — Attachment-Source-Toggle. Default 'off'. cloud = DriveProvider,
// native = Supabase-Storage-Bucket. V1 expose-only; volles Wiring V2.
function attachmentsMode(toggles: Record<string, unknown>): 'off' | 'cloud' | 'native' {
  const a = (toggles as { attachments?: { mode?: string } })?.attachments;
  const v = a?.mode;
  if (v === 'cloud' || v === 'native') return v;
  return 'off';
}

function widgetTypeLabel(t: ResolvedWidget['type']): string {
  if (t === 'kanban') return 'Kanban';
  if (t === 'checklist') return 'Liste';
  if (t === 'info') return 'Info';
  if (t === 'doc') return 'Doku';
  if (t === 'link') return 'Link';
  if (t === 'calendar') return 'Kalender';
  if (t === 'channel') return 'Channel';
  if (t === 'drive') return 'Drive';
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
  if (t === 'drive') return 'Drive-Bridge — verknuepfe einen Cloud-Drive-Folder.';
  return 'Smart Summary (Foundation — Inhalt kommt in Welle F).';
}

export default TemplateWidgetRenderer;
