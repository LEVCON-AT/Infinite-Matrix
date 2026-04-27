// Zell-Info-Felder als eigene Seite. Aufruf ueber /w/:wsId/c/:cellId/info.
// Analog zu CellChecklistsPage — der User taucht in die Zelle ein, ESC
// bringt ihn zur Parent-Matrix zurueck (globaler Handler in Workspace.tsx).
//
// Info-Felder leben in cell.data.infoFields[] (JSONB). Mutation-Pattern:
// read cell.data -> mutate Array -> write zurueck. Da alle Felder in einer
// Zelle auf demselben JSONB-Key sitzen, werden parallele Mutationen auf
// demselben Feld serialisiert (onChanged triggert Refetch).
//
// Edit-Gating (Vorbild HTML renderInfoTab):
//   - Label + Value: immer Input/Textarea, readOnly togglet
//   - ▲▼-Reorder + ✕-Delete: immer im DOM, opacity/pointer-events im
//     View-Mode deaktiviert (zero layout shift)
//   - "+ Feld": nur sichtbar im Edit-Mode

import { useNavigate } from '@solidjs/router';
import { type Component, For, Show, createMemo, createSignal, onCleanup } from 'solid-js';
import { readCellLinksFromCell, readInfoFieldsFromCell } from '../lib/cell-data';
import { showConfirm, showPrompt } from '../lib/dialog';
import { openDocsPopup } from '../lib/docs-ui';
import { useEditMode } from '../lib/edit-mode';
import { translateDbError } from '../lib/errors';
import {
  addCellInfoField,
  addCellLink,
  delCellInfoField,
  delCellLink,
  moveCellInfoField,
  moveCellLink,
  renameCellInfoField,
  setCellInfoFieldValue,
  setCellLinkLabel,
  setCellLinkUrl,
} from '../lib/mutations';
import type { PresenceUser } from '../lib/presence';
import { showToast } from '../lib/toasts';
import type { CellRow, ColRow, InfoField, InfoLink, RowRow } from '../lib/types';
import { sanitizeUrl } from '../lib/url';
import { bindAliasAutocomplete } from '../lib/use-alias-autocomplete';
import { useViewerActive } from '../lib/workspace-role';
import AliasText from './AliasText';
import CellDocsSection from './CellDocsSection';
import PresenceMini from './PresenceMini';

type Props = {
  workspaceId: string;
  cell: CellRow;
  row: RowRow | undefined;
  col: ColRow | undefined;
  realtimeDocsVersion: number;
  onChanged: () => void;
  // P1.D Live-Cursor (Felder + Links).
  presence?: () => PresenceUser[];
  selfUserId?: string;
  onFieldHover?: (fieldId: string | undefined) => void;
};

const CellInfoPage: Component<Props> = (p) => {
  const navigate = useNavigate();
  const editMode = useEditMode();
  const viewerActive = useViewerActive();
  const [busy, setBusy] = createSignal(false);

  // P1.D Live-Cursor — Felder UND Links teilen sich denselben hoverFieldId-
  // Slot, weil beide Element-Typen unter "Info" laufen und die IDs
  // disjunkt sind (UUIDs).
  const presenceByField = createMemo<Map<string, PresenceUser[]>>(() => {
    const map = new Map<string, PresenceUser[]>();
    const all = p.presence?.() ?? [];
    for (const u of all) {
      if (u.userId === p.selfUserId) continue;
      const fid = u.hoverFieldId;
      if (!fid) continue;
      const arr = map.get(fid);
      if (arr) arr.push(u);
      else map.set(fid, [u]);
    }
    return map;
  });

  onCleanup(() => {
    p.onFieldHover?.(undefined);
  });

  const fields = () => readInfoFieldsFromCell(p.cell);
  const links = () => readCellLinksFromCell(p.cell);

  async function wrap<T>(fn: () => Promise<T>, successMsg?: string) {
    if (busy()) return;
    if (viewerActive()) {
      showToast('Read-only: Info-Aenderungen sind als Viewer nicht moeglich.', 'info');
      return;
    }
    setBusy(true);
    try {
      await fn();
      if (successMsg) showToast(successMsg, 'success');
      p.onChanged();
    } catch (err) {
      showToast(translateDbError(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onAddField() {
    await wrap(() => addCellInfoField({ cellId: p.cell.id }));
  }

  async function onRenameField(f: InfoField, label: string) {
    if (label === f.label) return;
    await wrap(() => renameCellInfoField(p.cell.id, f.id, label));
  }

  async function onSetValue(f: InfoField, value: string) {
    if (value === f.value) return;
    await wrap(() => setCellInfoFieldValue(p.cell.id, f.id, value));
  }

  async function onMoveField(f: InfoField, dir: -1 | 1) {
    await wrap(() => moveCellInfoField(p.cell.id, f.id, dir));
  }

  async function onDelField(f: InfoField) {
    const hasValue = f.value.trim().length > 0;
    if (hasValue) {
      const ok = await showConfirm({
        title: 'Feld loeschen?',
        message: `Feld "${f.label || '(ohne Label)'}" loeschen? Enthaelt Text.`,
        variant: 'danger',
        confirmLabel: 'Loeschen',
      });
      if (!ok) return;
    }
    await wrap(() => delCellInfoField(p.cell.id, f.id), 'Feld geloescht.');
  }

  async function onAddLink() {
    const url = await showPrompt({
      title: 'Link hinzufuegen',
      message: 'URL:',
      initialValue: 'https://',
    });
    if (url == null) return;
    const clean = sanitizeUrl(url);
    if (!clean) {
      showToast('URL ungueltig.', 'error');
      return;
    }
    const label =
      (await showPrompt({
        title: 'Bezeichnung',
        message: 'Bezeichnung (optional):',
      })) ?? '';
    await wrap(() => addCellLink({ cellId: p.cell.id, label, url: clean }));
  }

  async function onRenameLink(l: InfoLink, label: string) {
    if (label === l.label) return;
    await wrap(() => setCellLinkLabel(p.cell.id, l.id, label));
  }

  async function onSetLinkUrl(l: InfoLink, url: string) {
    if (url === l.url) return;
    if (!sanitizeUrl(url)) {
      showToast('URL ungueltig.', 'error');
      return;
    }
    await wrap(() => setCellLinkUrl(p.cell.id, l.id, url));
  }

  async function onMoveLink(l: InfoLink, dir: -1 | 1) {
    await wrap(() => moveCellLink(p.cell.id, l.id, dir));
  }

  async function onDelLink(l: InfoLink) {
    await wrap(() => delCellLink(p.cell.id, l.id), 'Link geloescht.');
  }

  const breadcrumb = () => {
    const r = p.row?.label || '(Zeile)';
    const c = p.col?.label || '(Spalte)';
    return `${r} × ${c}`;
  };
  const matrixHref = () => `/w/${p.workspaceId}/n/${p.cell.matrix_id}`;

  return (
    <div class="cell-info-page">
      <header class="cell-page-head">
        <div class="cell-page-head-text">
          <h3>Info</h3>
          <a
            class="cell-page-sub cell-page-sub-link"
            href={matrixHref()}
            onClick={(e) => {
              e.preventDefault();
              navigate(matrixHref());
            }}
            title="Zur Matrix"
          >
            {breadcrumb()}
          </a>
          <Show when={p.cell.alias}>
            <span class="node-alias">^{p.cell.alias}</span>
          </Show>
        </div>
        <button
          type="button"
          class="btn-subtle cell-page-doc-btn"
          onClick={() =>
            openDocsPopup({
              sourceAlias: p.cell.alias ?? null,
              attachedCellId: p.cell.id,
            })
          }
          title="Neue Doku fuer diese Zelle"
        >
          + In Doku erfassen
        </button>
      </header>

      <Show
        when={fields().length > 0}
        fallback={
          <p class="hint">
            Keine Info-Felder.
            <Show when={editMode()}> + Feld unten.</Show>
          </p>
        }
      >
        <div class="info-list">
          <For each={fields()}>
            {(f) => (
              <div
                class="info-field"
                attr:data-edit={editMode() ? 'true' : 'false'}
                onMouseEnter={() => p.onFieldHover?.(f.id)}
                onMouseLeave={() => p.onFieldHover?.(undefined)}
              >
                <PresenceMini users={presenceByField().get(f.id) ?? []} />
                <div class="info-field-hd" classList={{ 'mx-editable': editMode() }}>
                  <div class="info-arrow-stack">
                    <button
                      type="button"
                      class="info-arrow"
                      title="Nach oben"
                      aria-label="Feld nach oben verschieben"
                      tabIndex={editMode() ? 0 : -1}
                      onClick={() => onMoveField(f, -1)}
                      disabled={busy() || !editMode()}
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      class="info-arrow"
                      title="Nach unten"
                      aria-label="Feld nach unten verschieben"
                      tabIndex={editMode() ? 0 : -1}
                      onClick={() => onMoveField(f, 1)}
                      disabled={busy() || !editMode()}
                    >
                      ▼
                    </button>
                  </div>
                  <input
                    class="mx-head-input info-label-input"
                    type="text"
                    value={f.label}
                    placeholder="(Feldname)"
                    readOnly={!editMode()}
                    tabIndex={editMode() ? 0 : -1}
                    onBlur={(e) => {
                      if (!editMode()) return;
                      onRenameField(f, e.currentTarget.value.trim());
                    }}
                    onKeyDown={(e) => {
                      if (!editMode()) return;
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        (e.currentTarget as HTMLInputElement).blur();
                      }
                    }}
                  />
                  <button
                    type="button"
                    class="mx-del-btn info-del"
                    title="Feld loeschen"
                    aria-label="Feld loeschen"
                    tabIndex={editMode() ? 0 : -1}
                    onClick={() => onDelField(f)}
                    disabled={busy() || !editMode()}
                  >
                    ✕
                  </button>
                </div>
                <Show
                  when={editMode()}
                  fallback={
                    <div class="info-val info-val-view" classList={{ 'info-val-empty': !f.value }}>
                      <Show when={f.value} fallback="(leer)">
                        <AliasText text={f.value} workspaceId={p.workspaceId} />
                      </Show>
                    </div>
                  }
                >
                  <textarea
                    class="info-val"
                    value={f.value}
                    placeholder="(Wert eingeben)"
                    tabIndex={0}
                    rows={3}
                    ref={(el) => {
                      const cleanup = bindAliasAutocomplete(el, p.workspaceId);
                      onCleanup(cleanup);
                    }}
                    onBlur={(e) => onSetValue(f, e.currentTarget.value)}
                  />
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={editMode()}>
        <button
          type="button"
          class="btn-subtle info-add-btn"
          onClick={onAddField}
          disabled={busy()}
        >
          + Feld
        </button>
      </Show>

      <section class="info-links-block">
        <h4 class="info-block-title">Links & Abspruenge</h4>
        <Show
          when={links().length > 0}
          fallback={
            <p class="hint">
              Keine Links.
              <Show when={editMode()}> + Link unten.</Show>
            </p>
          }
        >
          <ul class="info-link-list">
            <For each={links()}>
              {(l) => (
                <li
                  class="info-link"
                  attr:data-edit={editMode() ? 'true' : 'false'}
                  onMouseEnter={() => p.onFieldHover?.(l.id)}
                  onMouseLeave={() => p.onFieldHover?.(undefined)}
                >
                  <PresenceMini users={presenceByField().get(l.id) ?? []} />
                  <div class="info-link-hd" classList={{ 'mx-editable': editMode() }}>
                    <div class="info-arrow-stack">
                      <button
                        type="button"
                        class="info-arrow"
                        title="Nach oben"
                        aria-label="Link nach oben verschieben"
                        tabIndex={editMode() ? 0 : -1}
                        onClick={() => onMoveLink(l, -1)}
                        disabled={busy() || !editMode()}
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        class="info-arrow"
                        title="Nach unten"
                        aria-label="Link nach unten verschieben"
                        tabIndex={editMode() ? 0 : -1}
                        onClick={() => onMoveLink(l, 1)}
                        disabled={busy() || !editMode()}
                      >
                        ▼
                      </button>
                    </div>
                    <Show
                      when={editMode()}
                      fallback={
                        <a
                          class="info-link-label info-link-label-anchor"
                          href={sanitizeUrl(l.url) ?? '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={l.url}
                        >
                          {l.label || l.url}
                        </a>
                      }
                    >
                      <input
                        class="mx-head-input info-link-label-input"
                        type="text"
                        value={l.label}
                        placeholder="(Bezeichnung)"
                        onBlur={(e) => onRenameLink(l, e.currentTarget.value.trim())}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            (e.currentTarget as HTMLInputElement).blur();
                          }
                        }}
                      />
                    </Show>
                    <button
                      type="button"
                      class="mx-del-btn info-del"
                      title="Link loeschen"
                      aria-label="Link loeschen"
                      tabIndex={editMode() ? 0 : -1}
                      onClick={() => onDelLink(l)}
                      disabled={busy() || !editMode()}
                    >
                      ✕
                    </button>
                  </div>
                  <Show when={editMode()}>
                    <input
                      class="mx-head-input info-link-url-input"
                      type="url"
                      value={l.url}
                      placeholder="https://..."
                      onBlur={(e) => onSetLinkUrl(l, e.currentTarget.value.trim())}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          (e.currentTarget as HTMLInputElement).blur();
                        }
                      }}
                    />
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>

        <Show when={editMode()}>
          <button
            type="button"
            class="btn-subtle info-add-link-btn"
            onClick={onAddLink}
            disabled={busy()}
          >
            + Link
          </button>
        </Show>
      </section>

      <CellDocsSection
        cell={p.cell}
        workspaceId={p.workspaceId}
        realtimeVersion={p.realtimeDocsVersion}
      />
    </div>
  );
};

export default CellInfoPage;
