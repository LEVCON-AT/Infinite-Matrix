// Object-Detail-Page (Phase 3 Welle O.4) — Read-only erste Version.
//
// Zeigt fuer ein Object:
//   - Identity-Header: label, type-chip, ^o.alias-chip
//   - Strukturpfad: home_ref → node-Pfad (Workspace > Node > Row/Col)
//   - Backlinks-Sektion: alle Vorkommen ueber rows/cols/kb_cols/nodes
//     mit Click-Through zur jeweiligen Node-Seite
//   - Kinder-Sektion: parent_id-Children (mit Click-Through zum jeweiligen
//     Object-Detail)
//   - Gruppen-Sektion: groups die das Object enthalten
//   - Tags-Sektion: object_tags-Liste (resolved zu Tag-Object-Labels)
//   - Attribute-Sektion: attrs-jsonb als Key/Value-Liste
//
// Edit-Modus + Delete kommen mit O.4.C als Folge-Sprint.
//
// Routen-Pattern: Standalone, keine Workspace-Sidebar — der User
// navigiert hierhin gezielt aus einem Backlink, NodeTree-Object-Tab
// (O.7) oder Filter-Dashboard (O.5).

import { useNavigate, useParams } from '@solidjs/router';
import { type Component, For, Show, createMemo, createResource } from 'solid-js';
import Icon from '../components/Icon';
import { translateDbError } from '../lib/errors';
import {
  type ObjectBacklink,
  fetchObject,
  fetchObjectBacklinks,
  fetchObjectChildren,
  fetchObjectGroups,
  fetchObjectTags,
  fetchObjects,
} from '../lib/objects';
import { showToast } from '../lib/toasts';
import type { ObjectRow } from '../lib/types';

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

  const wsId = () => params.workspaceId;
  const objId = () => params.objectId;

  // Single-Object holen.
  const [obj, { mutate: _mutObj }] = createResource(objId, async (id) => {
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
  // Wir lesen alle Workspace-Objects einmal — nicht ueberragend skaliert,
  // aber bei < 5000 Objects akzeptabel. O.5 baut Index-Optimierungen.
  const [allObjects] = createResource(wsId, async (ws) => {
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

  const [children] = createResource(
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

  const [tags] = createResource(
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

  // Parent-Object aufloesen (fuer Strukturpfad-Hint).
  const parentObject = createMemo<ObjectRow | null>(() => {
    const o = obj();
    if (!o?.parent_id) return null;
    return objectMap().get(o.parent_id) ?? null;
  });

  function navToBacklink(b: ObjectBacklink) {
    // Zur Node-Seite — Row/Col/Kb_col scrollen wir nicht heran (das
    // braeuchte Hash-Scroll-Pattern wie in NodeTree). Erste Version
    // bringt User auf die Matrix/Board, die das Vorkommen enthaelt.
    navigate(`/w/${wsId()}/n/${b.node_id}`);
  }

  function navToObject(id: string) {
    navigate(`/w/${wsId()}/o/${id}`);
  }

  function navBack() {
    // Versuche aus dem Browser-Verlauf zurueck — sonst Workspace-Root.
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    navigate(`/w/${wsId()}`);
  }

  return (
    <div class="obj-detail-page">
      <header class="obj-detail-head">
        <button type="button" class="obj-detail-back" onClick={navBack} aria-label="Zurueck">
          <Icon name="arrow-left" size={18} />
          <span>Zurueck</span>
        </button>
        <Show when={obj.loading}>
          <p class="hint">Lade Object…</p>
        </Show>
        <Show when={!obj.loading && !obj()}>
          <p class="hint">Object nicht gefunden.</p>
        </Show>
      </header>

      <Show when={obj()}>
        {(o) => (
          <div class="obj-detail-body">
            <section class="obj-detail-identity">
              <div class="obj-detail-identity-row">
                <h1 class="obj-detail-label">{o().label || '(ohne Label)'}</h1>
                <Show when={o().type_label}>
                  {(typeLabel) => <span class="obj-type-chip">{typeLabel()}</span>}
                </Show>
              </div>
              <Show when={o().alias}>{(alias) => <p class="obj-alias-chip">^o.{alias()}</p>}</Show>
              <Show when={parentObject()}>
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
                  </p>
                )}
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
              <h2 class="obj-detail-section-title">
                <Icon name="tag" size={16} />
                <span>Tags ({tags()?.length ?? 0})</span>
              </h2>
              <Show when={(tags() ?? []).length > 0} fallback={<p class="hint">Keine Tags.</p>}>
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
                        </li>
                      );
                    }}
                  </For>
                </ul>
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
          </div>
        )}
      </Show>
    </div>
  );
};

export default ObjectDetail;
