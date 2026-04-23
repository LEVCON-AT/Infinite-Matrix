// Dokumentations-Popup mit Tab-Bar. Jeder Tab = eine Doku (pending
// oder persisted). Eintritt: Shift+D (leerer Tab mit heutigem Datum)
// oder ^alias einer bestehenden Doku (als aktiver Tab).
//
// Persistenz-Flow:
//   - Neuer Tab startet "pending" (kein docId)
//   - Erste nicht-leere Blur auf title/content/alias -> createDoc ->
//     Tab wird persisted, docId gemerkt
//   - Danach: blur-save pro Feld (setDocTitle/Content/Alias)
//   - Alias wird clientseitig cross-table validiert vor dem Write
//
// Anti-Race: Realtime-Update fuer den gerade fokussierten Tab wird
// NICHT in den Draft gemerged (wie NodeDescription) — sonst reisst es
// laufende Tippers den Text weg.

import {
  For,
  Show,
  batch,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
  type Component,
} from 'solid-js';
import type { DocRow } from '../lib/types';
import { fetchDocById, fetchDocsRecent } from '../lib/queries';
import {
  createDoc,
  delDoc,
  restoreDoc,
  setDocAlias,
  setDocContent,
  setDocTitle,
} from '../lib/mutations';
import { validateAlias } from '../lib/alias';
import { showToast, showUndoToast } from '../lib/toasts';
import { translateDbError } from '../lib/errors';
import { clearDocsRequest, type OpenDocsRequest } from '../lib/docs-ui';

type Props = {
  workspaceId: string;
  request: OpenDocsRequest | null;
  realtimeVersion: number;
  onClose: () => void;
};

type Tab = {
  // null solange pending (kein DB-Row). Wird beim ersten erfolgreichen
  // createDoc gesetzt.
  docId: string | null;
  title: string;
  content: string;
  alias: string;
  sourceAlias: string | null;
  attachedCellId: string | null;
  // Dirty-Flag: gibt es ungesaettigte Aenderungen? Bei Close-Popup
  // koennte man darueber warnen — aktuell aber: blur speichert schon,
  // also sollte dirty immer false sein, wenn der User das Popup zumacht.
  dirty: boolean;
};

function todayDE(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${dd}.${mm}.${yyyy}`;
}

function defaultTitle(sourceAlias: string | null): string {
  if (sourceAlias) return `^${sourceAlias} · ${todayDE()}`;
  return todayDE();
}

function tabFromRow(row: DocRow): Tab {
  return {
    docId: row.id,
    title: row.title,
    content: row.content,
    alias: row.alias ?? '',
    sourceAlias: row.source_alias,
    attachedCellId: row.attached_cell_id,
    dirty: false,
  };
}

const DocsPopup: Component<Props> = (p) => {
  const [tabs, setTabs] = createSignal<Tab[]>([]);
  const [activeIdx, setActiveIdx] = createSignal(0);
  const [busy, setBusy] = createSignal(false);
  let titleRef: HTMLInputElement | undefined;
  let contentRef: HTMLTextAreaElement | undefined;
  let aliasRef: HTMLInputElement | undefined;

  // Focus-Restore (wie andere Modals).
  let prevFocus: HTMLElement | null = null;

  // Recent-Liste — kann nach Insert/Update/Delete der offenen Tabs
  // veraltet sein. Wir refetchen bei jeder Top-Level-Aktion.
  const [recent, { refetch: refetchRecent }] = createResource(
    () => p.workspaceId,
    async (wid) => (wid ? fetchDocsRecent(wid, 20) : []),
  );

  // Realtime: bei bump im Workspace-Channel (docs-Tabelle) Recent neu
  // laden. Der gerade fokussierte Tab wird dadurch NICHT ueberschrieben,
  // weil patchActive nur im Blur-Pfad laeuft — Realtime bumps triggern
  // ausschliesslich den Resource-Refetch.
  createEffect(() => {
    void p.realtimeVersion;
    void refetchRecent();
  });

  // Fuegt einen Tab an die Liste an oder aktiviert den existierenden.
  function openTab(tab: Tab) {
    batch(() => {
      const current = tabs();
      const existing = tab.docId
        ? current.findIndex((t) => t.docId === tab.docId)
        : -1;
      if (existing >= 0) {
        setActiveIdx(existing);
      } else {
        const next = [...current, tab];
        setTabs(next);
        setActiveIdx(next.length - 1);
      }
    });
  }

  function newPendingTab(sourceAlias: string | null = null, attachedCellId: string | null = null): Tab {
    return {
      docId: null,
      title: defaultTitle(sourceAlias),
      content: '',
      alias: '',
      sourceAlias,
      attachedCellId,
      dirty: false,
    };
  }

  // Bei Popup-Mount: entweder initialDocId laden oder leeren Pending-Tab
  // anlegen. Die Request-Props stammen aus Workspace via Shared-Signal.
  onMount(async () => {
    prevFocus = document.activeElement as HTMLElement | null;
    const req = p.request;
    if (req?.initialDocId) {
      try {
        const row = await fetchDocById(req.initialDocId, p.workspaceId);
        if (row) {
          setTabs([tabFromRow(row)]);
          setActiveIdx(0);
        } else {
          showToast('Doku nicht gefunden.', 'error');
          setTabs([newPendingTab(req.sourceAlias ?? null, req.attachedCellId ?? null)]);
        }
      } catch (err) {
        showToast(translateDbError(err), 'error');
        setTabs([newPendingTab(req.sourceAlias ?? null, req.attachedCellId ?? null)]);
      }
    } else {
      setTabs([newPendingTab(req?.sourceAlias ?? null, req?.attachedCellId ?? null)]);
    }
    // Title-Fokus: Feld ist pre-filled mit heutigem Datum — User kann
    // sofort mit Tab weiter zu content oder das Datum ueberschreiben.
    setTimeout(() => titleRef?.select?.(), 0);
  });

  onCleanup(() => {
    clearDocsRequest();
    prevFocus?.focus?.();
  });

  // Reagiere auf neue Requests, waehrend das Popup bereits offen ist
  // (z.B. ^docalias in einem anderen UI-Element geklickt). Jede Request
  // mit initialDocId oeffnet oder aktiviert einen Tab dafuer.
  createEffect(() => {
    const req = p.request;
    if (!req) return;
    // Erst nach Mount (tabs bereits initialisiert)
    if (tabs().length === 0) return;
    if (req.initialDocId) {
      void (async () => {
        try {
          const row = await fetchDocById(req.initialDocId as string, p.workspaceId);
          if (!row) return;
          openTab(tabFromRow(row));
        } catch {
          /* silent — ein evtl. Fehler ist schon beim initial-load gemeldet */
        }
      })();
    }
  });

  // ESC schliesst (Capture-Phase, sonst greift der globale Back-Handler).
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      p.onClose();
    };
    document.addEventListener('keydown', onKey, true);
    onCleanup(() => document.removeEventListener('keydown', onKey, true));
  });

  const activeTab = createMemo<Tab | undefined>(() => tabs()[activeIdx()]);

  // Generic: aktive Tab-Aenderung an Index anwenden.
  function patchActive(patch: Partial<Tab>) {
    const idx = activeIdx();
    setTabs((prev) => {
      const next = prev.slice();
      const cur = next[idx];
      if (!cur) return prev;
      next[idx] = { ...cur, ...patch };
      return next;
    });
  }

  // Persist-Helper: legt bei Bedarf einen neuen Doc an und schreibt
  // das geaenderte Feld. Returns true on success; false on error.
  async function persistField(
    field: 'title' | 'content' | 'alias',
    value: string,
  ): Promise<boolean> {
    const t = activeTab();
    if (!t) return false;
    if (busy()) return false;
    setBusy(true);
    try {
      if (!t.docId) {
        // Pending → createDoc mit aktuellen Feldwerten. Dann wird die
        // Aenderung "automatisch" mit angelegt.
        const created = await createDoc({
          workspaceId: p.workspaceId,
          title: field === 'title' ? value : t.title,
          content: field === 'content' ? value : t.content,
          alias: field === 'alias'
            ? value.trim() ? value.trim() : null
            : t.alias.trim() ? t.alias.trim() : null,
          source_alias: t.sourceAlias,
          attached_cell_id: t.attachedCellId,
        });
        patchActive({
          docId: created.id,
          title: created.title,
          content: created.content,
          alias: created.alias ?? '',
          dirty: false,
        });
        void refetchRecent();
        return true;
      }
      // Persisted → gezieltes Feld-Update.
      let row: DocRow;
      if (field === 'title') row = await setDocTitle(t.docId, value);
      else if (field === 'content') row = await setDocContent(t.docId, value);
      else row = await setDocAlias(t.docId, value.trim() ? value.trim() : null);
      patchActive({
        title: row.title,
        content: row.content,
        alias: row.alias ?? '',
        dirty: false,
      });
      void refetchRecent();
      return true;
    } catch (err) {
      showToast(translateDbError(err), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function onTitleBlur(val: string) {
    const t = activeTab();
    if (!t) return;
    // Leeren Titel zulassen — DB hat DEFAULT ''. Kein Persist-Skip.
    if (val === t.title && t.docId) return; // persisted, nichts geaendert
    if (val === t.title && !t.docId && val === '' && !t.content) return; // pending, voellig leer
    await persistField('title', val);
  }

  async function onContentBlur(val: string) {
    const t = activeTab();
    if (!t) return;
    if (val === t.content && t.docId) return;
    if (val === t.content && !t.docId && !val && !t.title) return;
    await persistField('content', val);
  }

  async function onAliasBlur(val: string) {
    const t = activeTab();
    if (!t) return;
    const cleaned = val.trim().toLowerCase();
    if (cleaned === t.alias) return;
    // Cross-Table-Validation. Bei Pending-Doc: id-Ausschluss leer
    // (noch kein DB-Row), findAliasConflict erkennt dann alle
    // anderen Treffer als Konflikt. Bei Persisted: eigene id excluden.
    const v = await validateAlias(
      cleaned || null,
      p.workspaceId,
      { type: 'doc', id: t.docId ?? '00000000-0000-0000-0000-000000000000' },
    );
    if (!v.ok) {
      showToast(v.msg, 'error');
      // Draft zurueck auf alten Wert setzen, damit das Input korrekt
      // rendert.
      patchActive({ alias: t.alias });
      aliasRef?.focus?.();
      return;
    }
    await persistField('alias', v.canonical ?? '');
  }

  function onNewTab() {
    const t = newPendingTab();
    setTabs((prev) => [...prev, t]);
    setActiveIdx(tabs().length - 1);
    setTimeout(() => titleRef?.select?.(), 0);
  }

  function onCloseTab(idx: number) {
    const next = tabs().slice();
    next.splice(idx, 1);
    if (next.length === 0) {
      // Keine Tabs mehr → Popup schliessen.
      p.onClose();
      return;
    }
    setTabs(next);
    // activeIdx ggf. nachziehen
    if (activeIdx() >= next.length) setActiveIdx(next.length - 1);
    else if (idx <= activeIdx() && activeIdx() > 0) setActiveIdx(activeIdx() - 1);
  }

  async function onDeleteActiveDoc() {
    const t = activeTab();
    if (!t || !t.docId) {
      // Pending → einfach Tab wegwerfen, keine DB-Row zum Loeschen.
      onCloseTab(activeIdx());
      return;
    }
    if (!window.confirm(`Doku "${t.title || '(ohne Titel)'}" loeschen?`)) return;
    const snap: DocRow = {
      id: t.docId,
      workspace_id: p.workspaceId,
      alias: t.alias || null,
      title: t.title,
      content: t.content,
      source_alias: t.sourceAlias,
      attached_cell_id: t.attachedCellId,
      created_at: '',
      updated_at: '',
    };
    try {
      await delDoc(t.docId);
      onCloseTab(activeIdx());
      void refetchRecent();
      showUndoToast(`Doku "${snap.title || '(ohne Titel)'}" geloescht.`, () => {
        void (async () => {
          try {
            await restoreDoc(snap);
            void refetchRecent();
            showToast('Doku wiederhergestellt.', 'success');
          } catch (err) {
            showToast(translateDbError(err), 'error');
          }
        })();
      });
    } catch (err) {
      showToast(translateDbError(err), 'error');
    }
  }

  async function openRecent(row: DocRow) {
    openTab(tabFromRow(row));
  }

  return (
    <div
      class="overlay-scrim docs-popup-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) p.onClose();
      }}
    >
      <div
        class="overlay-card docs-popup-card"
        role="dialog"
        aria-label="Dokumentation"
      >
        <header class="docs-popup-head">
          <div class="docs-popup-tabs" role="tablist">
            <For each={tabs()}>
              {(t, i) => {
                const isActive = () => i() === activeIdx();
                const label = () => t.title?.trim() || '(neu)';
                return (
                  <div
                    class="docs-popup-tab"
                    classList={{ 'docs-popup-tab-active': isActive() }}
                    role="tab"
                    aria-selected={isActive()}
                    onClick={() => setActiveIdx(i())}
                  >
                    <span class="docs-popup-tab-title" title={label()}>
                      {label()}
                    </span>
                    <button
                      type="button"
                      class="docs-popup-tab-close"
                      title="Tab schliessen"
                      aria-label="Tab schliessen"
                      onClick={(e) => {
                        e.stopPropagation();
                        onCloseTab(i());
                      }}
                    >
                      ×
                    </button>
                  </div>
                );
              }}
            </For>
            <button
              type="button"
              class="docs-popup-tab-add"
              title="Neuer Tab"
              aria-label="Neuer Tab"
              onClick={onNewTab}
            >
              +
            </button>
          </div>
          <button
            type="button"
            class="overlay-close"
            onClick={p.onClose}
            aria-label="Schliessen"
          >
            ✕
          </button>
        </header>

        <Show when={activeTab()}>
          {(t) => (
            <div class="docs-popup-body">
              <div class="docs-popup-editor">
                <div class="docs-popup-meta-row">
                  <input
                    ref={titleRef}
                    class="docs-popup-title"
                    type="text"
                    value={t().title}
                    placeholder={todayDE()}
                    onInput={(e) => patchActive({ title: e.currentTarget.value })}
                    onBlur={(e) => onTitleBlur(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        (e.currentTarget as HTMLInputElement).blur();
                      }
                    }}
                  />
                  <input
                    ref={aliasRef}
                    class="docs-popup-alias"
                    type="text"
                    value={t().alias}
                    placeholder="^alias (optional)"
                    maxLength={8}
                    onInput={(e) => patchActive({ alias: e.currentTarget.value })}
                    onBlur={(e) => onAliasBlur(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        (e.currentTarget as HTMLInputElement).blur();
                      }
                    }}
                  />
                  <Show when={t().sourceAlias}>
                    <span
                      class="docs-popup-source-chip"
                      title="Quelle dieser Doku"
                    >
                      via ^{t().sourceAlias}
                    </span>
                  </Show>
                  <button
                    type="button"
                    class="mx-del-btn docs-popup-del"
                    title="Doku loeschen"
                    aria-label="Doku loeschen"
                    onClick={onDeleteActiveDoc}
                    disabled={busy()}
                  >
                    ✕
                  </button>
                </div>
                <textarea
                  ref={contentRef}
                  class="docs-popup-content"
                  value={t().content}
                  placeholder="Markdown: **bold**, *italic*, `code`, http-Links. Leerzeile = Absatz."
                  onInput={(e) => patchActive({ content: e.currentTarget.value })}
                  onBlur={(e) => onContentBlur(e.currentTarget.value)}
                />
              </div>

              <aside class="docs-popup-sidebar">
                <h4 class="docs-popup-sidebar-title">Zuletzt</h4>
                <Show
                  when={(recent() ?? []).length > 0}
                  fallback={<p class="hint">Noch keine Dokus.</p>}
                >
                  <ul class="docs-popup-recent-list">
                    <For each={recent() ?? []}>
                      {(row) => {
                        const isOpenTab = () =>
                          tabs().some((tb) => tb.docId === row.id);
                        return (
                          <li
                            class="docs-popup-recent-item"
                            classList={{
                              'docs-popup-recent-active': isOpenTab(),
                            }}
                            onClick={() => openRecent(row)}
                          >
                            <div class="docs-popup-recent-title">
                              {row.title || '(ohne Titel)'}
                              <Show when={row.alias}>
                                <span class="docs-popup-recent-alias">
                                  ^{row.alias}
                                </span>
                              </Show>
                            </div>
                            <Show when={row.content}>
                              <div class="docs-popup-recent-preview">
                                {row.content.slice(0, 80)}
                              </div>
                            </Show>
                          </li>
                        );
                      }}
                    </For>
                  </ul>
                </Show>
              </aside>
            </div>
          )}
        </Show>
      </div>
    </div>
  );
};

export default DocsPopup;
