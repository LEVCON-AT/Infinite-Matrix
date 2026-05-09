// Welle WV.C.7 — WYSIWYG-Layout-Editor V1-Minimal (Konzept §7.3).
//
// Sub-Route `/w/:workspaceId/templates/edit/:templateId`. V1-Scope:
// - Sections-Liste mit Widgets nested (linke Spalte).
// - Widget-Inspector mit Size + Title + Toggles (rechte Spalte).
// - Action-Buttons: + Section / + Widget / Up/Down-Reorder / Delete.
// - Inline-Edit Section-Titel + Vorlagen-Name.
// - layout_version-Bump bei strukturellen Aenderungen
//   (add/delete/reorder section/widget).
//
// V2-deferred (per Konzept §7.3 V2-Komplettausbau):
// - Drag-and-Drop Reorder (V1: ↑↓ Buttons).
// - Widget-Palette als Sidebar.
// - Visual-Snap-to-Grid mit Live-Preview.
// - Diff-Preview vor Vorlage-Update.
// - Versions-History.
// - Multi-User-OT/CRDT (Soft-Lock via Live-Cursor V2).
// - Mobile-Editor (Touch-DnD).

import { A, useNavigate, useParams } from '@solidjs/router';
import { For, Show, createMemo, createResource, createSignal, onCleanup } from 'solid-js';
import Icon, { type IconName } from '../components/Icon';
import IconPicker from '../components/IconPicker';
import { translateDbError } from '../lib/errors';
import {
  type AddTemplateSectionInput,
  type AddTemplateWidgetInput,
  addTemplateSection,
  addTemplateWidget,
  deleteTemplateSection,
  deleteTemplateWidget,
  fetchFeatureTemplatesForWorkspace,
  fetchTemplateSectionsForWorkspace,
  fetchTemplateWidgetsForWorkspace,
  nextTemplateSectionPosition,
  nextTemplateWidgetPosition,
  setTemplateRootWidget,
  updateFeatureTemplate,
  updateTemplateSection,
  updateTemplateWidget,
} from '../lib/templates';
import { showToast, showUndoToast } from '../lib/toasts';
import type {
  FeatureTemplateRow,
  TemplateSectionRow,
  TemplateWidgetRow,
  TemplateWidgetType,
} from '../lib/types';
import { bindAliasAutocomplete } from '../lib/use-alias-autocomplete';

const WIDGET_TYPES: { type: TemplateWidgetType; label: string; icon: IconName }[] = [
  { type: 'kanban', label: 'Kanban-Board', icon: 'view-columns' },
  { type: 'checklist', label: 'Checkliste', icon: 'list-bullet' },
  { type: 'info', label: 'Info-Felder', icon: 'information-circle' },
  { type: 'doc', label: 'Doku', icon: 'document-text' },
  { type: 'link', label: 'Link', icon: 'link' },
  { type: 'calendar', label: 'Kalender', icon: 'calendar' },
  { type: 'smart_summary', label: 'Smart Summary', icon: 'sparkles' },
];

const TemplateDesigner = () => {
  const params = useParams<{ workspaceId: string; templateId: string }>();
  const navigate = useNavigate();

  const [templates, { refetch: refetchTemplates }] = createResource(
    () => params.workspaceId,
    async (wsId) => (wsId ? await fetchFeatureTemplatesForWorkspace(wsId) : []),
  );
  const [sections, { refetch: refetchSections }] = createResource(
    () => params.workspaceId,
    async (wsId) => (wsId ? await fetchTemplateSectionsForWorkspace(wsId) : []),
  );
  const [widgets, { refetch: refetchWidgets }] = createResource(
    () => params.workspaceId,
    async (wsId) => (wsId ? await fetchTemplateWidgetsForWorkspace(wsId) : []),
  );

  const refetchAll = () => {
    void refetchTemplates();
    void refetchSections();
    void refetchWidgets();
  };

  const template = createMemo<FeatureTemplateRow | null>(
    () => templates()?.find((t) => t.id === params.templateId) ?? null,
  );

  const isPlatform = () => template()?.visibility === 'platform';

  // Sections + Widgets der aktuellen Vorlage, sortiert.
  const tplSections = createMemo<TemplateSectionRow[]>(() =>
    (sections() ?? [])
      .filter((s) => s.template_id === params.templateId)
      .slice()
      .sort((a, b) => a.position - b.position),
  );

  const widgetsBySection = createMemo<Map<string, TemplateWidgetRow[]>>(() => {
    const map = new Map<string, TemplateWidgetRow[]>();
    const tplSectionIds = new Set(tplSections().map((s) => s.id));
    for (const w of widgets() ?? []) {
      if (!tplSectionIds.has(w.section_id)) continue;
      const arr = map.get(w.section_id);
      if (arr) arr.push(w);
      else map.set(w.section_id, [w]);
    }
    for (const [_id, arr] of map) {
      arr.sort((a, b) => a.position - b.position);
    }
    return map;
  });

  const [selectedWidgetId, setSelectedWidgetId] = createSignal<string | null>(null);
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const [busy, setBusy] = createSignal(false);

  const selectedWidget = createMemo<TemplateWidgetRow | null>(() => {
    const id = selectedWidgetId();
    if (!id) return null;
    return (widgets() ?? []).find((w) => w.id === id) ?? null;
  });

  // ─── Mutations + Layout-Version-Bump ─────────────────────────

  async function bumpLayoutVersion(): Promise<void> {
    const tpl = template();
    if (!tpl) return;
    try {
      await updateFeatureTemplate(tpl.id, { layout_version: tpl.layout_version + 1 });
    } catch (err) {
      console.error('bumpLayoutVersion:', err);
    }
  }

  async function withBusy<T>(fn: () => Promise<T>): Promise<T | null> {
    if (busy()) return null;
    setBusy(true);
    try {
      return await fn();
    } finally {
      setBusy(false);
    }
  }

  async function handleAddSection(): Promise<void> {
    const tpl = template();
    if (!tpl) return;
    await withBusy(async () => {
      const input: AddTemplateSectionInput = {
        workspaceId: params.workspaceId,
        templateId: tpl.id,
        position: nextTemplateSectionPosition(tpl.id, sections() ?? []),
        title: null,
        defaultCollapsed: false,
        visibility: 'always',
      };
      try {
        await addTemplateSection(input);
        await bumpLayoutVersion();
        refetchAll();
        showToast('Sektion angelegt.', 'success');
      } catch (err) {
        showToast(translateDbError(err, 'Sektion konnte nicht angelegt werden.'), 'error');
      }
    });
  }

  async function handleAddWidget(sectionId: string, type: TemplateWidgetType): Promise<void> {
    const tpl = template();
    if (!tpl) return;
    await withBusy(async () => {
      const input: AddTemplateWidgetInput = {
        workspaceId: params.workspaceId,
        sectionId,
        column: 1,
        position: nextTemplateWidgetPosition(sectionId, widgets() ?? []),
        type,
        sizeCols: 12,
        sizeRows: 6,
        data: {},
        toggles: {},
        config: {},
      };
      try {
        const widget = await addTemplateWidget(input);
        // Wenn die Vorlage noch kein root_widget hat → automatisch
        // setzen (Atomic-Drop-Default).
        if (!tpl.root_widget_id) {
          await setTemplateRootWidget(tpl.id, widget.id);
        }
        await bumpLayoutVersion();
        setSelectedWidgetId(widget.id);
        refetchAll();
        showToast(`Widget „${type}" angelegt.`, 'success');
      } catch (err) {
        showToast(translateDbError(err, 'Widget konnte nicht angelegt werden.'), 'error');
      }
    });
  }

  async function handleDeleteSection(section: TemplateSectionRow): Promise<void> {
    if (!window.confirm(`Sektion „${section.title ?? 'ohne Titel'}" mit allen Widgets loeschen?`)) {
      return;
    }
    await withBusy(async () => {
      try {
        await deleteTemplateSection(section.id);
        await bumpLayoutVersion();
        refetchAll();
        showUndoToast('Sektion geloescht', () => {
          // Restore: re-add Section (Widgets sind via FK weg, nicht
          // restoreable V1).
          void addTemplateSection({
            workspaceId: params.workspaceId,
            templateId: section.template_id,
            position: section.position,
            title: section.title,
            defaultCollapsed: section.default_collapsed,
            visibility: section.visibility,
          })
            .then(() => refetchAll())
            .catch((err) => {
              console.error('undo deleteSection:', err);
              showToast(translateDbError(err, 'Undo fehlgeschlagen.'), 'error');
            });
        });
      } catch (err) {
        showToast(translateDbError(err, 'Sektion konnte nicht geloescht werden.'), 'error');
      }
    });
  }

  async function handleDeleteWidget(widget: TemplateWidgetRow): Promise<void> {
    if (!window.confirm('Widget loeschen? Cell-Overrides gehen via Cascade verloren.')) return;
    await withBusy(async () => {
      try {
        await deleteTemplateWidget(widget.id);
        await bumpLayoutVersion();
        if (selectedWidgetId() === widget.id) setSelectedWidgetId(null);
        refetchAll();
        showUndoToast('Widget geloescht', () => {
          void addTemplateWidget({
            workspaceId: params.workspaceId,
            sectionId: widget.section_id,
            column: widget.column,
            position: widget.position,
            type: widget.type,
            sizeCols: widget.size_cols,
            sizeRows: widget.size_rows,
            data: widget.data,
            toggles: widget.toggles,
            config: widget.config,
          })
            .then(() => refetchAll())
            .catch((err) => {
              console.error('undo deleteWidget:', err);
              showToast(translateDbError(err, 'Undo fehlgeschlagen.'), 'error');
            });
        });
      } catch (err) {
        showToast(translateDbError(err, 'Widget konnte nicht geloescht werden.'), 'error');
      }
    });
  }

  async function moveSection(section: TemplateSectionRow, delta: -1 | 1): Promise<void> {
    const list = tplSections();
    const idx = list.findIndex((s) => s.id === section.id);
    const target = list[idx + delta];
    if (!target) return;
    await withBusy(async () => {
      try {
        await updateTemplateSection(section.id, { position: target.position });
        await updateTemplateSection(target.id, { position: section.position });
        await bumpLayoutVersion();
        refetchAll();
      } catch (err) {
        showToast(translateDbError(err, 'Reorder fehlgeschlagen.'), 'error');
      }
    });
  }

  async function moveWidget(widget: TemplateWidgetRow, delta: -1 | 1): Promise<void> {
    const list = widgetsBySection().get(widget.section_id) ?? [];
    const idx = list.findIndex((w) => w.id === widget.id);
    const target = list[idx + delta];
    if (!target) return;
    await withBusy(async () => {
      try {
        await updateTemplateWidget(widget.id, { position: target.position });
        await updateTemplateWidget(target.id, { position: widget.position });
        await bumpLayoutVersion();
        refetchAll();
      } catch (err) {
        showToast(translateDbError(err, 'Reorder fehlgeschlagen.'), 'error');
      }
    });
  }

  async function handleSectionTitleChange(
    section: TemplateSectionRow,
    title: string,
  ): Promise<void> {
    const trim = title.trim();
    if (trim === (section.title ?? '')) return;
    try {
      await updateTemplateSection(section.id, { title: trim || null });
      // Title-Aenderung ist NICHT strukturell — kein layout_version-Bump.
      refetchAll();
    } catch (err) {
      showToast(translateDbError(err, 'Sektion konnte nicht umbenannt werden.'), 'error');
    }
  }

  async function handleTemplateRename(name: string): Promise<void> {
    const tpl = template();
    if (!tpl) return;
    const trim = name.trim();
    if (!trim || trim === tpl.name) return;
    try {
      await updateFeatureTemplate(tpl.id, { name: trim });
      refetchAll();
    } catch (err) {
      showToast(translateDbError(err, 'Vorlage konnte nicht umbenannt werden.'), 'error');
    }
  }

  async function handleTemplateSymbolChange(symbol: string | null): Promise<void> {
    const tpl = template();
    if (!tpl) return;
    try {
      await updateFeatureTemplate(tpl.id, { symbol });
      refetchAll();
    } catch (err) {
      showToast(translateDbError(err, 'Symbol konnte nicht gesetzt werden.'), 'error');
    }
  }

  // ─── Render ──────────────────────────────────────────────────

  return (
    <div class="designer-shell">
      <header class="designer-shell-head">
        <A
          href={`/w/${params.workspaceId}/templates`}
          class="settings-back"
          aria-label="Zurueck zur Vorlagen-Liste"
        >
          <Icon name="arrow-left" size={16} />
          <span>Vorlagen</span>
        </A>
        <Show when={template()} fallback={<h1 class="settings-title">Designer (laedt…)</h1>}>
          {(tpl) => (
            <div class="designer-head-title">
              <button
                type="button"
                class="symbol-picker-trigger designer-head-symbol"
                onClick={() => setPickerOpen(true)}
                disabled={isPlatform()}
                aria-label="Symbol waehlen"
              >
                <span class="symbol-picker-trigger-icon">
                  <Show
                    when={tpl().symbol && KNOWN_ICONS.has(tpl().symbol as IconName)}
                    fallback={<Icon name="document-text" size={18} />}
                  >
                    <Icon name={tpl().symbol as IconName} size={18} />
                  </Show>
                </span>
              </button>
              <input
                class="designer-head-name-input"
                value={tpl().name}
                ref={(el) => {
                  // §14.6 Coverage-Pflicht: ^kuerzel-Autocomplete in
                  // Vorlagen-Name (z.B. „^kunde-acme Kanban").
                  const cleanup = bindAliasAutocomplete(el, params.workspaceId);
                  onCleanup(cleanup);
                }}
                onChange={(e) => void handleTemplateRename(e.currentTarget.value)}
                disabled={isPlatform()}
                aria-label="Vorlagen-Name"
              />
              <span class={`template-visibility-badge v-${tpl().visibility}`}>
                {visibilityLabel(tpl().visibility)}
              </span>
              <span class="designer-head-version">v{tpl().layout_version}</span>
            </div>
          )}
        </Show>
      </header>

      <Show when={isPlatform()}>
        <div class="designer-platform-banner">
          Plattform-Vorlage — nur lesbar. Aenderungen via Plattform-Admin oder „Duplizieren".
        </div>
      </Show>

      <div class="designer-body">
        <main class="designer-main">
          <Show when={!templates.loading} fallback={<p class="templates-loading">Laedt…</p>}>
            <Show
              when={template()}
              fallback={
                <div class="templates-empty">
                  <Icon name="x-circle" size={28} />
                  <p>Vorlage nicht gefunden.</p>
                  <button
                    type="button"
                    class="btn-subtle"
                    onClick={() => navigate(`/w/${params.workspaceId}/templates`)}
                  >
                    Zurueck zur Liste
                  </button>
                </div>
              }
            >
              <For each={tplSections()}>
                {(section, sIdx) => (
                  <section class="designer-section">
                    <header class="designer-section-head">
                      <input
                        class="designer-section-title-input"
                        value={section.title ?? ''}
                        placeholder={`Sektion ${sIdx() + 1}`}
                        ref={(el) => {
                          // §14.6: ^kuerzel auch in Sektions-Titeln (Token
                          // koexistiert mit Pattern-Tokens wie {row.label}).
                          const cleanup = bindAliasAutocomplete(el, params.workspaceId);
                          onCleanup(cleanup);
                        }}
                        onChange={(e) =>
                          void handleSectionTitleChange(section, e.currentTarget.value)
                        }
                        disabled={isPlatform()}
                      />
                      <div class="designer-section-actions">
                        <button
                          type="button"
                          class="btn-subtle"
                          disabled={isPlatform() || sIdx() === 0 || busy()}
                          onClick={() => void moveSection(section, -1)}
                          aria-label="Hoch"
                          title="Hoch"
                        >
                          <Icon name="arrow-up" size={12} />
                        </button>
                        <button
                          type="button"
                          class="btn-subtle"
                          disabled={isPlatform() || sIdx() === tplSections().length - 1 || busy()}
                          onClick={() => void moveSection(section, 1)}
                          aria-label="Runter"
                          title="Runter"
                        >
                          <Icon name="arrow-down" size={12} />
                        </button>
                        <button
                          type="button"
                          class="btn-danger-subtle"
                          disabled={isPlatform() || busy()}
                          onClick={() => void handleDeleteSection(section)}
                          aria-label="Sektion loeschen"
                          title="Sektion loeschen"
                        >
                          <Icon name="trash" size={12} />
                        </button>
                      </div>
                    </header>
                    <div class="designer-widgets">
                      <For each={widgetsBySection().get(section.id) ?? []}>
                        {(widget, wIdx) => {
                          const def = WIDGET_TYPES.find((t) => t.type === widget.type);
                          return (
                            <div
                              class="designer-widget"
                              classList={{ active: selectedWidgetId() === widget.id }}
                              data-widget-type={widget.type}
                            >
                              <button
                                type="button"
                                class="designer-widget-select"
                                onClick={() => setSelectedWidgetId(widget.id)}
                                aria-pressed={selectedWidgetId() === widget.id}
                                aria-label={`Widget ${def?.label ?? widget.type} auswaehlen`}
                              >
                                <span class="designer-widget-icon">
                                  <Icon name={def?.icon ?? 'document-text'} size={16} />
                                </span>
                                <div class="designer-widget-info">
                                  <span class="designer-widget-type">
                                    {def?.label ?? widget.type}
                                  </span>
                                  <span class="designer-widget-size">
                                    {widget.size_cols} × {widget.size_rows}
                                  </span>
                                </div>
                              </button>
                              <div class="designer-widget-actions">
                                <button
                                  type="button"
                                  class="btn-subtle"
                                  disabled={isPlatform() || wIdx() === 0 || busy()}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void moveWidget(widget, -1);
                                  }}
                                  aria-label="Hoch"
                                  title="Hoch"
                                >
                                  <Icon name="arrow-up" size={10} />
                                </button>
                                <button
                                  type="button"
                                  class="btn-subtle"
                                  disabled={
                                    isPlatform() ||
                                    wIdx() ===
                                      (widgetsBySection().get(section.id) ?? []).length - 1 ||
                                    busy()
                                  }
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void moveWidget(widget, 1);
                                  }}
                                  aria-label="Runter"
                                  title="Runter"
                                >
                                  <Icon name="arrow-down" size={10} />
                                </button>
                                <button
                                  type="button"
                                  class="btn-danger-subtle"
                                  disabled={isPlatform() || busy()}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleDeleteWidget(widget);
                                  }}
                                  aria-label="Widget loeschen"
                                  title="Widget loeschen"
                                >
                                  <Icon name="trash" size={10} />
                                </button>
                              </div>
                            </div>
                          );
                        }}
                      </For>
                      <Show when={!isPlatform()}>
                        <WidgetTypePicker
                          onPick={(type) => void handleAddWidget(section.id, type)}
                          disabled={busy()}
                        />
                      </Show>
                    </div>
                  </section>
                )}
              </For>

              <Show when={!isPlatform()}>
                <button
                  type="button"
                  class="designer-add-section"
                  onClick={() => void handleAddSection()}
                  disabled={busy()}
                >
                  <Icon name="plus" size={14} />
                  <span>+ Sektion</span>
                </button>
              </Show>
            </Show>
          </Show>
        </main>

        <aside class="designer-inspector" aria-label="Widget-Inspector">
          <Show
            when={selectedWidget()}
            fallback={
              <div class="designer-inspector-empty">
                <Icon name="cog" size={28} />
                <p>Widget waehlen, um Eigenschaften zu editieren.</p>
              </div>
            }
          >
            {(w) => (
              <WidgetInspector
                widget={w()}
                workspaceId={params.workspaceId}
                disabled={isPlatform() || busy()}
                onPatch={async (patch) => {
                  try {
                    await updateTemplateWidget(w().id, patch);
                    // Size-Aenderungen sind strukturell, Toggles + data
                    // sind nicht — V1 bumpen wir nur bei size-Aenderungen.
                    if ('size_cols' in patch || 'size_rows' in patch) {
                      await bumpLayoutVersion();
                    }
                    refetchAll();
                  } catch (err) {
                    showToast(
                      translateDbError(err, 'Widget konnte nicht aktualisiert werden.'),
                      'error',
                    );
                  }
                }}
              />
            )}
          </Show>
        </aside>
      </div>

      <Show when={pickerOpen() && template()}>
        <IconPicker
          value={(template()?.symbol as IconName | null | undefined) ?? null}
          onSelect={(icon) => {
            void handleTemplateSymbolChange(icon);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
          title={`Symbol fuer „${template()?.name ?? ''}"`}
        />
      </Show>
    </div>
  );
};

// ─── Sub-Komponenten ──────────────────────────────────────────

const WidgetTypePicker = (p: {
  onPick: (type: TemplateWidgetType) => void;
  disabled?: boolean;
}) => {
  const [open, setOpen] = createSignal(false);
  return (
    <div class="designer-widget-type-picker">
      <button
        type="button"
        class="designer-add-widget"
        onClick={() => setOpen(!open())}
        disabled={p.disabled}
      >
        <Icon name="plus" size={12} />
        <span>+ Widget</span>
      </button>
      <Show when={open()}>
        <div class="designer-widget-type-list" role="menu">
          <For each={WIDGET_TYPES}>
            {(t) => (
              <button
                type="button"
                class="designer-widget-type-option"
                role="menuitem"
                onClick={() => {
                  p.onPick(t.type);
                  setOpen(false);
                }}
              >
                <Icon name={t.icon} size={14} />
                <span>{t.label}</span>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

const WidgetInspector = (p: {
  widget: TemplateWidgetRow;
  workspaceId: string;
  disabled?: boolean;
  onPatch: (patch: Partial<TemplateWidgetRow>) => void | Promise<void>;
}) => {
  const def = () => WIDGET_TYPES.find((t) => t.type === p.widget.type);
  const config = () => p.widget.config as { titleTemplate?: string; description?: string };

  return (
    <div class="designer-inspector-body">
      <header class="designer-inspector-head">
        <span class="designer-widget-icon">
          <Icon name={def()?.icon ?? 'document-text'} size={18} />
        </span>
        <span class="designer-inspector-title">{def()?.label ?? p.widget.type}</span>
      </header>

      <div class="designer-inspector-field">
        <label for="inspector-cols" class="designer-inspector-label">
          Breite (Cols)
        </label>
        <input
          id="inspector-cols"
          type="number"
          min={1}
          max={12}
          class="adapter-dialog-input"
          value={p.widget.size_cols}
          disabled={p.disabled}
          onChange={(e) => {
            const v = Number(e.currentTarget.value);
            if (Number.isInteger(v) && v >= 1 && v <= 12) {
              void p.onPatch({ size_cols: v });
            }
          }}
        />
      </div>

      <div class="designer-inspector-field">
        <label for="inspector-rows" class="designer-inspector-label">
          Hoehe (Rows)
        </label>
        <input
          id="inspector-rows"
          type="number"
          min={1}
          max={24}
          class="adapter-dialog-input"
          value={p.widget.size_rows}
          disabled={p.disabled}
          onChange={(e) => {
            const v = Number(e.currentTarget.value);
            if (Number.isInteger(v) && v >= 1 && v <= 24) {
              void p.onPatch({ size_rows: v });
            }
          }}
        />
      </div>

      <div class="designer-inspector-field">
        <label for="inspector-title" class="designer-inspector-label">
          Title-Template
        </label>
        <input
          id="inspector-title"
          type="text"
          class="adapter-dialog-input"
          value={config().titleTemplate ?? ''}
          placeholder="z.B. {row.label} — Aufgaben"
          disabled={p.disabled}
          ref={(el) => {
            // §14.6: Konzept-explizit „`{vorlage}-{row}-{col}` und `^kuerzel`
            // koexistieren". Pattern-Tokens (geschweifte Klammern) und
            // Aliases (^) leben nebeneinander, der Resolver entscheidet pro
            // Token.
            const cleanup = bindAliasAutocomplete(el, p.workspaceId);
            onCleanup(cleanup);
          }}
          onChange={(e) =>
            void p.onPatch({
              config: { ...p.widget.config, titleTemplate: e.currentTarget.value || undefined },
            })
          }
        />
        <span class="adapter-dialog-field-hint">
          Tokens werden im Render aufgeloest (Welle WV.D Channel-Bridges).
        </span>
      </div>

      <div class="designer-inspector-field">
        <label for="inspector-desc" class="designer-inspector-label">
          Beschreibung
        </label>
        <textarea
          id="inspector-desc"
          class="adapter-dialog-input adapter-dialog-textarea"
          rows={2}
          value={config().description ?? ''}
          disabled={p.disabled}
          ref={(el) => {
            // §14.6: Beschreibung erlaubt Aliases als Anker auf Atome /
            // Cells / Objects.
            const cleanup = bindAliasAutocomplete(el, p.workspaceId);
            onCleanup(cleanup);
          }}
          onChange={(e) =>
            void p.onPatch({
              config: { ...p.widget.config, description: e.currentTarget.value || undefined },
            })
          }
        />
      </div>

      {/* Welle WV.D.8 — Source-Toggle „extern / native / off". Konzept §14.7
          Default-Direktive: extern. Channel/Drive/OneNote-Widgets nutzen
          Channel-Bridge wenn extern; native (V2) nutzt Atom-Foundation;
          off blendet das Widget aus. */}
      <fieldset class="designer-inspector-field designer-source-fieldset">
        <legend class="designer-inspector-label">Datenquelle</legend>
        <div class="designer-source-toggle">
          <For each={['extern', 'native', 'off'] as const}>
            {(mode) => {
              const active = () =>
                ((p.widget.toggles as { source?: string })?.source ?? 'extern') === mode;
              return (
                <label
                  class="designer-source-toggle-btn"
                  classList={{ 'designer-source-toggle-btn-active': active() }}
                >
                  <input
                    type="radio"
                    name="source-mode"
                    value={mode}
                    checked={active()}
                    disabled={p.disabled}
                    onChange={() =>
                      void p.onPatch({
                        toggles: { ...(p.widget.toggles ?? {}), source: mode },
                      })
                    }
                  />
                  <span>{mode === 'extern' ? 'extern' : mode === 'native' ? 'nativ' : 'aus'}</span>
                </label>
              );
            }}
          </For>
        </div>
        <span class="adapter-dialog-field-hint">
          extern = Channel-Bridge (Default). nativ = Welle-WV.B-Atome (V2). aus = Widget rendert
          leer.
        </span>
      </fieldset>

      {/* Welle WV.E #37 — Auto-Calendar-Toggle fuer Form-Widgets.
          Wenn ein info_field mit value_type='date' im Widget liegt,
          erzeugt Migration 082 automatisch eine Calendar-Manifestation
          pro Cell. Default true. V1 expose-only — der Calendar-Renderer
          honoriert den Toggle in der Folge-Welle (V1.5: cell -> template_widget
          -> toggle-Filter). Bis dahin: Trigger immer aktiv, Manual-Delete
          per Toast geblockt (lib/atom-manifestations.ts). */}
      <Show when={p.widget.type === 'info'}>
        <div class="designer-inspector-field">
          <label class="designer-inspector-label">
            <input
              type="checkbox"
              checked={
                ((p.widget.toggles as { date_field_auto_calendar?: boolean })
                  ?.date_field_auto_calendar ?? true) === true
              }
              disabled={p.disabled}
              onChange={(e) =>
                void p.onPatch({
                  toggles: {
                    ...(p.widget.toggles ?? {}),
                    date_field_auto_calendar: e.currentTarget.checked,
                  },
                })
              }
            />
            <span>Datums-Felder automatisch im Kalender</span>
          </label>
          <span class="adapter-dialog-field-hint">
            Date-Info-Felder erzeugen automatisch einen Kalender-Eintrag in der Cell. (Renderer-
            Filter folgt — V1 schreibt nur die User-Praeferenz, Trigger laufen unabhaengig.)
          </span>
        </div>
      </Show>

      <details class="designer-inspector-toggles">
        <summary>Toggles ({Object.keys(p.widget.toggles).length})</summary>
        <p class="adapter-dialog-field-hint">
          Weitere Toggle-Editor (comments/attachments/marker/header/edit_in_view) folgen.
        </p>
      </details>
    </div>
  );
};

function visibilityLabel(v: 'platform' | 'workspace' | 'user'): string {
  if (v === 'platform') return 'Plattform';
  if (v === 'workspace') return 'Workspace';
  return 'Privat';
}

const KNOWN_ICONS = new Set<IconName>([
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

export default TemplateDesigner;
