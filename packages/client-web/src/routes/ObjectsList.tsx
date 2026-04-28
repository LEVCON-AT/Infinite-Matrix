// Object-Liste + Filter-Dashboard (Phase 3 Welle O.4.D / O.5).
//
// Filter-Erweiterung in O.5:
//   - Tag-Multi-Select (AND-Match)
//   - Group-Filter (Dropdown)
//   - Parent-Filter mit recursive descendants (alle Kinder + Enkel von X)
//   - Reset-Filter-Button
//
// Datenmenge: alle Objects + alle Backlinks + alle object_tags + alle
// group_members + alle groups workspace-weit auf einmal. Akzeptabel
// bis ~5000 Objects / ~50k Mappings; daruber Server-side-Filter (O.10).

import { useNavigate, useParams } from '@solidjs/router';
import { type Component, For, Show, createMemo, createResource, createSignal } from 'solid-js';
import GroupMatrixGenerator from '../components/GroupMatrixGenerator';
import Icon from '../components/Icon';
import { translateDbError } from '../lib/errors';
import {
  fetchAllBacklinks,
  fetchAllGroupMembers,
  fetchAllObjectTags,
  fetchGroups,
  fetchObjects,
} from '../lib/objects';
import { showToast } from '../lib/toasts';

type RouteParams = { workspaceId: string };

const ObjectsList: Component = () => {
  const params = useParams<RouteParams>();
  const navigate = useNavigate();
  const wsId = () => params.workspaceId;

  const [search, setSearch] = createSignal('');
  const [typeFilter, setTypeFilter] = createSignal<string>('');
  const [generatorOpen, setGeneratorOpen] = createSignal(false);
  // O.5: Tag-Multi-Select als Set fuer toggle-Pattern. AND-Match.
  const [tagFilter, setTagFilter] = createSignal<Set<string>>(new Set());
  const [groupFilter, setGroupFilter] = createSignal<string>('');
  const [parentFilter, setParentFilter] = createSignal<string>('');

  const [objects] = createResource(wsId, async (ws) => {
    if (!ws) return [];
    try {
      return await fetchObjects(ws);
    } catch (err) {
      console.error('fetchObjects:', err);
      showToast(translateDbError(err, 'Objekte konnten nicht geladen werden.'), 'error');
      return [];
    }
  });

  const [backlinks] = createResource(wsId, async (ws) => {
    if (!ws) return [];
    try {
      return await fetchAllBacklinks(ws);
    } catch (err) {
      console.error('fetchAllBacklinks:', err);
      return [];
    }
  });

  const [groups] = createResource(wsId, async (ws) => {
    if (!ws) return [];
    try {
      return await fetchGroups(ws);
    } catch (err) {
      console.error('fetchGroups:', err);
      return [];
    }
  });

  const [allTags] = createResource(wsId, async (ws) => {
    if (!ws) return [];
    try {
      return await fetchAllObjectTags(ws);
    } catch (err) {
      console.error('fetchAllObjectTags:', err);
      return [];
    }
  });

  const [allGroupMembers] = createResource(wsId, async (ws) => {
    if (!ws) return [];
    try {
      return await fetchAllGroupMembers(ws);
    } catch (err) {
      console.error('fetchAllGroupMembers:', err);
      return [];
    }
  });

  // ─── Indices fuer Filter-Performance ───────────────────────
  const backlinkCount = createMemo(() => {
    const map = new Map<string, number>();
    for (const b of backlinks() ?? []) {
      map.set(b.object_id, (map.get(b.object_id) ?? 0) + 1);
    }
    return map;
  });

  // object_id → Set<tag_object_id>.
  const tagsByObject = createMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const t of allTags() ?? []) {
      let s = map.get(t.object_id);
      if (!s) {
        s = new Set();
        map.set(t.object_id, s);
      }
      s.add(t.tag_object_id);
    }
    return map;
  });

  // group_id → Set<object_id>.
  const objectsByGroup = createMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const m of allGroupMembers() ?? []) {
      let s = map.get(m.group_id);
      if (!s) {
        s = new Set();
        map.set(m.group_id, s);
      }
      s.add(m.object_id);
    }
    return map;
  });

  // parent_id → child object_ids (1 Level). Fuer Recursive-Descendants-DFS.
  const childrenByParent = createMemo(() => {
    const map = new Map<string, string[]>();
    for (const o of objects() ?? []) {
      if (!o.parent_id) continue;
      const arr = map.get(o.parent_id);
      if (arr) arr.push(o.id);
      else map.set(o.parent_id, [o.id]);
    }
    return map;
  });

  // Recursive-Walk: alle descendant ids von parentId (inkl. parentId selbst).
  const descendantsOfParent = createMemo<Set<string>>(() => {
    const root = parentFilter();
    if (!root) return new Set();
    const out = new Set<string>([root]);
    const stack = [root];
    const idx = childrenByParent();
    let steps = 0;
    while (stack.length > 0 && steps < 10000) {
      const cur = stack.pop();
      if (cur === undefined) break;
      const kids = idx.get(cur) ?? [];
      for (const kid of kids) {
        if (out.has(kid)) continue;
        out.add(kid);
        stack.push(kid);
      }
      steps++;
    }
    return out;
  });

  // Welche Tag-Objects sind tatsaechlich als Tag verwendet (≥ 1 Vorkommen)?
  // Fuer Tag-Filter-UI: nur sinnvolle Optionen anbieten.
  const tagOptions = createMemo(() => {
    const counts = new Map<string, number>();
    for (const t of allTags() ?? []) {
      counts.set(t.tag_object_id, (counts.get(t.tag_object_id) ?? 0) + 1);
    }
    const objMap = new Map((objects() ?? []).map((o) => [o.id, o]));
    return Array.from(counts.entries())
      .map(([tagId, count]) => ({
        id: tagId,
        label: objMap.get(tagId)?.label ?? '(unbekannt)',
        count,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  // Welche Objects sind potentielle Eltern (haben Kinder)?
  const parentOptions = createMemo(() => {
    const idx = childrenByParent();
    const objMap = new Map((objects() ?? []).map((o) => [o.id, o]));
    return Array.from(idx.keys())
      .map((id) => ({ id, label: objMap.get(id)?.label ?? '(unbekannt)' }))
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  const typeOptions = createMemo<string[]>(() => {
    const set = new Set<string>();
    for (const o of objects() ?? []) {
      if (o.type_label) set.add(o.type_label);
    }
    return Array.from(set).sort();
  });

  const filtered = createMemo(() => {
    const list = objects() ?? [];
    const q = search().trim().toLowerCase();
    const t = typeFilter();
    const tags = tagFilter();
    const group = groupFilter();
    const parent = parentFilter();
    const groupMembers = group ? objectsByGroup().get(group) : null;
    const descendants = parent ? descendantsOfParent() : null;
    const objTags = tagsByObject();

    return list.filter((o) => {
      if (q && !o.label.toLowerCase().includes(q) && !(o.alias ?? '').toLowerCase().includes(q)) {
        return false;
      }
      if (t && o.type_label !== t) return false;
      if (group && groupMembers && !groupMembers.has(o.id)) return false;
      if (parent && descendants && !descendants.has(o.id)) return false;
      if (tags.size > 0) {
        const own = objTags.get(o.id);
        if (!own) return false;
        for (const tag of tags) {
          if (!own.has(tag)) return false;
        }
      }
      return true;
    });
  });

  const hasActiveFilters = () =>
    !!search() || !!typeFilter() || tagFilter().size > 0 || !!groupFilter() || !!parentFilter();

  function resetFilters() {
    setSearch('');
    setTypeFilter('');
    setTagFilter(new Set<string>());
    setGroupFilter('');
    setParentFilter('');
  }

  function toggleTag(tagId: string) {
    setTagFilter((s) => {
      const next = new Set(s);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }

  function navBack() {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    navigate(`/w/${wsId()}`);
  }

  function navToObject(id: string) {
    navigate(`/w/${wsId()}/o/${id}`);
  }

  return (
    <div class="objects-list-page">
      <header class="objects-list-head">
        <button type="button" class="obj-detail-back" onClick={navBack} aria-label="Zurueck">
          <Icon name="arrow-left" size={18} />
          <span>Zurueck</span>
        </button>
        <h1 class="objects-list-title">Objekte</h1>
        <Show when={objects.loading}>
          <span class="hint">Lade…</span>
        </Show>
        <span class="objects-list-head-spacer" />
        <Show when={(groups() ?? []).length > 0}>
          <button
            type="button"
            class="objects-list-generator-btn"
            onClick={() => setGeneratorOpen(true)}
            title="Aus zwei Gruppen eine neue Matrix bauen"
          >
            <Icon name="squares-2x2" size={14} />
            <span>Matrix aus Gruppen</span>
          </button>
        </Show>
      </header>

      <div class="objects-list-filters">
        <div class="objects-list-search">
          <Icon name="search" size={14} />
          <input
            type="text"
            class="objects-list-search-input"
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
            placeholder="Label oder ^o.alias suchen…"
          />
          <Show when={search()}>
            <button
              type="button"
              class="objects-list-search-clear"
              onClick={() => setSearch('')}
              aria-label="Suche leeren"
            >
              <Icon name="x" size={12} />
            </button>
          </Show>
        </div>
        <Show when={typeOptions().length > 0}>
          <select
            class="objects-list-type-filter"
            value={typeFilter()}
            onChange={(e) => setTypeFilter(e.currentTarget.value)}
          >
            <option value="">Alle Typen</option>
            <For each={typeOptions()}>{(t) => <option value={t}>{t}</option>}</For>
          </select>
        </Show>
        <Show when={(groups() ?? []).length > 0}>
          <select
            class="objects-list-type-filter"
            value={groupFilter()}
            onChange={(e) => setGroupFilter(e.currentTarget.value)}
            title="Gruppen-Filter"
          >
            <option value="">Alle Gruppen</option>
            <For each={groups() ?? []}>{(g) => <option value={g.id}>{g.name}</option>}</For>
          </select>
        </Show>
        <Show when={parentOptions().length > 0}>
          <select
            class="objects-list-type-filter"
            value={parentFilter()}
            onChange={(e) => setParentFilter(e.currentTarget.value)}
            title="Parent-Filter (recursive Children)"
          >
            <option value="">Alle Eltern</option>
            <For each={parentOptions()}>{(p) => <option value={p.id}>↳ {p.label}</option>}</For>
          </select>
        </Show>
        <span class="objects-list-count">
          {filtered().length} / {objects()?.length ?? 0}
        </span>
        <Show when={hasActiveFilters()}>
          <button
            type="button"
            class="objects-list-reset-btn"
            onClick={resetFilters}
            title="Alle Filter zuruecksetzen"
          >
            <Icon name="x" size={12} />
            <span>Filter zuruecksetzen</span>
          </button>
        </Show>
      </div>

      <Show when={tagOptions().length > 0}>
        <div class="objects-list-tags">
          <span class="objects-list-tags-label">Tags:</span>
          <For each={tagOptions()}>
            {(t) => (
              <button
                type="button"
                class="objects-list-tag-chip"
                classList={{ active: tagFilter().has(t.id) }}
                onClick={() => toggleTag(t.id)}
                title={`${t.count}× verwendet`}
              >
                <Icon name="tag" size={11} />
                <span>{t.label}</span>
                <span class="objects-list-tag-count">{t.count}</span>
              </button>
            )}
          </For>
        </div>
      </Show>

      <Show
        when={filtered().length > 0}
        fallback={
          <p class="hint objects-list-empty">
            <Show
              when={(objects()?.length ?? 0) === 0}
              fallback={<>Kein Treffer fuer den aktuellen Filter.</>}
            >
              Noch keine Objekte. Lege eine Zeile/Spalte/Karte an — Auto-Object-Anlage uebernimmt
              den Rest.
            </Show>
          </p>
        }
      >
        <ul class="objects-list">
          <For each={filtered()}>
            {(o) => {
              const cnt = () => backlinkCount().get(o.id) ?? 0;
              return (
                <li>
                  <button type="button" class="objects-list-item" onClick={() => navToObject(o.id)}>
                    <span class="objects-list-item-label">{o.label || '(ohne Label)'}</span>
                    <Show when={o.type_label}>
                      {(t) => <span class="obj-type-chip obj-type-chip-sm">{t()}</span>}
                    </Show>
                    <Show when={o.alias}>
                      {(a) => <span class="objects-list-item-alias">^o.{a()}</span>}
                    </Show>
                    <span class="objects-list-item-spacer" />
                    <Show when={cnt() > 0}>
                      <span class="objects-list-item-count" title="Backlinks">
                        {cnt()}× verlinkt
                      </span>
                    </Show>
                    <Icon name="chevron-right" size={14} />
                  </button>
                </li>
              );
            }}
          </For>
        </ul>
      </Show>

      <Show when={generatorOpen()}>
        <GroupMatrixGenerator workspaceId={wsId()} onClose={() => setGeneratorOpen(false)} />
      </Show>
    </div>
  );
};

export default ObjectsList;
