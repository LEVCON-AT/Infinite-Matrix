// Cheat-Sheet fuer alle Tastatur-Shortcuts. Oeffnet via ? und schliesst
// via ESC. Liste ist handgepflegt — waechst mit neuen Shortcuts.

import { For, onCleanup, onMount, type Component } from 'solid-js';

type Props = {
  onClose: () => void;
};

type ShortcutEntry = {
  keys: string[]; // einzeln gerenderte <kbd>-Elemente
  desc: string;
};

type ShortcutSection = {
  title: string;
  entries: ShortcutEntry[];
};

const SECTIONS: ShortcutSection[] = [
  {
    title: 'Global',
    entries: [
      { keys: ['?'], desc: 'Diese Hilfe oeffnen/schliessen' },
      { keys: ['Ctrl+K'], desc: 'Alias-Quicknav (auch Cmd+K)' },
      { keys: ['^'], desc: 'Alias-Quicknav direkt' },
      { keys: ['/'], desc: 'Suche in Matrizen, Boards, Karten, Checklisten' },
      { keys: ['Shift+D'], desc: 'Dokumentations-Popup oeffnen' },
      { keys: ['Shift+P'], desc: 'Command-Palette (neue Karte, Clone, ...)' },
      { keys: ['Shift+N'], desc: 'Sidebar-Modus zyklen (full → rails → aus)' },
      { keys: ['Shift+E'], desc: 'Edit-Mode togglen' },
      { keys: ['Shift+A'], desc: 'Sidebar: alles aufklappen (sticky)' },
      { keys: ['Esc'], desc: 'Overlay schliessen / eine Ebene hoch' },
    ],
  },
  {
    title: 'Matrix',
    entries: [
      { keys: ['↑', '↓', '←', '→'], desc: 'Zwischen Zellen navigieren' },
      { keys: ['Enter'], desc: 'Zelle oeffnen (Edit-Mode) oder Sub-Node bei genau einem Target' },
      { keys: ['1', '2', '3', '4'], desc: 'Feature togglen (im Zell-Overlay)' },
      { keys: ['d'], desc: 'Doku-Popup fuer fokussierte Zelle (mit Quell-Alias)' },
    ],
  },
  {
    title: 'Checkliste',
    entries: [
      { keys: ['Enter'], desc: 'Neuer Punkt nach dieser Zeile' },
      { keys: ['Alt+→'], desc: 'Einruecken (mehr Tiefe)' },
      { keys: ['Alt+←'], desc: 'Ausruecken' },
    ],
  },
  {
    title: 'Eingabefelder',
    entries: [
      { keys: ['Enter'], desc: 'Uebernehmen (Blur)' },
      { keys: ['Esc'], desc: 'In der Quicknav: schliessen; im Filter: leeren' },
    ],
  },
];

const KeyboardHelp: Component<Props> = (p) => {
  // ESC capture — sonst schluckt die globale ESC-Nav das Event.
  onMount(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      p.onClose();
    };
    document.addEventListener('keydown', h, true);
    onCleanup(() => document.removeEventListener('keydown', h, true));
  });

  return (
    <div
      class="overlay-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) p.onClose();
      }}
    >
      <div
        class="overlay-card kb-help-card"
        role="dialog"
        aria-modal="true"
        aria-label="Tastatur-Shortcuts"
      >
        <header class="overlay-head">
          <h3>Tastatur-Shortcuts</h3>
          <button
            type="button"
            class="overlay-close"
            onClick={p.onClose}
            aria-label="Schliessen"
          >
            ✕
          </button>
        </header>
        <div class="overlay-body kb-help-body">
          <For each={SECTIONS}>
            {(section) => (
              <section class="kb-help-section">
                <h4>{section.title}</h4>
                <dl class="kb-help-list">
                  <For each={section.entries}>
                    {(entry) => (
                      <>
                        <dt class="kb-help-keys">
                          <For each={entry.keys}>
                            {(k, i) => (
                              <>
                                {i() > 0 && (
                                  <span class="kb-help-sep" aria-hidden>
                                    /
                                  </span>
                                )}
                                <kbd>{k}</kbd>
                              </>
                            )}
                          </For>
                        </dt>
                        <dd class="kb-help-desc">{entry.desc}</dd>
                      </>
                    )}
                  </For>
                </dl>
              </section>
            )}
          </For>
        </div>
      </div>
    </div>
  );
};

export default KeyboardHelp;
