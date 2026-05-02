import { type Component, For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { validateAlias } from '../lib/alias';
import { formatDateDE } from '../lib/dates';
import { installFocusRestore, showConfirm } from '../lib/dialog';
import { openDokuForContext, shouldIgnoreDKey } from '../lib/docs-open';
import { openDocsPopup } from '../lib/docs-ui';
import { translateDbError } from '../lib/errors';
import { flashError } from '../lib/flash';
import {
  addCardInlineItem,
  addChecklistItem,
  delCard,
  delCardInlineItem,
  delChecklistItem,
  renameCard,
  renameCardInlineItem,
  renameChecklistItem,
  setCardAlias,
  setCardArchived,
  setCardColor,
  setCardDeadline,
  setCardDoneOccurrences,
  setCardNote,
  setCardPriority,
  setCardRecur,
  setCardTags,
  setCardWho,
  toggleCardDone,
  toggleCardInlineItem,
  toggleChecklistItemDone,
} from '../lib/mutations';
import {
  isCardDone,
  isRecurCard,
  recurEndLabel,
  recurHumanLabel,
  todayIso,
  toggleOccurrence,
} from '../lib/recur';
import { showToast } from '../lib/toasts';
import type {
  AtomPin,
  AtomTagWithTag,
  BoardContent,
  CardRecur,
  CardRecurType,
  CellRow,
  DocRow,
  InlineChecklistItem,
  KbCardRow,
  NodeRow,
} from '../lib/types';
import { bindAliasAutocomplete } from '../lib/use-alias-autocomplete';
import { useViewerActive } from '../lib/workspace-role';
import AliasText from './AliasText';
import AtomDocsSection from './AtomDocsSection';
import AtomTagsEditor from './AtomTagsEditor';
import Icon from './Icon';

type Props = {
  card: KbCardRow;
  content: BoardContent;
  onClose: () => void;
  onChanged?: () => void;
  // Welle D.9: Pin-/Doc-Daten fuer AtomDocsSection. Bewusst optional —
  // legacy Caller (z.B. TaskOverview) reichen nichts durch und sehen
  // dann auch keine Doku-Sektion.
  wsAtomPins?: AtomPin[];
  wsDocs?: DocRow[];
  // Welle D.9: TagPills (read-only) zur Anzeige der workspace_tags des
  // Tasks.
  wsAtomTagsEnriched?: AtomTagWithTag[];
  // Welle D.7c: Tag-Editor (read-write). atomPickerEntries fuer @-Trigger,
  // cells/nodes/cellLabelById fuer Object-Picker. realtimeVersion bumpt
  // Refetch wenn andere User taggen. Workspace-Resources-Bundle.
  workspaceId?: string;
  atomPickerEntries?: import('./AtomPickerModal').AtomPickerEntry[];
  wsCells?: CellRow[];
  wsNodes?: NodeRow[];
  cellLabelById?: Map<string, string>;
  tagsRealtimeVersion?: number;
};

type OverlayItem = {
  id: string;
  text: string;
  done: boolean;
  level: 0 | 1 | 2;
};

// Karten sind keine strukturellen Daten — Namens-, Note-, Deadline-,
// Priority- und Done-Aenderungen sind immer moeglich, unabhaengig vom
// globalen Edit-Mode. Der Edit-Mode gated nur strukturelle Board-Ops
// (Spalten-CRUD, Card Add/Delete/Move in der BoardView).
const CardOverlay: Component<Props> = (p) => {
  // Note-View/Edit-Toggle: Default View mit Alias-Chips, Klick → Textarea.
  const [noteEditing, setNoteEditing] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const viewerActive = useViewerActive();
  let aliasInputRef: HTMLInputElement | undefined;

  // ESC schliesst; wir haengen den Handler in Capture, damit er
  // ueber globalen Back-Handlern greift (CLAUDE.md-Konvention).
  // Plus Focus-Restore (Sprint AU-A4.3): beim Open den vorigen
  // activeElement merken, beim Close zuruecksetzen.
  onMount(() => {
    onCleanup(installFocusRestore());
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        p.onClose();
        return;
      }
      // Welle D.5b: 'd' im Modal-Body (kein Input-Focus) → Doku am Card-Atom.
      if (
        (e.key === 'd' || e.key === 'D') &&
        !e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !shouldIgnoreDKey(e.target)
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        openDokuForContext({
          kind: 'atom',
          atomType: 'task',
          atomId: p.card.id,
          atomTitle: p.card.name ?? null,
        });
      }
    };
    document.addEventListener('keydown', h, true);
    onCleanup(() => document.removeEventListener('keydown', h, true));
  });

  async function wrap<T>(fn: () => Promise<T>, successMsg?: string) {
    if (busy()) return;
    // Viewer-Read-only-Guard (P1.B.3). RLS lehnt die Mutation ohnehin
    // ab, aber der Toast hier ist freundlicher als der generic
    // RLS-Error.
    if (viewerActive()) {
      showToast('Read-only: Karten-Aenderungen sind als Viewer nicht moeglich.', 'info');
      return;
    }
    setBusy(true);
    try {
      await fn();
      if (successMsg) showToast(successMsg, 'success');
      p.onChanged?.();
    } catch (err) {
      console.error('CardOverlay.wrap:', err);
      showToast(translateDbError(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onRename(newName: string) {
    const trimmed = newName.trim();
    if (trimmed === p.card.name) return;
    await wrap(() => renameCard(p.card.id, trimmed));
  }

  function rejectAlias(msg: string) {
    showToast(msg, 'error');
    flashError(aliasInputRef);
    // Nach Shake-Animation Fokus zurueck + Text markieren, damit das
    // naechste Tippen direkt ueberschreibt. Eingabe NICHT revertieren —
    // User soll korrigieren koennen. (Pattern aus CellOverlay.)
    window.setTimeout(() => {
      aliasInputRef?.focus();
      aliasInputRef?.select();
    }, 420);
  }

  async function onAlias(newAlias: string) {
    if (busy()) return;
    if (viewerActive()) return;
    const current = p.card.alias ?? null;
    setBusy(true);
    try {
      const res = await validateAlias(newAlias, p.card.workspace_id, {
        type: 'card',
        id: p.card.id,
      });
      if (!res.ok) {
        rejectAlias(res.msg);
        return;
      }
      const next = res.canonical;
      if (next === current) return;
      await setCardAlias(p.card.id, next);
      p.onChanged?.();
    } catch (err) {
      // Falls die DB doch noch 23505 wirft (Race), selben Pfad gehen.
      rejectAlias(translateDbError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onNote(newNote: string) {
    if (newNote === p.card.note) return;
    await wrap(() => setCardNote(p.card.id, newNote));
  }

  async function onToggleDone(done: boolean) {
    const current = isCardDone(p.card);
    if (done === current) return;
    if (isRecurCard(p.card)) {
      const next = toggleOccurrence(p.card.done_occurrences, todayIso(), done);
      await wrap(() => setCardDoneOccurrences(p.card.id, next));
    } else {
      await wrap(() => toggleCardDone(p.card.id, done));
    }
  }

  async function onDeadline(val: string) {
    const next = val === '' ? null : val;
    if (next === (p.card.deadline ?? null)) return;
    await wrap(() => setCardDeadline(p.card.id, next));
  }

  async function onPriority(val: string) {
    const next = val === '' ? null : Number(val);
    if (next !== null && !Number.isFinite(next)) return;
    if (next === (p.card.priority ?? null)) return;
    await wrap(() => setCardPriority(p.card.id, next));
  }

  async function onColor(val: string | null) {
    const next = val && val !== '' ? val : null;
    if ((next ?? null) === (p.card.color ?? null)) return;
    await wrap(() => setCardColor(p.card.id, next));
  }

  // Comma/Whitespace-separierte Eingabe → normalisiertes Array.
  // Duplikate raus (case-insensitive), leere Strings raus. Reihenfolge
  // wird erhalten (erste Nennung gewinnt). "#" / "@" am Anfang werden
  // gestrippt, weil das Chip-Rendering sie selbst setzt — sonst
  // tauchen ## / @@ auf.
  function parseTagList(raw: string): string[] {
    const parts = raw
      .split(/[,\s]+/)
      .map((t) => t.replace(/^[#@]+/, '').trim())
      .filter((t) => t.length > 0);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of parts) {
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
    return out;
  }

  function arraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  async function onTags(raw: string) {
    const next = parseTagList(raw);
    const cur = p.card.tags ?? [];
    if (arraysEqual(next, cur)) return;
    await wrap(() => setCardTags(p.card.id, next));
  }

  async function onWho(raw: string) {
    const next = parseTagList(raw);
    const cur = p.card.who ?? [];
    if (arraysEqual(next, cur)) return;
    await wrap(() => setCardWho(p.card.id, next));
  }

  // Deadline-Warnung: dasselbe Regelwerk wie auf den Board-Karten.
  // Rendert einen kleinen farbigen Hinweis neben dem Date-Input.
  function deadlineWarning(): { state: 'overdue' | 'today' | 'soon'; label: string } | null {
    const iso = p.card.deadline;
    if (!iso) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const d = new Date(iso);
    d.setHours(0, 0, 0, 0);
    const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
    if (days < 0) return { state: 'overdue', label: `ueberfaellig (${-days}d)` };
    if (days === 0) return { state: 'today', label: 'heute faellig' };
    if (days <= 3) return { state: 'soon', label: `in ${days}d` };
    return null;
  }

  // Recur-State: die rohe Card.recur-JSONB-Spalte auf die typisierte
  // CardRecur-Shape abbilden, mit sinnvollen Defaults pro Typ. Null/
  // leer fuehrt zu `type:'none'`.
  function recurVal(): CardRecur {
    const r = p.card.recur as CardRecur | null | undefined;
    if (!r || !r.type || r.type === 'none') {
      return { type: 'none', every: 1 };
    }
    return {
      type: r.type,
      every: typeof r.every === 'number' && r.every > 0 ? r.every : 1,
      startDate: typeof r.startDate === 'string' ? r.startDate : '',
      weekdays: Array.isArray(r.weekdays) ? r.weekdays : undefined,
      weekday: typeof r.weekday === 'number' ? r.weekday : undefined,
      monthType: r.monthType === 'weekday' ? 'weekday' : r.monthType === 'day' ? 'day' : undefined,
      weekdayOrd: typeof r.weekdayOrd === 'number' ? r.weekdayOrd : undefined,
      day: typeof r.day === 'number' ? r.day : undefined,
      yearMonth: typeof r.yearMonth === 'number' ? r.yearMonth : undefined,
      yearDay: typeof r.yearDay === 'number' ? r.yearDay : undefined,
      endType:
        r.endType === 'date' || r.endType === 'count' || r.endType === 'never'
          ? r.endType
          : undefined,
      endDate: typeof r.endDate === 'string' ? r.endDate : undefined,
      endCount: typeof r.endCount === 'number' ? r.endCount : undefined,
    };
  }

  // Teil-Patch auf das Recur-Objekt: merged, filtert redundante Felder
  // raus (unused default-Werte), schreibt als ganzes zurueck. Der Caller
  // muss nicht selbst die existierenden Felder kopieren.
  async function patchRecur(patch: Partial<CardRecur>) {
    const cur = recurVal();
    if (cur.type === 'none' && !patch.type) return;
    const next: CardRecur = { ...cur, ...patch };
    // Wenn weekdays per patch geleert wird (weekdays=[]), fallen wir
    // NICHT auf legacy weekday zurueck — sondern speichern das leere
    // Array (User meint "keine Wochentage ausgewaehlt"). recurFiresOn
    // liefert dann nie true fuer weekly. UI zeigt Warn-Hint.
    await wrap(() => setCardRecur(p.card.id, next));
  }

  // Typ-Wechsel: neuen Default-Zustand fuer den Ziel-Typ bauen. Wir
  // werfen alle nicht-mehr-relevanten Felder weg, damit das JSONB
  // nicht muellt.
  async function onRecurType(val: string) {
    if (val === 'none') {
      await wrap(() => setCardRecur(p.card.id, null));
      return;
    }
    const cur = recurVal();
    const base: CardRecur = {
      type: val as CardRecurType,
      every: cur.every && cur.every > 0 ? cur.every : 1,
      startDate: cur.startDate || new Date().toISOString().slice(0, 10),
      endType: cur.endType ?? 'never',
    };
    const today = new Date();
    const dayStr = today.getDate();
    const jsDay = today.getDay();
    const mondayBased = jsDay === 0 ? 6 : jsDay - 1;
    if (val === 'weekly') {
      base.weekdays = cur.weekdays?.length
        ? cur.weekdays
        : cur.weekday !== undefined
          ? [cur.weekday]
          : [mondayBased];
    } else if (val === 'monthly') {
      base.monthType = cur.monthType ?? 'day';
      base.day = cur.day ?? dayStr;
      base.weekday = cur.weekday ?? mondayBased;
      base.weekdayOrd = cur.weekdayOrd ?? 1;
    } else if (val === 'yearly') {
      base.monthType = cur.monthType ?? 'day';
      base.yearMonth = cur.yearMonth ?? today.getMonth();
      base.yearDay = cur.yearDay ?? dayStr;
      base.weekday = cur.weekday ?? mondayBased;
      base.weekdayOrd = cur.weekdayOrd ?? 1;
    }
    await wrap(() => setCardRecur(p.card.id, base));
  }

  async function onRecurEvery(val: string) {
    const n = Number(val);
    if (!Number.isFinite(n) || n < 1) return;
    const cur = recurVal();
    if (cur.type === 'none') return;
    if (cur.every === n) return;
    await patchRecur({ every: n });
  }

  async function onRecurStart(val: string) {
    const cur = recurVal();
    if (cur.type === 'none') return;
    const next = val || '';
    if (cur.startDate === next) return;
    await patchRecur({ startDate: next });
  }

  // Weekly: weekday toggeln (Mon=0..So=6). Wenn schon drin, raus; sonst
  // rein. Sort damit die Reihenfolge beim Label kanonisch bleibt.
  async function onRecurToggleWeekday(wd: number) {
    const cur = recurVal();
    if (cur.type !== 'weekly') return;
    const set = new Set(cur.weekdays ?? []);
    if (set.has(wd)) set.delete(wd);
    else set.add(wd);
    await patchRecur({ weekdays: [...set].sort((a, b) => a - b) });
  }

  async function onRecurMonthType(val: 'day' | 'weekday') {
    const cur = recurVal();
    if (cur.type !== 'monthly' && cur.type !== 'yearly') return;
    if (cur.monthType === val) return;
    await patchRecur({ monthType: val });
  }

  async function onRecurDay(val: string) {
    const n = Number(val);
    if (!Number.isFinite(n) || n < 1 || n > 31) return;
    await patchRecur({ day: n });
  }

  async function onRecurWeekday(val: string) {
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0 || n > 6) return;
    await patchRecur({ weekday: n });
  }

  async function onRecurWeekdayOrd(val: string) {
    const n = Number(val);
    if (!Number.isFinite(n)) return;
    await patchRecur({ weekdayOrd: n });
  }

  async function onRecurYearMonth(val: string) {
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0 || n > 11) return;
    await patchRecur({ yearMonth: n });
  }

  async function onRecurYearDay(val: string) {
    const n = Number(val);
    if (!Number.isFinite(n) || n < 1 || n > 31) return;
    await patchRecur({ yearDay: n });
  }

  async function onRecurEndType(val: 'never' | 'date' | 'count') {
    const cur = recurVal();
    if (cur.endType === val) return;
    const patch: Partial<CardRecur> = { endType: val };
    if (val === 'date' && !cur.endDate) {
      // Sinnvoller Default: 3 Monate ab Start.
      const base = cur.startDate ? new Date(cur.startDate) : new Date();
      base.setMonth(base.getMonth() + 3);
      patch.endDate = base.toISOString().slice(0, 10);
    }
    if (val === 'count' && !cur.endCount) {
      patch.endCount = 10;
    }
    await patchRecur(patch);
  }

  async function onRecurEndDate(val: string) {
    if (!val) return;
    await patchRecur({ endDate: val });
  }

  async function onRecurEndCount(val: string) {
    const n = Number(val);
    if (!Number.isFinite(n) || n < 1) return;
    await patchRecur({ endCount: n });
  }

  // Verlauf zuruecksetzen: done_occurrences leeren. Nur Bestaetigung
  // bei >3 Eintraegen — sonst zu strenges Friction.
  async function onClearOccurrences() {
    const occ = p.card.done_occurrences ?? [];
    if (occ.length === 0) return;
    if (occ.length > 3) {
      const ok = await showConfirm({
        title: 'Verlauf zuruecksetzen?',
        message: `${occ.length} erledigte Termine loeschen? Die Historie geht verloren.`,
        variant: 'danger',
        confirmLabel: 'Loeschen',
      });
      if (!ok) return;
    }
    await wrap(() => setCardDoneOccurrences(p.card.id, []));
  }

  async function onToggleArchive() {
    const next = !p.card.archived;
    await wrap(
      () => setCardArchived(p.card.id, next),
      next ? 'Karte archiviert.' : 'Karte wieder aktiv.',
    );
  }

  async function onDelete() {
    if (viewerActive()) {
      showToast('Read-only: Karten-Loeschen ist als Viewer nicht moeglich.', 'info');
      return;
    }
    const ok = await showConfirm({
      title: 'Karte loeschen?',
      message: `Karte "${p.card.name || '(ohne Titel)'}" loeschen?`,
      variant: 'danger',
      confirmLabel: 'Loeschen',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await delCard(p.card.id);
      showToast('Karte geloescht.', 'success');
      p.onChanged?.();
      p.onClose();
    } catch (err) {
      showToast(translateDbError(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  // Quelle der Checklist-Items: ref → checklist_items, sonst inline.
  //
  // `id` brauchen wir in beiden Pfaden stabil, damit toggle/rename/del
  // das richtige Item treffen. Bei checklist_items liefert die DB es
  // direkt; bei inline geben Legacy-Items evtl. keine id, in dem Fall
  // fallen wir auf den Array-Index zurueck (`i-<idx>`). Der naechste
  // Schreibzugriff (ensureItemId in mutations.ts) haengt dann eine
  // UUID dran.
  const items = createMemo<OverlayItem[]>(() => {
    const c = p.card;
    if (c.checklist_ref) {
      return p.content.checklistItems
        .filter((it) => it.checklist_id === c.checklist_ref)
        .sort((a, b) => a.position - b.position)
        .map((it) => ({
          id: it.id,
          text: it.text,
          done: it.done,
          level: it.level,
        }));
    }
    const inline = c.checklist;
    if (Array.isArray(inline)) {
      return inline.map((i: InlineChecklistItem, idx) => ({
        id: i.id ?? `i-${idx}`,
        text: i.text,
        done: !!i.done,
        level: (i.level ?? 0) as 0 | 1 | 2,
      }));
    }
    return [];
  });

  const refChecklistLabel = createMemo(() => {
    if (!p.card.checklist_ref) return null;
    const cl = p.content.checklists.find((c) => c.id === p.card.checklist_ref);
    return cl ? cl.label || '(Liste)' : null;
  });

  // Mutations-Dispatch: Ref-Mode → checklist_items-Tabelle, sonst
  // Inline-JSONB auf der Karte. Fuer den Caller ist das transparent.
  async function onToggleItem(item: OverlayItem, done: boolean) {
    if (done === item.done) return;
    await wrap(async () => {
      if (p.card.checklist_ref) {
        await toggleChecklistItemDone(item.id, done);
      } else {
        await toggleCardInlineItem(p.card.id, item.id, done);
      }
    });
  }

  async function onRenameItem(item: OverlayItem, text: string) {
    if (text === item.text) return;
    await wrap(async () => {
      if (p.card.checklist_ref) {
        await renameChecklistItem(item.id, text);
      } else {
        await renameCardInlineItem(p.card.id, item.id, text);
      }
    });
  }

  async function onDelItem(item: OverlayItem) {
    await wrap(async () => {
      if (p.card.checklist_ref) {
        await delChecklistItem(item.id);
      } else {
        await delCardInlineItem(p.card.id, item.id);
      }
    });
  }

  async function onAddItem() {
    await wrap(async () => {
      if (p.card.checklist_ref) {
        await addChecklistItem({
          workspaceId: p.card.workspace_id,
          checklistId: p.card.checklist_ref,
        });
      } else {
        await addCardInlineItem({ cardId: p.card.id });
      }
    });
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Backdrop-Klick — Tastatur via ESC-Capture im onMount.
    <div
      class="overlay-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) p.onClose();
      }}
    >
      <div
        class="overlay-card card-overlay"
        // biome-ignore lint/a11y/useSemanticElements: <div role="dialog"> bewusst statt <dialog> — showModal() haette aufwendige Migration aller Modals zur Folge.
        role="dialog"
        aria-modal="true"
      >
        <header class="overlay-head card-overlay-head">
          {/* Done-Toggle direkt links vom Namen — primaere Aktion auf
              einer Karte, soll immer auffindbar sein. Bei Recur heisst
              das Label "Heute erledigt", sonst "Erledigt". */}
          <label
            class="card-overlay-done"
            title={isRecurCard(p.card) ? 'Heutiges Vorkommen abhaken' : 'Karte erledigt markieren'}
          >
            <input
              type="checkbox"
              checked={isCardDone(p.card)}
              onChange={(e) => onToggleDone(e.currentTarget.checked)}
            />
            <Show when={isCardDone(p.card)}>
              <span class="kb-done-mark" aria-hidden="true">
                <Icon name="check" size={12} />
              </span>
            </Show>
          </label>
          <input
            class="overlay-title-input card-overlay-title"
            type="text"
            value={p.card.name}
            placeholder="(ohne Titel)"
            onBlur={(e) => onRename(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                (e.currentTarget as HTMLInputElement).blur();
              }
            }}
          />
          <button type="button" class="overlay-close" onClick={p.onClose} aria-label="Schliessen">
            <Icon name="x" size={18} />
          </button>
        </header>

        <div class="overlay-body">
          <section class="overlay-section overlay-edit-grid">
            <label class="overlay-field">
              <span class="overlay-field-label">Alias</span>
              <input
                ref={aliasInputRef}
                type="text"
                class="overlay-input"
                value={p.card.alias ?? ''}
                placeholder="(kein Alias)"
                onBlur={(e) => onAlias(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    (e.currentTarget as HTMLInputElement).blur();
                  }
                }}
              />
            </label>

            <label class="overlay-field">
              <span class="overlay-field-label">Deadline</span>
              <input
                type="date"
                class="overlay-input"
                value={p.card.deadline ?? ''}
                onChange={(e) => onDeadline(e.currentTarget.value)}
              />
              <Show when={!isCardDone(p.card) && deadlineWarning()}>
                {(warning) => (
                  <span class="overlay-deadline-warning" data-deadline-state={warning().state}>
                    {warning().label}
                  </span>
                )}
              </Show>
            </label>

            <label class="overlay-field">
              <span class="overlay-field-label">Prioritaet</span>
              <input
                type="number"
                class="overlay-input"
                value={p.card.priority ?? ''}
                placeholder="(keine)"
                min="0"
                max="9"
                onBlur={(e) => onPriority(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    (e.currentTarget as HTMLInputElement).blur();
                  }
                }}
              />
            </label>

            <label class="overlay-field overlay-field-color">
              <span class="overlay-field-label">Farbe</span>
              <div class="overlay-color-row">
                <input
                  type="color"
                  class="overlay-color-input"
                  value={p.card.color ?? '#888888'}
                  title="Karten-Farbe"
                  onChange={(e) => onColor(e.currentTarget.value)}
                />
                <button
                  type="button"
                  class="overlay-color-clear"
                  title="Farbe entfernen"
                  aria-label="Farbe entfernen"
                  onClick={() => onColor(null)}
                  disabled={!p.card.color}
                >
                  ○
                </button>
              </div>
            </label>
          </section>

          <section class="overlay-section overlay-tag-grid">
            <label class="overlay-field">
              <span class="overlay-field-label">Tags</span>
              <input
                type="text"
                class="overlay-input"
                value={(p.card.tags ?? []).join(', ')}
                placeholder="design, review, legal"
                onBlur={(e) => onTags(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    (e.currentTarget as HTMLInputElement).blur();
                  }
                }}
              />
              <Show when={(p.card.tags ?? []).length > 0}>
                <div class="overlay-chip-row">
                  <For each={p.card.tags ?? []}>{(t) => <span class="kb-tag">#{t}</span>}</For>
                </div>
              </Show>
            </label>
            <label class="overlay-field">
              <span class="overlay-field-label">Zustaendig</span>
              <input
                type="text"
                class="overlay-input"
                value={(p.card.who ?? []).join(', ')}
                placeholder="anna, tom"
                onBlur={(e) => onWho(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    (e.currentTarget as HTMLInputElement).blur();
                  }
                }}
              />
              <Show when={(p.card.who ?? []).length > 0}>
                <div class="overlay-chip-row">
                  <For each={p.card.who ?? []}>{(w) => <span class="kb-who">@{w}</span>}</For>
                </div>
              </Show>
            </label>
          </section>

          {/* Recur-Block: Typ-Select + pro-Typ-spezifische Sub-UI +
              End-Regel + Erledigt-Verlauf. Entspricht buildRecurrenceUI
              aus matrix_tool_beta.html (Zeilen 4492-4726). */}
          <section class="overlay-section card-recur">
            <header class="card-recur-head">
              <h4>Wiederholung</h4>
              <Show when={recurVal().type !== 'none'}>
                <span
                  class="card-recur-summary"
                  title={`${recurHumanLabel(recurVal())}${recurEndLabel(recurVal()) ? ` · ${recurEndLabel(recurVal())}` : ''}`}
                >
                  <Icon name="arrow-path" size={12} /> {recurHumanLabel(recurVal())}
                  <Show when={recurEndLabel(recurVal())}>
                    {' '}
                    <span class="card-recur-end-hint">· {recurEndLabel(recurVal())}</span>
                  </Show>
                </span>
              </Show>
            </header>

            <div class="card-recur-type-row">
              <label class="overlay-field">
                <span class="overlay-field-label">Typ</span>
                <select
                  class="overlay-input"
                  value={recurVal().type}
                  onChange={(e) => onRecurType(e.currentTarget.value)}
                >
                  <option value="none">keine</option>
                  <option value="daily">taeglich</option>
                  <option value="weekly">woechentlich</option>
                  <option value="monthly">monatlich</option>
                  <option value="yearly">jaehrlich</option>
                </select>
              </label>

              <Show when={recurVal().type !== 'none'}>
                <label class="overlay-field">
                  <span class="overlay-field-label">Alle</span>
                  <div class="card-recur-every-row">
                    <input
                      type="number"
                      class="overlay-input card-recur-every"
                      min="1"
                      max="365"
                      value={recurVal().every ?? 1}
                      onBlur={(e) => onRecurEvery(e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          (e.currentTarget as HTMLInputElement).blur();
                        }
                      }}
                    />
                    <span class="card-recur-every-unit">
                      {
                        {
                          daily: 'Tage',
                          weekly: 'Wochen',
                          monthly: 'Monate',
                          yearly: 'Jahre',
                        }[recurVal().type as Exclude<CardRecurType, 'none'>]
                      }
                    </span>
                  </div>
                </label>

                <label class="overlay-field">
                  <span class="overlay-field-label">Start</span>
                  <input
                    type="date"
                    class="overlay-input"
                    value={recurVal().startDate ?? ''}
                    onChange={(e) => onRecurStart(e.currentTarget.value)}
                  />
                </label>
              </Show>
            </div>

            {/* Weekly: 7-Tage-Grid. Mo=0..So=6 (unser Schema). User
                tickt mehrere Tage an; fire-Check prueft Membership. */}
            <Show when={recurVal().type === 'weekly'}>
              <div class="card-recur-block">
                <span class="card-recur-block-label">Wochentage</span>
                <div
                  class="card-recur-weekday-grid"
                  // biome-ignore lint/a11y/useSemanticElements: bewusst <div role="group"> — <fieldset> wuerde Browser-Default-Border + Margin einfuegen.
                  role="group"
                  aria-label="Wochentage"
                >
                  <For each={['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']}>
                    {(lbl, i) => {
                      const wd = i();
                      const isOn = () => (recurVal().weekdays ?? []).includes(wd);
                      return (
                        <button
                          type="button"
                          class="card-recur-weekday"
                          classList={{ 'card-recur-weekday-on': isOn() }}
                          onClick={() => onRecurToggleWeekday(wd)}
                          aria-pressed={isOn()}
                          title={
                            [
                              'Montag',
                              'Dienstag',
                              'Mittwoch',
                              'Donnerstag',
                              'Freitag',
                              'Samstag',
                              'Sonntag',
                            ][wd]
                          }
                        >
                          {lbl}
                        </button>
                      );
                    }}
                  </For>
                </div>
                <Show when={(recurVal().weekdays ?? []).length === 0}>
                  <p class="card-recur-hint">
                    Mindestens einen Wochentag waehlen, sonst feuert die Regel nie.
                  </p>
                </Show>
              </div>
            </Show>

            {/* Monthly: Radio zwischen "Am Tag X" und "Am N-tem Wochentag".
                Die jeweils aktive Variante hat ihre Eingabefelder aktiv,
                die andere bleibt disabled (statt hide — vermeidet Layout-
                Sprung beim Wechseln). */}
            <Show when={recurVal().type === 'monthly'}>
              <div class="card-recur-block">
                <span class="card-recur-block-label">Regel</span>
                <div class="card-recur-month-choices">
                  <label class="card-recur-radio">
                    <input
                      type="radio"
                      name="recur-monthtype"
                      checked={recurVal().monthType !== 'weekday'}
                      onChange={() => onRecurMonthType('day')}
                    />
                    <span>Am</span>
                    <input
                      type="number"
                      class="overlay-input card-recur-inline-num"
                      min="1"
                      max="31"
                      value={recurVal().day ?? 1}
                      disabled={recurVal().monthType === 'weekday'}
                      onBlur={(e) => onRecurDay(e.currentTarget.value)}
                    />
                    <span>. des Monats</span>
                  </label>
                  <label class="card-recur-radio">
                    <input
                      type="radio"
                      name="recur-monthtype"
                      checked={recurVal().monthType === 'weekday'}
                      onChange={() => onRecurMonthType('weekday')}
                    />
                    <span>Am</span>
                    <select
                      class="overlay-input card-recur-inline-select"
                      value={recurVal().weekdayOrd ?? 1}
                      disabled={recurVal().monthType !== 'weekday'}
                      onChange={(e) => onRecurWeekdayOrd(e.currentTarget.value)}
                    >
                      <option value="1">1.</option>
                      <option value="2">2.</option>
                      <option value="3">3.</option>
                      <option value="4">4.</option>
                      <option value="-1">letzten</option>
                    </select>
                    <select
                      class="overlay-input card-recur-inline-select"
                      value={recurVal().weekday ?? 0}
                      disabled={recurVal().monthType !== 'weekday'}
                      onChange={(e) => onRecurWeekday(e.currentTarget.value)}
                    >
                      <option value="0">Mo</option>
                      <option value="1">Di</option>
                      <option value="2">Mi</option>
                      <option value="3">Do</option>
                      <option value="4">Fr</option>
                      <option value="5">Sa</option>
                      <option value="6">So</option>
                    </select>
                    <span>des Monats</span>
                  </label>
                </div>
              </div>
            </Show>

            {/* Yearly: Monat-Dropdown + dieselbe monthType-Logik wie bei
                monthly. Der Monat gilt fuer beide Varianten. */}
            <Show when={recurVal().type === 'yearly'}>
              <div class="card-recur-block">
                <span class="card-recur-block-label">Regel</span>
                <label class="card-recur-inline-field">
                  <span>Im Monat</span>
                  <select
                    class="overlay-input card-recur-inline-select"
                    value={recurVal().yearMonth ?? 0}
                    onChange={(e) => onRecurYearMonth(e.currentTarget.value)}
                  >
                    <For
                      each={[
                        'Januar',
                        'Februar',
                        'Maerz',
                        'April',
                        'Mai',
                        'Juni',
                        'Juli',
                        'August',
                        'September',
                        'Oktober',
                        'November',
                        'Dezember',
                      ]}
                    >
                      {(m, i) => <option value={i()}>{m}</option>}
                    </For>
                  </select>
                </label>
                <div class="card-recur-month-choices">
                  <label class="card-recur-radio">
                    <input
                      type="radio"
                      name="recur-yearmonthtype"
                      checked={recurVal().monthType !== 'weekday'}
                      onChange={() => onRecurMonthType('day')}
                    />
                    <span>Am</span>
                    <input
                      type="number"
                      class="overlay-input card-recur-inline-num"
                      min="1"
                      max="31"
                      value={recurVal().yearDay ?? 1}
                      disabled={recurVal().monthType === 'weekday'}
                      onBlur={(e) => onRecurYearDay(e.currentTarget.value)}
                    />
                    <span>.</span>
                  </label>
                  <label class="card-recur-radio">
                    <input
                      type="radio"
                      name="recur-yearmonthtype"
                      checked={recurVal().monthType === 'weekday'}
                      onChange={() => onRecurMonthType('weekday')}
                    />
                    <span>Am</span>
                    <select
                      class="overlay-input card-recur-inline-select"
                      value={recurVal().weekdayOrd ?? 1}
                      disabled={recurVal().monthType !== 'weekday'}
                      onChange={(e) => onRecurWeekdayOrd(e.currentTarget.value)}
                    >
                      <option value="1">1.</option>
                      <option value="2">2.</option>
                      <option value="3">3.</option>
                      <option value="4">4.</option>
                      <option value="-1">letzten</option>
                    </select>
                    <select
                      class="overlay-input card-recur-inline-select"
                      value={recurVal().weekday ?? 0}
                      disabled={recurVal().monthType !== 'weekday'}
                      onChange={(e) => onRecurWeekday(e.currentTarget.value)}
                    >
                      <option value="0">Mo</option>
                      <option value="1">Di</option>
                      <option value="2">Mi</option>
                      <option value="3">Do</option>
                      <option value="4">Fr</option>
                      <option value="5">Sa</option>
                      <option value="6">So</option>
                    </select>
                  </label>
                </div>
              </div>
            </Show>

            {/* Ende-Regel: bei jedem Typ ausser 'none' sichtbar. */}
            <Show when={recurVal().type !== 'none'}>
              <div class="card-recur-block">
                <span class="card-recur-block-label">Endet</span>
                <div class="card-recur-end-choices">
                  <label class="card-recur-radio">
                    <input
                      type="radio"
                      name="recur-endtype"
                      checked={(recurVal().endType ?? 'never') === 'never'}
                      onChange={() => onRecurEndType('never')}
                    />
                    <span>unbegrenzt</span>
                  </label>
                  <label class="card-recur-radio">
                    <input
                      type="radio"
                      name="recur-endtype"
                      checked={recurVal().endType === 'date'}
                      onChange={() => onRecurEndType('date')}
                    />
                    <span>am</span>
                    <input
                      type="date"
                      class="overlay-input card-recur-inline-num"
                      value={recurVal().endDate ?? ''}
                      disabled={recurVal().endType !== 'date'}
                      onChange={(e) => onRecurEndDate(e.currentTarget.value)}
                    />
                  </label>
                  <label class="card-recur-radio">
                    <input
                      type="radio"
                      name="recur-endtype"
                      checked={recurVal().endType === 'count'}
                      onChange={() => onRecurEndType('count')}
                    />
                    <span>nach</span>
                    <input
                      type="number"
                      class="overlay-input card-recur-inline-num"
                      min="1"
                      max="9999"
                      value={recurVal().endCount ?? 10}
                      disabled={recurVal().endType !== 'count'}
                      onBlur={(e) => onRecurEndCount(e.currentTarget.value)}
                    />
                    <span>Terminen</span>
                  </label>
                </div>
              </div>
            </Show>

            {/* Erledigt-Verlauf — nur bei vorhandenen Occurrences. */}
            <Show when={recurVal().type !== 'none' && (p.card.done_occurrences ?? []).length > 0}>
              <div class="card-recur-block card-recur-occ">
                <span class="card-recur-block-label">Erledigt</span>
                <div class="card-recur-occ-row">
                  <span class="card-recur-occ-count">
                    {(p.card.done_occurrences ?? []).length}
                    <Show when={recurVal().endCount && recurVal().endType === 'count'}>
                      /{recurVal().endCount}
                    </Show>{' '}
                    Termine
                  </span>
                  <span class="card-recur-occ-last hint">
                    zuletzt {formatDateDE([...(p.card.done_occurrences ?? [])].sort().at(-1))}
                  </span>
                  <button
                    type="button"
                    class="btn-subtle card-recur-occ-clear"
                    onClick={onClearOccurrences}
                    disabled={busy()}
                    title="Alle erledigten Termine entfernen"
                  >
                    Verlauf zuruecksetzen
                  </button>
                </div>
              </div>
            </Show>
          </section>

          <section class="overlay-section">
            <h4>Notiz</h4>
            {/* View/Edit-Toggle: View rendert AliasText mit Chip-
                Interaktion; Klick/Enter wechselt zur Textarea.
                Blur schreibt zurueck und wechselt zur View-Ansicht.
                Leere Notiz zeigt Placeholder-Div mit "Klick zum Bearbeiten". */}
            <Show
              when={noteEditing()}
              fallback={
                <div
                  class="overlay-note-view"
                  classList={{ 'overlay-note-empty': !p.card.note }}
                  // biome-ignore lint/a11y/useSemanticElements: bewusst <div role="button"> — Inhalt rendert <AliasText> mit klickbaren Chips, nested <button>-in-<button> waere invalid.
                  role="button"
                  tabIndex={0}
                  title="Klicken zum Bearbeiten"
                  onClick={() => setNoteEditing(true)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setNoteEditing(true);
                    }
                  }}
                >
                  <Show when={p.card.note} fallback="(keine Notiz)">
                    <AliasText text={p.card.note} workspaceId={p.card.workspace_id} />
                  </Show>
                </div>
              }
            >
              <textarea
                class="overlay-textarea"
                value={p.card.note}
                placeholder="(keine Notiz)"
                rows="4"
                autofocus
                ref={(el) => {
                  const cleanup = bindAliasAutocomplete(el, p.card.workspace_id);
                  onCleanup(cleanup);
                  // Beim ersten Render nach Mode-Wechsel Fokus ans Ende.
                  queueMicrotask(() => {
                    try {
                      const len = el.value.length;
                      el.focus();
                      el.setSelectionRange(len, len);
                    } catch {
                      /* ignore */
                    }
                  });
                }}
                onBlur={(e) => {
                  onNote(e.currentTarget.value);
                  setNoteEditing(false);
                }}
              />
            </Show>
          </section>

          <section class="overlay-section">
            <h4>
              Checkliste
              <Show when={refChecklistLabel()}>
                <span class="hint"> — Referenz auf „{refChecklistLabel()}"</span>
              </Show>
            </h4>
            <Show when={items().length > 0} fallback={<p class="hint">Noch keine Punkte.</p>}>
              <ul class="cl-items overlay-cl">
                <For each={items()}>
                  {(it) => (
                    <li
                      class="cl-it"
                      classList={{ 'cl-it-done': it.done }}
                      style={{ '--cl-level': it.level }}
                    >
                      <input
                        type="checkbox"
                        class="cl-checkbox-input"
                        checked={it.done}
                        aria-label="Erledigt"
                        onChange={(e) => onToggleItem(it, e.currentTarget.checked)}
                      />
                      <input
                        class="cl-text-input"
                        type="text"
                        value={it.text}
                        placeholder="(Punkt)"
                        onBlur={(e) => onRenameItem(it, e.currentTarget.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            (e.currentTarget as HTMLInputElement).blur();
                          }
                        }}
                      />
                      <button
                        type="button"
                        class="cl-it-del"
                        title="Punkt loeschen"
                        aria-label="Punkt loeschen"
                        onClick={() => onDelItem(it)}
                        disabled={busy()}
                      >
                        ✕
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
            <button type="button" class="cl-add-item-btn" onClick={onAddItem} disabled={busy()}>
              + Punkt
            </button>
          </section>

          <Show when={p.card.source_label || p.card.source_cl_id}>
            <p class="hint overlay-source">
              <Show
                when={p.card.source_cl_id}
                fallback={<>ehemals Checkliste „{p.card.source_label}"</>}
              >
                stammt aus Checkliste-ID <code>{p.card.source_cl_id}</code>
              </Show>
            </p>
          </Show>

          {/* Welle D.7c: Tag-Editor (read-write) wenn Workspace-Resources
              vorhanden. Fallback: legacy nur read-only durch wsAtomTagsEnriched. */}
          <Show when={p.workspaceId}>
            <section class="overlay-section card-ws-tags">
              <h4>Tags</h4>
              <AtomTagsEditor
                workspaceId={p.workspaceId!}
                atomType="task"
                atomId={p.card.id}
                realtimeVersion={p.tagsRealtimeVersion ?? 0}
                atomPickerEntries={p.atomPickerEntries}
                cells={p.wsCells}
                nodes={p.wsNodes}
                cellLabelById={p.cellLabelById}
              />
            </section>
          </Show>

          {/* Welle D.9: Doku-Sektion. Zeigt gepinnte Dokus mit Vorschau. */}
          <Show when={p.wsAtomPins && p.wsDocs}>
            <AtomDocsSection
              atomType="task"
              atomId={p.card.id}
              atomTitle={p.card.name ?? null}
              atomPins={p.wsAtomPins ?? []}
              docs={p.wsDocs ?? []}
            />
          </Show>

          <footer class="overlay-edit-footer">
            <button
              type="button"
              class="btn-subtle"
              onClick={() => {
                openDocsPopup({
                  sourceAlias: p.card.alias ?? null,
                });
                p.onClose();
              }}
              title="Neue Doku mit dieser Karte als Quelle anlegen"
            >
              In Doku erfassen
            </button>
            <button
              type="button"
              class="btn-subtle"
              onClick={onToggleArchive}
              disabled={busy()}
              title={
                p.card.archived
                  ? 'Karte wieder sichtbar machen'
                  : 'Karte archivieren (versteckt auf dem Board)'
              }
            >
              {p.card.archived ? 'Aus Archiv holen' : 'Archivieren'}
            </button>
            <button type="button" class="btn-danger" onClick={onDelete} disabled={busy()}>
              Karte loeschen
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
};

export default CardOverlay;
