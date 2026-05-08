// Welle WV.B fortgesetzt — IconPicker-Modal.
//
// Modal-Picker fuer Heroicons-Symbole. V1: pure Heroicons-Grid mit
// Suche. Brand-SVG-Bundle (slack/notion/...) folgt im naechsten
// Sub-Sprint zusammen mit Service-Worker-Favicon-Cache.
//
// Konsumenten:
//   - NewTemplateModal (Welle WV.C.1) — Symbol-Picker statt Text-Input.
//   - SaveAsTemplateModal (Welle WV.C.2).
//   - Designer-Inspector (Welle WV.C.7 WYSIWYG-Editor V2).
//   - info_field-Symbol-Override (Welle WV.B fortgesetzt).
//   - link-Symbol-Override (Welle WV.B fortgesetzt).
//
// Pattern (analog AdapterDialog WV.WV.7): <dialog class="overlay-modal">
// + Backdrop-Closer + ESC + Submit-Adapter.

import { type Component, For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import Icon, { type IconName } from './Icon';

// Pflege-Liste aller Heroicon-Namen, die der IconPicker anbietet. Muss
// IconName-Union spiegeln — Erweiterung hier + in Icon.tsx parallel.
// Sortiert nach thematischen Gruppen damit der Picker visuell lesbar
// bleibt.
const PICKABLE_ICONS: ReadonlyArray<{ name: IconName; group: string; aliases?: string[] }> = [
  // Struktur
  { name: 'view-columns', group: 'Struktur', aliases: ['kanban', 'board'] },
  { name: 'squares-2x2', group: 'Struktur', aliases: ['matrix', 'grid'] },
  { name: 'list-bullet', group: 'Struktur', aliases: ['list', 'liste', 'checklist'] },
  { name: 'document-text', group: 'Struktur', aliases: ['doc', 'doku', 'text'] },
  { name: 'information-circle', group: 'Struktur', aliases: ['info'] },
  { name: 'sparkles', group: 'Struktur', aliases: ['summary', 'ai'] },
  { name: 'archive-box', group: 'Struktur', aliases: ['storage', 'box'] },
  // Aktion
  { name: 'plus', group: 'Aktion' },
  { name: 'minus', group: 'Aktion' },
  { name: 'pencil', group: 'Aktion', aliases: ['edit'] },
  { name: 'trash', group: 'Aktion', aliases: ['delete', 'loeschen'] },
  { name: 'arrow-path', group: 'Aktion', aliases: ['refresh', 'sync'] },
  { name: 'arrow-uturn-left', group: 'Aktion', aliases: ['undo', 'back'] },
  { name: 'arrow-down-tray', group: 'Aktion', aliases: ['download'] },
  { name: 'arrow-top-right-on-square', group: 'Aktion', aliases: ['external', 'open'] },
  // Status
  { name: 'check', group: 'Status' },
  { name: 'check-circle', group: 'Status', aliases: ['done'] },
  { name: 'x', group: 'Status' },
  { name: 'x-circle', group: 'Status' },
  { name: 'no-symbol', group: 'Status', aliases: ['blocked'] },
  { name: 'flag', group: 'Status', aliases: ['priority'] },
  { name: 'lock-closed', group: 'Status', aliases: ['security', 'private'] },
  { name: 'eye', group: 'Status', aliases: ['visible'] },
  { name: 'eye-slash', group: 'Status', aliases: ['hidden'] },
  // Daten
  { name: 'calendar', group: 'Daten', aliases: ['date'] },
  { name: 'clock', group: 'Daten', aliases: ['time'] },
  { name: 'tag', group: 'Daten' },
  { name: 'link', group: 'Daten', aliases: ['url'] },
  { name: 'envelope', group: 'Daten', aliases: ['mail', 'email'] },
  { name: 'phone', group: 'Daten', aliases: ['tel', 'whatsapp'] },
  { name: 'banknotes', group: 'Daten', aliases: ['money', 'currency'] },
  { name: 'calculator', group: 'Daten', aliases: ['number'] },
  { name: 'at-symbol', group: 'Daten', aliases: ['alias'] },
  { name: 'funnel', group: 'Daten', aliases: ['filter'] },
  // Provider (Brand-Distinct, Welle WV.B fortgesetzt)
  { name: 'cloud', group: 'Provider', aliases: ['drive', 'onedrive', 'dropbox', 'storage'] },
  { name: 'folder', group: 'Provider', aliases: ['filesystem', 'directory'] },
  { name: 'chat-bubble', group: 'Provider', aliases: ['slack', 'teams', 'discord', 'message'] },
  { name: 'paper-airplane', group: 'Provider', aliases: ['telegram', 'send'] },
  // System
  { name: 'cog', group: 'System', aliases: ['settings'] },
  { name: 'user', group: 'System' },
  { name: 'users', group: 'System', aliases: ['members'] },
  { name: 'shield-check', group: 'System', aliases: ['audit', 'security'] },
  { name: 'bell', group: 'System', aliases: ['notify', 'notification'] },
  { name: 'paint-brush', group: 'System', aliases: ['theme'] },
  { name: 'sun', group: 'System', aliases: ['light'] },
  { name: 'moon', group: 'System', aliases: ['dark'] },
];

const GROUP_ORDER = ['Struktur', 'Status', 'Daten', 'Provider', 'Aktion', 'System'];

export type IconPickerProps = {
  // Aktueller Wert (Heroicon-Name oder null fuer „kein Symbol").
  value: IconName | null;
  // Submit-Callback bei Auswahl. Caller schliesst das Modal.
  onSelect: (icon: IconName | null) => void;
  onClose: () => void;
  // Optional: Titel-Anpassung (z.B. „Symbol fuer Vorlage waehlen").
  title?: string;
  // Optional: erlaube „Kein Symbol"-Auswahl (Default: ja).
  allowClear?: boolean;
};

const IconPicker: Component<IconPickerProps> = (p) => {
  let dialogEl: HTMLDialogElement | undefined;
  const [query, setQuery] = createSignal('');

  onMount(() => {
    dialogEl?.showModal();
    const input = dialogEl?.querySelector<HTMLInputElement>('input[type="search"]');
    input?.focus();
  });
  onCleanup(() => {
    dialogEl?.close();
  });

  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase();
    if (!q) return PICKABLE_ICONS;
    return PICKABLE_ICONS.filter((i) => {
      if (i.name.includes(q)) return true;
      if (i.aliases?.some((a) => a.includes(q))) return true;
      if (i.group.toLowerCase().includes(q)) return true;
      return false;
    });
  });

  const grouped = createMemo<{ group: string; icons: typeof PICKABLE_ICONS }[]>(() => {
    const map = new Map<string, typeof PICKABLE_ICONS>();
    for (const icon of filtered()) {
      const arr = map.get(icon.group);
      if (arr) {
        (arr as { name: IconName; group: string; aliases?: string[] }[]).push(icon);
      } else {
        map.set(icon.group, [icon]);
      }
    }
    return GROUP_ORDER.filter((g) => map.has(g)).map((g) => ({
      group: g,
      icons: map.get(g) ?? [],
    }));
  });

  return (
    <dialog
      ref={(el) => {
        dialogEl = el;
      }}
      class="overlay-modal icon-picker-dialog"
      aria-labelledby="icon-picker-title"
      onCancel={(e) => {
        e.preventDefault();
        p.onClose();
      }}
    >
      <button
        type="button"
        class="overlay-modal-backdrop-closer"
        onClick={p.onClose}
        aria-label="Schliessen"
        tabIndex={-1}
      />
      <div class="overlay-card icon-picker-card">
        <header class="overlay-head">
          <h3 id="icon-picker-title">{p.title ?? 'Symbol waehlen'}</h3>
          <button type="button" class="overlay-close" onClick={p.onClose} aria-label="Schliessen">
            <Icon name="x" size={18} />
          </button>
        </header>

        <div class="icon-picker-body">
          <div class="icon-picker-search">
            <Icon name="search" size={14} />
            <input
              type="search"
              class="icon-picker-search-input"
              placeholder="Symbol suchen…"
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              aria-label="Symbole filtern"
              spellcheck={false}
              autocomplete="off"
            />
          </div>

          <Show when={p.allowClear !== false}>
            <button
              type="button"
              class="icon-picker-clear-btn"
              classList={{ active: p.value === null }}
              onClick={() => p.onSelect(null)}
            >
              <Icon name="no-symbol" size={14} />
              <span>Kein Symbol</span>
            </button>
          </Show>

          <div class="icon-picker-groups">
            <For each={grouped()}>
              {(g) => (
                <section class="icon-picker-group">
                  <h4 class="icon-picker-group-h">{g.group}</h4>
                  <div class="icon-picker-grid" aria-label={g.group}>
                    <For each={g.icons}>
                      {(icon) => (
                        <button
                          type="button"
                          class="icon-picker-cell"
                          classList={{ active: p.value === icon.name }}
                          onClick={() => p.onSelect(icon.name)}
                          aria-label={icon.name}
                          title={
                            icon.aliases ? `${icon.name} (${icon.aliases.join(', ')})` : icon.name
                          }
                          aria-pressed={p.value === icon.name}
                        >
                          <Icon name={icon.name} size={20} />
                          <span class="icon-picker-cell-label">{icon.name}</span>
                        </button>
                      )}
                    </For>
                  </div>
                </section>
              )}
            </For>
          </div>

          <Show when={grouped().length === 0}>
            <p class="icon-picker-empty">Kein Symbol passt zu „{query()}".</p>
          </Show>
        </div>
      </div>
    </dialog>
  );
};

export default IconPicker;
