// Object-Detail-Page (Phase 3 Welle O.4) — Read + Edit.
//
// Zeigt fuer ein Object: Identity (label/alias/type/parent), Backlinks,
// Kinder, Gruppen, Tags, Attribute. Edit-Toggle (Pencil-Button) macht
// Identity-Felder editierbar; Tag-Add/-Remove und Parent-Pick laufen
// ueber das ObjectSuggest-Singleton (Pattern aus MatrixView/BoardView).
//
// Routen-Pattern: Standalone, keine Workspace-Sidebar — User navigiert
// hierhin gezielt aus Backlink, NodeTree-Object-Tab (O.7) oder Filter-
// Dashboard (O.5).

import { useNavigate, useParams } from '@solidjs/router';
import { type Component, For, Show, createMemo, createSignal } from 'solid-js';
import { createResource } from 'solid-js';
import Icon from '../components/Icon';
import ObjectSuggestion from '../components/ObjectSuggestion';
import { showConfirm } from '../lib/dialog';
import { translateDbError } from '../lib/errors';
import {
  type ObjectBacklink,
  addObjectTag,
  deleteObject,
  fetchObject,
  fetchObjectBacklinks,
  fetchObjectChildren,
  fetchObjectGroups,
  fetchObjectTags,
  fetchObjects,
  removeObjectTag,
  setObjectParent,
  updateObject,
} from '../lib/objects';
import { showToast } from '../lib/toasts';
import type { ObjectRow } from '../lib/types';
import {
  closeObjectSuggest,
  commitObjectSuggest,
  navigateObjectSuggest,
  objectSuggestState,
  openObjectSuggest,
} from '../lib/use-object-suggest';
import { useViewerActive } from '../lib/workspace-role';

type RouteParams = { workspaceId: string; objectId: string };

const KIND_LABEL: Record<ObjectBacklink['kind'], string> = {
  row: 'Zeile',
  col: 'Spalte',
  kb_col: 'Board-Spalte',
  node: 'Node',
};

const KIND_ICON: Record<ObjectBacklink['kind'], 'list-bullet' | 'view-columns' | 'squares-2x2'> = {
  row: 'list-bullet',
  col: 'view-columns',
  kb_col: 'view-columns',
  node: 'squares-2x2',
};

const ObjectDetail: Component = () => {
  const params = useParams<RouteParams>();
  const navigate = useNavigate();
  const viewerActive = useViewerActive();

  const wsId = () => params.workspaceId;
  const objId = () => params.objectId;

  const [editMode, setEditMode] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  // Pro Identity-Feld eigener Draft-State, Reset beim Toggle off.
  const [draftLabel, setDraftLabel] = createSignal('');
  const [draftAlias, setDraftAlias] = createSignal('');
  const [draftType, setDraftType] = createSignal('');
  // Inline-Picker fuer Parent + Tag-Add.
  const [pickerKind, setPickerKind] = createSignal<'parent' | 'tag' | null>(null);
  const [pickerInput, setPickerInput] = createSignal('');

  // Single-Object holen.
  const [obj, { refetch: refetchObj }] = createResource(objId, async (id) => {
    if (!id) return null;
    try {
      return await fetchObject(id);
    } catch (err) {
      console.error('fetchObject:', err);
      showToast(translateDbError(err, 'Object konnte nicht geladen werden.'), 'error');
      return null;
    }
  });

  // Workspace-Object-Index fuer Tag-Resolution (Tag IST ein Object).
  // Wir lesen alle Workspace-Objects einmal — bei < 5000 Objects
  // akzeptabel. O.5 baut Index-Optimierungen.
  const [allObjects, { refetch: refetchAllObjects }] = createResource(wsId, async (ws) => {
    if (!ws) return [];
    try {
      return await fetchObjects(ws);
    } catch (err) {
      console.error('fetchObjects:', err);
      return [];
    }
  });
  const objectMap = createMemo(() => {
    const map = new Map<string, ObjectRow>();
    for (const o of allObjects() ?? []) map.set(o.id, o);
    return map;
  });

  const [backlinks] = createResource(
    () => ({ ws: wsId(), id: objId() }),
    async (k) => {
      if (!k.ws || !k.id) return [];
      try {
        return await fetchObjectBacklinks(k.ws, k.id);
      } catch (err) {
        console.error('fetchObjectBacklinks:', err);
        return [];
      }
    },
  );

  const [children, { refetch: refetchChildren }] = createResource(
    () => ({ ws: wsId(), id: objId() }),
    async (k) => {
      if (!k.ws || !k.id) return [];
      try {
        return await fetchObjectChildren(k.ws, k.id);
      } catch (err) {
        console.error('fetchObjectChildren:', err);
        return [];
      }
    },
  );

  const [groups] = createResource(
    () => ({ ws: wsId(), id: objId() }),
    async (k) => {
      if (!k.ws || !k.id) return [];
      try {
        return await fetchObjectGroups(k.ws, k.id);
      } catch (err) {
        console.error('fetchObjectGroups:', err);
        return [];
      }
    },
  );

  const [tags, { refetch: refetchTags }] = createResource(
    () => ({ ws: wsId(), id: objId() }),
    async (k) => {
      if (!k.ws || !k.id) return [];
      try {
        return await fetchObjectTags(k.ws, k.id);
      } catch (err) {
        console.error('fetchObjectTags:', err);
        return [];
      }
    },
  );

  const parentObject = createMemo<ObjectRow | null>(() => {
    const o = obj();
    if (!o?.parent_id) return null;
    return objectMap().get(o.parent_id) ?? null;
  });

  const canEdit = () => !viewerActive();

  function navToBacklink(b: ObjectBacklink) {
    navigate(`/w/${wsId()}/n/${b.node_id}`);
  }

  function navToObject(id: string) {
    navigate(`/w/${wsId()}/o/${id}`);
  }

  function navBack() {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    navigate(`/w/${wsId()}`);
  }

  function enterEdit() {
    const o = obj();
    if (!o) return;
    setDraftLabel(o.label ?? '');
    setDraftAlias(o.alias ?? '');
    setDraftType(o.type_label ?? '');
    setEditMode(true);
  }

  function cancelEdit() {
    setEditMode(false);
    setPickerKind(null);
    setPickerInput('');
    closeObjectSuggest();
  }

  async function saveIdentity() {
    if (busy()) return;
    const o = obj();
    if (!o) return;
    const newLabel = draftLabel().trim();
    if (!newLabel) {
      showToast('Label darf nicht leer sein.', 'error');
      return;
    }
    setBusy(true);
    try {
      await updateObject({
        objectId: o.id,
        label: newLabel,
        // '' = clear server-side, undefined = nicht aendern.
        alias: draftAlias().trim(),
        typeLabel: draftType().trim(),
      });
      showToast('Object gespeichert.', 'success');
      setEditMode(false);
      void refetchObj();
      void refetchAllObjects();
    } catch (err) {
      console.error('updateObject:', err);
      showToast(translateDbError(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  // ─── Tag-Add via Inline-Picker ──────────────────────────────
  function openTagPicker(anchor: HTMLInputElement) {
    setPickerKind('tag');
    openObjectSuggest({
      anchor,
      workspaceId: wsId(),
      query: pickerInput(),
      currentObjectId: objId(),
      onPick: (hit) => {
        if (!hit) return;
        void doAddTag(hit.id);
      },
    });
  }

  async function doAddTag(tagId: string) {
    const o = obj();
    if (!o || tagId === o.id) return;
    if ((tags() ?? []).some((t) => t.tag_object_id === tagId)) {
      showToast('Tag bereits vergeben.', 'info');
      setPickerKind(null);
      setPickerInput('');
      closeObjectSuggest();
      return;
    }
    try {
      await addObjectTag(o.id, tagId);
      showToast('Tag hinzugefuegt.', 'success');
      void refetchTags();
    } catch (err) {
      console.error('addObjectTag:', err);
      showToast(translateDbError(err), 'error');
    } finally {
      setPickerKind(null);
      setPickerInput('');
      closeObjectSuggest();
    }
  }

  async function removeTag(tagObjectId: string) {
    const o = obj();
    if (!o) return;
    try {
      await removeObjectTag(o.id, tagObjectId);
      showToast('Tag entfernt.', 'success');
      void refetchTags();
    } catch (err) {
      console.error('removeObjectTag:', err);
      showToast(translateDbError(err), 'error');
    }
  }

  // ─── Parent-Pick via Inline-Picker ──────────────────────────
  function openParentPicker(anchor: HTMLInputElement) {
    setPickerKind('parent');
    openObjectSuggest({
      anchor,
      workspaceId: wsId(),
      query: pickerInput(),
      currentObjectId: objId(),
      onPick: (hit) => {
        if (!hit) return;
        void doSetParent(hit.id);
      },
    });
  }

  async function doSetParent(parentId: string | null) {
    const o = obj();
    if (!o || parentId === o.id) return;
    try {
      await setObjectParent(o.id, parentId);
      showToast(parentId ? 'Eltern-Object gesetzt.' : 'Eltern-Object entfernt.', 'success');
      void refetchObj();
      void refetchChildren();
    } catch (err) {
      console.error('setObjectParent:', err);
      showToast(translateDbError(err), 'error');
    } finally {
      setPickerKind(null);
      setPickerInput('');
      closeObjectSuggest();
    }
  }

  // ─── Picker-Input-Keyboard ──────────────────────────────────
  function onPickerKey(e: KeyboardEvent & { currentTarget: HTMLInputElement }) {
    if (e.key === 'ArrowDown' && objectSuggestState().open) {
      e.preventDefault();
      navigateObjectSuggest('down');
      return;
    }
    if (e.key === 'ArrowUp' && objectSuggestState().open) {
      e.preventDefault();
      navigateObjectSuggest('up');
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setPickerKind(null);
      setPickerInput('');
      closeObjectSuggest();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const hit = commitObjectSuggest();
      // Wenn nichts highlighted, schliesse Picker still.
      if (!hit) {
        setPickerKind(null);
        setPickerInput('');
        closeObjectSuggest();
      }
      // Bei hit: onPick wurde durch commitObjectSuggest aufgerufen,
      // doAddTag/doSetParent erledigt das Aufraeumen.
    }
  }

  function onPickerInput(e: InputEvent & { currentTarget: HTMLInputElement }) {
    const v = e.currentTarget.value;
    setPickerInput(v);
    if (v.trim().length >= 1) {
      const kind = pickerKind();
      if (kind === 'tag') openTagPicker(e.currentTarget);
      else if (kind === 'parent') openParentPicker(e.currentTarget);
    } else {
      closeObjectSuggest();
    }
  }

  // ─── Delete-Pfad ────────────────────────────────────────────
  async function onDelete() {
    if (busy()) return;
    const o = obj();
    if (!o) return;
    const refsCount = (backlinks() ?? []).length;
    const message =
      refsCount > 0
        ? `"${o.label}" loeschen? Wird aus ${refsCount} Vorkommen entfernt — Zeilen/Spalten bleiben, verlieren nur die Object-Verknuepfung.`
        : `"${o.label}" loeschen?`;
    const ok = await showConfirm({
      title: 'Object loeschen?',
      message,
      variant: 'danger',
      confirmLabel: 'Loeschen',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteObject(o.id);
      showToast('Object geloescht.', 'success');
      navBack();
    } catch (err) {
      console.error('deleteObject:', err);
      showToast(translateDbError(err), 'error');
      setBusy(false);
    }
  }

  return (
    <div class="obj-detail-page">
      <header class="obj-detail-head">
        <button type="button" class="obj-detail-back" onClick={navBack} aria-label="Zurueck">
          <Icon name="arrow-left" size={18} />
          <span>Zurueck</span>
        </button>
        <div class="obj-detail-head-spacer" />
        <Show when={obj.loading}>
          <p class="hint">Lade Object…</p>
        </Show>
        <Show when={!obj.loading && !obj()}>
          <p class="hint">Object nicht gefunden.</p>
        </Show>
        <Show when={obj() && canEdit()}>
          <Show
            when={editMode()}
            fallback={
              <button
                type="button"
                class="obj-detail-edit-btn"
                onClick={enterEdit}
                title="Object bearbeiten"
              >
                <Icon name="pencil" size={16} />
                <span>Bearbeiten</span>
              </button>
            }
          >
            <button type="button" class="btn-subtle" onClick={cancelEdit} disabled={busy()}>
              Abbrechen
            </button>
            <button type="button" class="btn btn-p" onClick={saveIdentity} disabled={busy()}>
              Speichern
            </button>
          </Show>
        </Show>
      </header>

      <Show when={obj()}>
        {(o) => (
          <div class="obj-detail-body">
            <section class="obj-detail-identity">
              <Show
                when={editMode()}
                fallback={
                  <>
                    <div class="obj-detail-identity-row">
                      <h1 class="obj-detail-label">{o().label || '(ohne Label)'}</h1>
                      <Show when={o().type_label}>
                        {(typeLabel) => <span class="obj-type-chip">{typeLabel()}</span>}
                      </Show>
                    </div>
                    <Show when={o().alias}>
                      {(alias) => <p class="obj-alias-chip">^o.{alias()}</p>}
                    </Show>
                  </>
                }
              >
                <div class="obj-detail-edit-form">
                  <label class="obj-detail-field">
                    <span class="obj-detail-field-label">Label</span>
                    <input
                      type="text"
                      class="obj-detail-input"
                      value={draftLabel()}
                      onInput={(e) => setDraftLabel(e.currentTarget.value)}
                      placeholder="Label"
                    />
                  </label>
                  <label class="obj-detail-field">
                    <span class="obj-detail-field-label">Alias (^o.&lt;slug&gt;, optional)</span>
                    <input
                      type="text"
                      class="obj-detail-input"
                      value={draftAlias()}
                      onInput={(e) => setDraftAlias(e.currentTarget.value)}
                      placeholder="kunde-mueller"
                    />
                  </label>
                  <label class="obj-detail-field">
                    <span class="obj-detail-field-label">Type (frei, optional)</span>
                    <input
                      type="text"
                      class="obj-detail-input"
                      value={draftType()}
                      onInput={(e) => setDraftType(e.currentTarget.value)}
                      placeholder="z.B. Kunde, Hunderasse"
                    />
                  </label>
                </div>
              </Show>

              <Show
                when={parentObject()}
                fallback={
                  <Show when={editMode() && pickerKind() !== 'parent'}>
                    <p class="obj-parent-line">
                      <button
                        type="button"
                        class="obj-parent-pick-btn"
                        onClick={() => setPickerKind('parent')}
                      >
                        + Eltern-Object setzen
                      </button>
                    </p>
                  </Show>
                }
              >
                {(parent) => (
                  <p class="obj-parent-line">
                    <span class="obj-parent-label">Eltern-Object:</span>{' '}
                    <button
                      type="button"
                      class="obj-parent-link"
                      onClick={() => navToObject(parent().id)}
                    >
                      {parent().label || '(ohne Label)'}
                    </button>
                    <Show when={editMode()}>
                      <button
                        type="button"
                        class="obj-parent-clear-btn"
                        onClick={() => void doSetParent(null)}
                        title="Eltern-Object entfernen"
                        aria-label="Eltern-Object entfernen"
                      >
                        <Icon name="x" size={12} />
                      </button>
                      <button
                        type="button"
                        class="obj-parent-pick-btn"
                        onClick={() => setPickerKind('parent')}
                      >
                        ändern
                      </button>
                    </Show>
                  </p>
                )}
              </Show>
              <Show when={editMode() && pickerKind() === 'parent'}>
                <div class="obj-picker-row">
                  <input
                    type="text"
                    class="obj-detail-input obj-picker-input"
                    value={pickerInput()}
                    placeholder="Object suchen…"
                    onInput={onPickerInput}
                    onKeyDown={onPickerKey}
                    ref={(el) => queueMicrotask(() => el.focus())}
                  />
                  <button
                    type="button"
                    class="btn-subtle"
                    onClick={() => {
                      setPickerKind(null);
                      setPickerInput('');
                      closeObjectSuggest();
                    }}
                  >
                    Abbrechen
                  </button>
                </div>
              </Show>
            </section>

            <section class="obj-detail-section">
              <h2 class="obj-detail-section-title">
                <Icon name="link" size={16} />
                <span>Backlinks ({backlinks()?.length ?? 0})</span>
              </h2>
              <Show
                when={(backlinks() ?? []).length > 0}
                fallback={
                  <p class="hint">
                    Object ist noch nicht in einer Matrix oder einem Board gelandet.
                  </p>
                }
              >
                <ul class="obj-backlink-list">
                  <For each={backlinks() ?? []}>
                    {(b) => (
                      <li class="obj-backlink-item">
                        <button
                          type="button"
                          class="obj-backlink-btn"
                          onClick={() => navToBacklink(b)}
                          title={`Zu ${b.node_label || b.node_type}`}
                        >
                          <Icon name={KIND_ICON[b.kind]} size={14} />
                          <span class="obj-backlink-kind">{KIND_LABEL[b.kind]}</span>
                          <span class="obj-backlink-ref">{b.ref_label || '(leer)'}</span>
                          <span class="obj-backlink-sep">in</span>
                          <span class="obj-backlink-node">{b.node_label || '(ohne Label)'}</span>
                          <Show when={b.node_type}>
                            {(t) => <span class="obj-backlink-node-type">{t()}</span>}
                          </Show>
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </section>

            <section class="obj-detail-section">
              <h2 class="obj-detail-section-title">
                <Icon name="squares-2x2" size={16} />
                <span>Kinder ({children()?.length ?? 0})</span>
              </h2>
              <Show
                when={(children() ?? []).length > 0}
                fallback={<p class="hint">Keine untergeordneten Objects.</p>}
              >
                <ul class="obj-children-list">
                  <For each={children() ?? []}>
                    {(c) => (
                      <li class="obj-children-item">
                        <button
                          type="button"
                          class="obj-children-btn"
                          onClick={() => navToObject(c.id)}
                        >
                          <span class="obj-children-label">{c.label || '(ohne Label)'}</span>
                          <Show when={c.type_label}>
                            {(t) => <span class="obj-type-chip obj-type-chip-sm">{t()}</span>}
                          </Show>
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </section>

            <section class="obj-detail-section">
              <h2 class="obj-detail-section-title">
                <Icon name="users" size={16} />
                <span>Gruppen ({groups()?.length ?? 0})</span>
              </h2>
              <Show
                when={(groups() ?? []).length > 0}
                fallback={<p class="hint">Object ist in keiner Gruppe.</p>}
              >
                <ul class="obj-group-list">
                  <For each={groups() ?? []}>
                    {(g) => (
                      <li class="obj-group-chip">
                        <Icon name="users" size={12} />
                        <span>{g.name}</span>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </section>

            <section class="obj-detail-section">
              <div class="obj-detail-section-title-row">
                <h2 class="obj-detail-section-title">
                  <Icon name="tag" size={16} />
                  <span>Tags ({tags()?.length ?? 0})</span>
                </h2>
                <Show when={editMode() && pickerKind() !== 'tag'}>
                  <button
                    type="button"
                    class="obj-tag-add-btn"
                    onClick={() => setPickerKind('tag')}
                  >
                    + Tag
                  </button>
                </Show>
              </div>
              <Show
                when={(tags() ?? []).length > 0 || editMode()}
                fallback={<p class="hint">Keine Tags.</p>}
              >
                <ul class="obj-tag-list">
                  <For each={tags() ?? []}>
                    {(t) => {
                      const tagObj = () => objectMap().get(t.tag_object_id);
                      return (
                        <li class="obj-tag-chip">
                          <Icon name="tag" size={12} />
                          <button
                            type="button"
                            class="obj-tag-btn"
                            onClick={() => navToObject(t.tag_object_id)}
                          >
                            {tagObj()?.label ?? '(unbekannt)'}
                          </button>
                          <Show when={editMode()}>
                            <button
                              type="button"
                              class="obj-tag-remove-btn"
                              onClick={() => void removeTag(t.tag_object_id)}
                              aria-label="Tag entfernen"
                              title="Tag entfernen"
                            >
                              <Icon name="x" size={10} />
                            </button>
                          </Show>
                        </li>
                      );
                    }}
                  </For>
                </ul>
              </Show>
              <Show when={editMode() && pickerKind() === 'tag'}>
                <div class="obj-picker-row">
                  <input
                    type="text"
                    class="obj-detail-input obj-picker-input"
                    value={pickerInput()}
                    placeholder="Tag-Object suchen…"
                    onInput={onPickerInput}
                    onKeyDown={onPickerKey}
                    ref={(el) => queueMicrotask(() => el.focus())}
                  />
                  <button
                    type="button"
                    class="btn-subtle"
                    onClick={() => {
                      setPickerKind(null);
                      setPickerInput('');
                      closeObjectSuggest();
                    }}
                  >
                    Abbrechen
                  </button>
                </div>
              </Show>
            </section>

            <section class="obj-detail-section">
              <h2 class="obj-detail-section-title">
                <Icon name="information-circle" size={16} />
                <span>Attribute</span>
              </h2>
              <Show
                when={Object.keys(o().attrs ?? {}).length > 0}
                fallback={<p class="hint">Keine Attribute gepflegt.</p>}
              >
                <dl class="obj-attrs-list">
                  <For each={Object.entries(o().attrs ?? {})}>
                    {([k, v]) => (
                      <>
                        <dt class="obj-attr-key">{k}</dt>
                        <dd class="obj-attr-val">
                          {typeof v === 'string' ? v : JSON.stringify(v)}
                        </dd>
                      </>
                    )}
                  </For>
                </dl>
              </Show>
            </section>

            <Show when={editMode()}>
              <footer class="obj-detail-foot">
                <button
                  type="button"
                  class="btn-danger"
                  onClick={() => void onDelete()}
                  disabled={busy()}
                  title="Object loeschen"
                >
                  <Icon name="trash" size={14} />
                  <span>Object loeschen</span>
                </button>
              </footer>
            </Show>
          </div>
        )}
      </Show>

      <ObjectSuggestion />
    </div>
  );
};

export default ObjectDetail;
