// Generisches Context-Menu, portiert aus dem HTML-Vorbild `sbContextMenu`.
//
// Verwendung:
//   const [ctx, setCtx] = createSignal<CtxState | null>(null);
//   <ContextMenu state={ctx()} onClose={() => setCtx(null)} />
//
// Der Caller baut die Items. Positioniert wird am Maus-Event (x/y) oder
// relativ zum Target-Element (fallback wenn x/y fehlen — z.B. bei `+`-
// Shortcut ohne Mausposition).

import { For, Show, onCleanup, onMount, type Component } from 'solid-js';

export type CtxMenuItem = {
  label: string;
  icon?: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  divider?: boolean;
};

export type CtxMenuState = {
  x: number;
  y: number;
  items: CtxMenuItem[];
  // Header zeigt Breadcrumb / Kontext der Source-Row. Optional.
  headerLabel?: string;
  headerBadge?: string;
  // CSS-Klasse fuer die Source-Row, die das Menu aufgerufen hat.
  // Der Caller setzt sie vor dem Oeffnen, wir raeumen sie in onClose weg.
  sourceEl?: HTMLElement;
};

type Props = {
  state: CtxMenuState | null;
  onClose: () => void;
};

const ContextMenu: Component<Props> = (p) => {
  let menuRef: HTMLDivElement | undefined;

  // Source-Highlight: solange das Menu offen ist, traegt das Source-
  // Element die Klasse .ctx-menu-source. Raeumen wir beim Close auf.
  onMount(() => {
    if (p.state?.sourceEl) {
      p.state.sourceEl.classList.add('ctx-menu-source');
    }
  });
  onCleanup(() => {
    if (p.state?.sourceEl) {
      p.state.sourceEl.classList.remove('ctx-menu-source');
    }
  });

  // ESC im Capture-Phase, sonst schluckt der globale Back-Handler.
  //
  // WICHTIG: Guard auf p.state — die ContextMenu-Komponente bleibt
  // dauerhaft gemountet (sie wird vom Parent ohne <Show>-Gate gerendert
  // und haelt den Menu-Zustand via state-Prop). Ohne den Guard wuerde
  // *jedes* Escape unkonditionell stopImmediatePropagation ausloesen und
  // damit den globalen ESC-Handler (Parent-Nav) ausschalten. Zwei
  // ContextMenu-Instanzen (NodeTree + Workspace-Alias-Chip) verstaerken
  // das: 100% der ESC-Events werden geschluckt.
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (!p.state) return;
      e.stopImmediatePropagation();
      p.onClose();
    };
    document.addEventListener('keydown', onKey, true);
    onCleanup(() => document.removeEventListener('keydown', onKey, true));
  });

  // Outside-Click schliesst. mousedown statt click, damit der Klick
  // auf den Menu-Item nicht erst registriert und dann wieder wegfliegt.
  onMount(() => {
    const onDown = (e: MouseEvent) => {
      if (!menuRef) return;
      if (menuRef.contains(e.target as Node)) return;
      p.onClose();
    };
    document.addEventListener('mousedown', onDown, true);
    onCleanup(() => document.removeEventListener('mousedown', onDown, true));
  });

  // Sobald das Menu im DOM ist, berechnen wir die passende Position:
  // wenn rechts/unten nicht genug Platz ist, verschieben wir nach
  // oben/links. Die initiale Position basiert auf der Maus-Koordinate,
  // Korrektur hier via bounding-rect.
  onMount(() => {
    if (!menuRef || !p.state) return;
    requestAnimationFrame(() => {
      if (!menuRef) return;
      const rect = menuRef.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let x = p.state!.x;
      let y = p.state!.y;
      if (x + rect.width > vw - 8) x = Math.max(8, vw - rect.width - 8);
      if (y + rect.height > vh - 8) y = Math.max(8, vh - rect.height - 8);
      menuRef.style.left = `${x}px`;
      menuRef.style.top = `${y}px`;
    });
  });

  return (
    <Show when={p.state}>
      {(s) => (
        <div
          ref={menuRef}
          class="ctx-menu"
          role="menu"
          style={{ left: `${s().x}px`, top: `${s().y}px` }}
        >
          <Show when={s().headerLabel}>
            <div class="ctx-menu-head">
              <Show when={s().headerBadge}>
                <span class="ctx-menu-badge">{s().headerBadge}</span>
              </Show>
              <span class="ctx-menu-head-label">{s().headerLabel}</span>
            </div>
          </Show>
          <ul class="ctx-menu-list">
            <For each={s().items}>
              {(item) => (
                <>
                  <Show when={item.divider}>
                    <li class="ctx-menu-divider" aria-hidden="true" />
                  </Show>
                  <Show when={!item.divider}>
                    <li>
                      <button
                        type="button"
                        class="ctx-menu-btn"
                        classList={{ 'ctx-menu-btn-danger': !!item.danger }}
                        disabled={!!item.disabled}
                        onClick={() => {
                          item.onClick();
                          p.onClose();
                        }}
                        role="menuitem"
                      >
                        <Show when={item.icon}>
                          <span class="ctx-menu-ico" aria-hidden="true">
                            {item.icon}
                          </span>
                        </Show>
                        <span class="ctx-menu-label">{item.label}</span>
                      </button>
                    </li>
                  </Show>
                </>
              )}
            </For>
          </ul>
        </div>
      )}
    </Show>
  );
};

export default ContextMenu;
