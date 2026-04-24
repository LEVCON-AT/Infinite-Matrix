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
import { useNavigate } from '@solidjs/router';
import type { DocRow } from '../lib/types';
import { fetchDocById, fetchDocsRecent } from '../lib/queries';
import {
  createDoc,
  delDoc,
  restoreDoc,
  setDocAlias,
  setDocAttachedCell,
  setDocContent,
  setDocTitle,
} from '../lib/mutations';
import { validateAlias } from '../lib/alias';
import { showToast, showUndoToast } from '../lib/toasts';
import { translateDbError } from '../lib/errors';
import { clearDocsRequest, type OpenDocsRequest } from '../lib/docs-ui';
import { resolveAlias } from '../lib/alias-resolve';
import { dispatchAliasResult } from '../lib/alias-dispatch';
import { supabase } from '../lib/supabase';
import MarkdownLightView from './MarkdownLightView';
import { bindAliasAutocomplete } from '../lib/use-alias-autocomplete';
import { getPersistedTabIds, persistTabIds } from '../lib/docs-tab-restore';
import {
  getDrafts,
  newClientId,
  persistDrafts,
  removeDraft,
  type Draft,
} from '../lib/docs-drafts';
import Icon from './Icon';

type Props = {
  workspaceId: string;
  request: OpenDocsRequest | null;
  realtimeVersion: number;
  onClose: () => void;
};

type TabMode = 'view' | 'edit';

type Tab = {
  // null solange pending (kein DB-Row). Wird beim ersten erfolgreichen
  // createDoc gesetzt.
  docId: string | null;
  // Stabiler Identifier fuer Draft-Round-Trip: erlaubt, einen Pending-
  // Tab nach Crash/Close wiederzufinden, ohne dass wir ihn mit einem
  // anderen Draft verwechseln.
  clientId: string;
  title: string;
  content: string;
  alias: string;
  sourceAlias: string | null;
  attachedCellId: string | null;
  // Display-Alias der angehaengten Zelle — Snapshot, aufgeloest beim
  // Tab-Load oder nach Attach-Blur. Leer wenn nicht attached oder die
  // Zelle hat keinen Alias (dann sieht der User "(Zelle)" als Hinweis).
  attachedCellAlias: string | null;
  // View/Edit-Umschaltung pro Tab. Default: 'edit' bei leerem Content,
  // 'view' wenn Content beim Tab-Oeffnen vorhanden. Klick auf den
  // View-Bereich wechselt zu 'edit'; Toggle-Button im Meta-Row macht
  // beides manuell.
  mode: TabMode;
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

// Kompaktes Alias-Default "YYMMDD" — 6 Zeichen, passt in den 8-
// Zeichen-Alias-Limit. Bei Mehrfach-Docs am selben Tag muss der User
// selbst einen Suffix ergaenzen (z.B. "260423a") — Collision-Toast
// weist beim Blur darauf hin.
function todayAliasCompact(): string {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

function defaultTitle(sourceAlias: string | null): string {
  if (sourceAlias) return `^${sourceAlias} · ${todayDE()}`;
  return todayDE();
}

function tabFromRow(row: DocRow): Tab {
  return {
    docId: row.id,
    clientId: newClientId(),
    title: row.title,
    content: row.content,
    alias: row.alias ?? '',
    sourceAlias: row.source_alias,
    attachedCellId: row.attached_cell_id,
    attachedCellAlias: null, // wird asynchron nachgezogen
    mode: row.content.trim().length > 0 ? 'view' : 'edit',
    dirty: false,
  };
}

function tabFromDraft(d: Draft): Tab {
  return {
    docId: null,
    clientId: d.clientId,
    title: d.title,
    content: d.content,
    alias: d.alias,
    sourceAlias: d.sourceAlias,
    attachedCellId: d.attachedCellId,
    attachedCellAlias: null,
    // Drafts starten in Edit — der User hatte vor dem Crash getippt,
    // will also weiterarbeiten, nicht nur lesen.
    mode: 'edit',
    dirty: false,
  };
}

// Lookup der Zell-Alias fuer Display. Silent fail (bei Permission/FK-
// Fehler wird attachedCellAlias=null belassen).
async function lookupCellAlias(
  cellId: string,
  workspaceId: string,
): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('cells')
      .select('alias')
      .eq('id', cellId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    return (data as { alias: string | null } | null)?.alias ?? null;
  } catch {
    return null;
  }
}

const DocsPopup: Component<Props> = (p) => {
  const navigate = useNavigate();
  const [tabs, setTabs] = createSignal<Tab[]>([]);
  const [activeIdx, setActiveIdx] = createSignal(0);
  const [busy, setBusy] = createSignal(false);
  // Separater Draft fuer die Zellen-Anhaenge-Eingabe, damit der
  // Input-Inhalt unabhaengig vom cached attachedCellAlias editierbar
  // bleibt. Bei Tab-Wechsel wird der Draft auf den neuen Tab.alias
  // zurueckgesetzt.
  const [attachDraft, setAttachDraft] = createSignal('');
  let titleRef: HTMLInputElement | undefined;
  let contentRef: HTMLTextAreaElement | undefined;
  let aliasRef: HTMLInputElement | undefined;
  let attachRef: HTMLInputElement | undefined;

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
      clientId: newClientId(),
      title: defaultTitle(sourceAlias),
      content: '',
      alias: todayAliasCompact(),
      sourceAlias,
      attachedCellId,
      attachedCellAlias: null,
      mode: 'edit',
      dirty: false,
    };
  }

  // Tab ist "empty" wenn alles auf Default steht — wird nicht als
  // Draft persistiert (sonst wuerde jeder blanke Shift+D einen
  // Draft erzeugen).
  function isTabEmpty(t: Tab): boolean {
    return (
      t.docId === null &&
      t.title === defaultTitle(t.sourceAlias) &&
      t.content === '' &&
      t.alias === todayAliasCompact() &&
      !t.attachedCellId
    );
  }

  // Async-Resolver fuer attachedCellAlias eines Tabs. Wird nach
  // tabFromRow() oder nach Attach-Blur gerufen. Gated auf attachedCellId-
  // Stabilitaet: wenn der User in der Zwischenzeit die Zelle getauscht
  // hat, wird kein Wert geschrieben.
  async function resolveAttachedAlias(idx: number, cellId: string) {
    const aliasStr = await lookupCellAlias(cellId, p.workspaceId);
    setTabs((prev) => {
      const next = prev.slice();
      const cur = next[idx];
      if (!cur) return prev;
      if (cur.attachedCellId !== cellId) return prev;
      next[idx] = { ...cur, attachedCellAlias: aliasStr };
      return next;
    });
  }

  function resolveAllAttachedAliases() {
    const cur = tabs();
    for (let i = 0; i < cur.length; i++) {
      const t = cur[i];
      if (t.attachedCellId && t.attachedCellAlias === null) {
        void resolveAttachedAlias(i, t.attachedCellId);
      }
    }
  }

  // Bei Popup-Mount: persisted Tabs (aus localStorage) laden, offene
  // Drafts als Pending-Tabs anhaengen, dann ggf. initialDocId als
  // aktiven Tab aktivieren oder anhaengen. Wenn nichts geladen wird:
  // leerer Pending-Tab.
  onMount(async () => {
    prevFocus = document.activeElement as HTMLElement | null;
    const req = p.request;
    const persisted = getPersistedTabIds(p.workspaceId);
    const drafts = getDrafts(p.workspaceId);

    const loaded: Tab[] = [];
    for (const id of persisted) {
      try {
        const row = await fetchDocById(id, p.workspaceId);
        if (row) loaded.push(tabFromRow(row));
      } catch {
        // Stale-Eintrag oder Permission-Error — still skippen,
        // naechster persist raeumt auf.
      }
    }

    // Drafts hinten anhaengen. Reihenfolge aus dem Draft-Array bleibt
    // erhalten; das ist die Reihenfolge, in der der User sie zuletzt
    // bearbeitet hatte (Save schreibt die Liste komplett).
    for (const d of drafts) {
      loaded.push(tabFromDraft(d));
    }

    let activeIdxAfter = 0;
    if (req?.initialDocId) {
      const existingIdx = loaded.findIndex((t) => t.docId === req.initialDocId);
      if (existingIdx >= 0) {
        activeIdxAfter = existingIdx;
      } else {
        try {
          const row = await fetchDocById(req.initialDocId, p.workspaceId);
          if (row) {
            loaded.push(tabFromRow(row));
            activeIdxAfter = loaded.length - 1;
          } else {
            showToast('Doku nicht gefunden.', 'error');
          }
        } catch (err) {
          showToast(translateDbError(err), 'error');
        }
      }
    }

    if (loaded.length === 0) {
      loaded.push(
        newPendingTab(req?.sourceAlias ?? null, req?.attachedCellId ?? null),
      );
    }

    setTabs(loaded);
    setActiveIdx(activeIdxAfter);
    resolveAllAttachedAliases();
    // Title-Fokus: Feld ist pre-filled mit heutigem Datum — User kann
    // sofort mit Tab weiter zu content oder das Datum ueberschreiben.
    setTimeout(() => titleRef?.select?.(), 0);
  });

  // Separates Signal fuer die Draft-Liste — damit die Sidebar
  // reaktiv auf Draft-Updates zeigen kann (inkl. Drafts, die nicht
  // mehr als Tab offen sind). Wird beim Mount initial geladen und
  // vom Persist-Effect nach jedem tabs()-Update neu geschrieben.
  const [draftsList, setDraftsList] = createSignal<Draft[]>([]);

  // Bei jeder Tab-Aenderung persistieren:
  //   - docIds  -> matrix.docs.tabs.<wsId>   (Tab-Restore)
  //   - Drafts  -> matrix.docs.drafts.<wsId> (Crash-Safe-Entwuerfe)
  //
  // Drafts-Merge (wichtig!): der Effect ueberschreibt NICHT einfach
  // die Draft-Liste mit den aktuellen Tab-Drafts. Sonst wuerde ein
  // Close-Tab (×) den Draft loeschen — der User soll Drafts aber
  // bewusst via Sidebar-Loesch-Button wegwerfen, nicht nebenbei.
  // Stattdessen: aktuelle Tab-Drafts ueberschreiben die bestehenden
  // Eintraege gleicher clientId; neue kommen dazu; fehlende bleiben.
  createEffect(() => {
    const current = tabs();
    const ids = current
      .map((t) => t.docId)
      .filter((id): id is string => id !== null);
    persistTabIds(p.workspaceId, ids);

    const now = Date.now();
    const tabDrafts = new Map<string, Draft>();
    for (const t of current) {
      if (t.docId !== null) continue;
      if (isTabEmpty(t)) continue;
      tabDrafts.set(t.clientId, {
        clientId: t.clientId,
        title: t.title,
        content: t.content,
        alias: t.alias,
        sourceAlias: t.sourceAlias,
        attachedCellId: t.attachedCellId,
        updatedAt: now,
      });
    }

    const existing = getDrafts(p.workspaceId);
    const merged: Draft[] = [];
    const seen = new Set<string>();
    for (const d of existing) {
      const updated = tabDrafts.get(d.clientId);
      merged.push(updated ?? d);
      seen.add(d.clientId);
    }
    for (const [cid, d] of tabDrafts) {
      if (!seen.has(cid)) merged.push(d);
    }
    persistDrafts(p.workspaceId, merged);
    setDraftsList(merged);
  });

  function onDeleteDraft(clientId: string) {
    removeDraft(p.workspaceId, clientId);
    setDraftsList(getDrafts(p.workspaceId));
    // Falls der Draft als Tab offen ist: auch den Tab schliessen.
    setTabs((prev) => prev.filter((t) => !(t.docId === null && t.clientId === clientId)));
    // activeIdx nach Entfernen ggf. nachziehen
    const len = tabs().length;
    if (len === 0) p.onClose();
    else if (activeIdx() >= len) setActiveIdx(len - 1);
  }

  function onOpenDraft(d: Draft) {
    const current = tabs();
    const existingIdx = current.findIndex(
      (t) => t.docId === null && t.clientId === d.clientId,
    );
    if (existingIdx >= 0) {
      setActiveIdx(existingIdx);
      return;
    }
    const next = [...current, tabFromDraft(d)];
    setTabs(next);
    setActiveIdx(next.length - 1);
  }

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
          resolveAllAttachedAliases();
        } catch {
          /* silent — ein evtl. Fehler ist schon beim initial-load gemeldet */
        }
      })();
    }
  });

  // Bei Tab-Wechsel: attachDraft auf den Display-Alias des neuen Tabs
  // setzen. Aber nur wenn der User nicht gerade im Attach-Input tippt —
  // sonst rissen wir den laufenden Text weg.
  createEffect(() => {
    const idx = activeIdx();
    const t = tabs()[idx];
    if (!t) return;
    if (document.activeElement === attachRef) return;
    setAttachDraft(t.attachedCellAlias ?? '');
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
        // Draft ist jetzt materialisiert — localStorage-Eintrag kann
        // weg. Ohne diese Zeile wuerde der Draft in der Sidebar
        // weiter auftauchen, obwohl er als Doc in der DB lebt.
        removeDraft(p.workspaceId, t.clientId);
        setDraftsList(getDrafts(p.workspaceId));
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
    if (cleaned === t.alias && t.docId) return; // persisted, unchanged
    // Leerer Alias: direkt persist (null) — Default wird gedroppt.
    if (!cleaned) {
      if (t.docId) await persistField('alias', '');
      else patchActive({ alias: '' });
      return;
    }
    // Cross-Table-Validation. Bei Pending-Doc: id-Ausschluss leer
    // (noch kein DB-Row), findAliasConflict erkennt dann alle
    // anderen Treffer als Konflikt. Bei Persisted: eigene id excluden.
    const v = await validateAlias(
      cleaned,
      p.workspaceId,
      { type: 'doc', id: t.docId ?? '00000000-0000-0000-0000-000000000000' },
    );
    if (!v.ok) {
      showToast(v.msg, 'error');
      // Alias-Input leeren, damit der User nicht im Collision-Loop
      // landet (Default-YYMMDD ueberall gleich → ohne Reset wuerde
      // der User beim 2. Doc am selben Tag immer wieder denselben
      // Collision-Toast bekommen). User kann manuell Suffix anhaengen.
      patchActive({ alias: '' });
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
    // Nach dem setTabs-Batch den lookup fuer den neuen Tab triggern.
    resolveAllAttachedAliases();
  }

  // Source-Chip-Klick: Popup schliessen, zum Quell-Alias navigieren.
  // Snapshot — Ziel kann gelöscht oder umbenannt sein; Toast bei Fehler.
  async function onSourceClick() {
    const t = activeTab();
    const alias = t?.sourceAlias;
    if (!alias) return;
    try {
      const res = await resolveAlias(alias, p.workspaceId);
      if (!res.ok) {
        showToast(`Quelle ^${alias} nicht gefunden.`, 'error');
        return;
      }
      dispatchAliasResult(res.result, {
        workspaceId: p.workspaceId,
        navigate,
        onError: (msg) => showToast(msg, 'error'),
      });
      p.onClose();
    } catch (err) {
      showToast(translateDbError(err), 'error');
    }
  }

  // Attach/Detach: User tippt einen Zellen-Alias (oder leer fuer Loesen).
  // Resolver muss kind='cell' liefern, sonst freundlich abbrechen.
  async function onAttachBlur(val: string) {
    const idx = activeIdx();
    const t = tabs()[idx];
    if (!t) return;
    const cleaned = val.trim().replace(/^\^+/, '').toLowerCase();
    const currentAlias = (t.attachedCellAlias ?? '').toLowerCase();
    if (cleaned === currentAlias) return; // nichts geaendert
    if (!cleaned) {
      // Detach
      if (t.docId && t.attachedCellId) {
        try {
          await setDocAttachedCell(t.docId, null);
        } catch (err) {
          showToast(translateDbError(err), 'error');
          setAttachDraft(t.attachedCellAlias ?? '');
          return;
        }
      }
      patchActive({ attachedCellId: null, attachedCellAlias: null });
      setAttachDraft('');
      return;
    }
    // Resolve
    let res;
    try {
      res = await resolveAlias(cleaned, p.workspaceId);
    } catch (err) {
      showToast(translateDbError(err), 'error');
      setAttachDraft(t.attachedCellAlias ?? '');
      return;
    }
    if (!res.ok) {
      showToast(res.msg, 'error');
      setAttachDraft(t.attachedCellAlias ?? '');
      return;
    }
    if (res.result.kind !== 'cell') {
      showToast('Nur Zellen koennen als Anhang dienen.', 'error');
      setAttachDraft(t.attachedCellAlias ?? '');
      return;
    }
    const cellId = res.result.cellId;
    if (t.docId) {
      try {
        await setDocAttachedCell(t.docId, cellId);
      } catch (err) {
        showToast(translateDbError(err), 'error');
        setAttachDraft(t.attachedCellAlias ?? '');
        return;
      }
    }
    patchActive({ attachedCellId: cellId, attachedCellAlias: cleaned });
    setAttachDraft(cleaned);
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
            <Icon name="x" size={18} />
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
                    <button
                      type="button"
                      class="docs-popup-source-chip"
                      title={`Zum Quell-Alias ^${t().sourceAlias} springen`}
                      onClick={onSourceClick}
                    >
                      via ^{t().sourceAlias}
                    </button>
                  </Show>
                  <button
                    type="button"
                    class="btn-subtle docs-popup-mode-toggle"
                    onClick={() =>
                      patchActive({
                        mode: t().mode === 'view' ? 'edit' : 'view',
                      })
                    }
                    disabled={t().content.trim().length === 0}
                    title={
                      t().mode === 'edit'
                        ? 'Vorschau anzeigen'
                        : 'Bearbeiten'
                    }
                  >
                    {t().mode === 'edit' ? 'Vorschau' : 'Bearbeiten'}
                  </button>
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
                <div class="docs-popup-attach-row">
                  <span class="docs-popup-attach-label">An Zelle:</span>
                  <input
                    ref={attachRef}
                    class="docs-popup-attach-input"
                    type="text"
                    value={attachDraft()}
                    placeholder={
                      t().attachedCellId && !t().attachedCellAlias
                        ? '(Zelle ohne Alias angehaengt — leer loest)'
                        : '^zellalias (leer = loesen)'
                    }
                    autocomplete="off"
                    spellcheck={false}
                    onInput={(e) => setAttachDraft(e.currentTarget.value)}
                    onBlur={(e) => onAttachBlur(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        (e.currentTarget as HTMLInputElement).blur();
                      }
                    }}
                  />
                  <Show when={t().attachedCellId && t().attachedCellAlias}>
                    <button
                      type="button"
                      class="docs-popup-attach-chip"
                      title="Zur angehaengten Zelle springen"
                      onClick={() => {
                        navigate(`/w/${p.workspaceId}/c/${t().attachedCellId}/info`);
                        p.onClose();
                      }}
                    >
                      ^{t().attachedCellAlias}
                    </button>
                  </Show>
                  <Show when={t().attachedCellId && !t().attachedCellAlias}>
                    <span
                      class="docs-popup-attach-chip docs-popup-attach-chip-noalias"
                      title="Zelle hat keinen Alias — loesen via leer lassen und Enter"
                    >
                      (Zelle)
                    </span>
                  </Show>
                </div>
                <Show
                  when={t().mode === 'edit'}
                  fallback={
                    <div
                      class="docs-popup-content-view"
                      role="button"
                      tabIndex={0}
                      title="Klicken oder Enter zum Bearbeiten"
                      onClick={() => {
                        patchActive({ mode: 'edit' });
                        setTimeout(() => contentRef?.focus(), 0);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          patchActive({ mode: 'edit' });
                          setTimeout(() => contentRef?.focus(), 0);
                        }
                      }}
                    >
                      <MarkdownLightView text={t().content} workspaceId={p.workspaceId} />
                    </div>
                  }
                >
                  <textarea
                    ref={(el) => {
                      contentRef = el;
                      bindAliasAutocomplete(el, p.workspaceId);
                    }}
                    class="docs-popup-content"
                    value={t().content}
                    placeholder="Markdown: **bold**, *italic*, `code`, http-Links. Leerzeile = Absatz."
                    onInput={(e) => patchActive({ content: e.currentTarget.value })}
                    onBlur={(e) => onContentBlur(e.currentTarget.value)}
                  />
                </Show>
              </div>

              <aside class="docs-popup-sidebar">
                <Show when={draftsList().length > 0}>
                  <h4 class="docs-popup-sidebar-title">
                    Entwuerfe ({draftsList().length})
                  </h4>
                  <ul class="docs-popup-recent-list">
                    <For each={draftsList()}>
                      {(d) => {
                        const isOpenTab = () =>
                          tabs().some(
                            (tb) =>
                              tb.docId === null && tb.clientId === d.clientId,
                          );
                        return (
                          <li
                            class="docs-popup-recent-item docs-popup-draft-item"
                            classList={{
                              'docs-popup-recent-active': isOpenTab(),
                            }}
                            onClick={() => onOpenDraft(d)}
                          >
                            <div class="docs-popup-recent-title">
                              {d.title || '(ohne Titel)'}
                              <Show when={d.alias}>
                                <span class="docs-popup-recent-alias">
                                  ^{d.alias}
                                </span>
                              </Show>
                            </div>
                            <Show when={d.content}>
                              <div class="docs-popup-recent-preview">
                                {d.content.slice(0, 80)}
                              </div>
                            </Show>
                            <button
                              type="button"
                              class="docs-popup-draft-del"
                              title="Entwurf verwerfen"
                              aria-label="Entwurf verwerfen"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteDraft(d.clientId);
                              }}
                            >
                              ×
                            </button>
                          </li>
                        );
                      }}
                    </For>
                  </ul>
                </Show>
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
