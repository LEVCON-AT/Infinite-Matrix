// Object-Liste (Phase 3 Welle O.4.D) — Filter-Page als UI-Entry zur
// Object-Detail-Page. Stub-Variante; in O.5 wird daraus das volle
// Filter-Dashboard mit Tag-Cross-Cuts, Volltext, Backlink-Aufgliederung.
//
// Heute:
//   - Suchfeld (label-Substring, case-insensitiv)
//   - Type-Filter (Dropdown der unique type_labels im Workspace)
//   - Liste: label + type-chip + ^o.alias-chip + Backlinks-Count
//   - Click → /w/<ws>/o/<id>
//
// Datenmenge: alle Objects + alle Backlinks workspace-weit auf einmal.
// Akzeptabel bis ~5000 Objects / ~50k Backlinks. Daruber: Paginierung
// + Server-side-Filter (kommt mit O.5).

import { useNavigate, useParams } from '@solidjs/router';
import { type Component, For, Show, createMemo, createResource, createSignal } from 'solid-js';
import Icon from '../components/Icon';
import { translateDbError } from '../lib/errors';
import { fetchAllBacklinks, fetchObjects } from '../lib/objects';
import { showToast } from '../lib/toasts';

type RouteParams = { workspaceId: string };

const ObjectsList: Component = () => {
  const params = useParams<RouteParams>();
  const navigate = useNavigate();
  const wsId = () => params.workspaceId;

  const [search, setSearch] = createSignal('');
  const [typeFilter, setTypeFilter] = createSignal<string>('');

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

  // object_id → count.
  const backlinkCount = createMemo(() => {
    const map = new Map<string, number>();
    for (const b of backlinks() ?? []) {
      map.set(b.object_id, (map.get(b.object_id) ?? 0) + 1);
    }
    return map;
  });

  // Unique type-Labels fuer Dropdown (sortiert).
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
    return list.filter((o) => {
      if (q && !o.label.toLowerCase().includes(q) && !(o.alias ?? '').toLowerCase().includes(q)) {
        return false;
      }
      if (t && o.type_label !== t) return false;
      return true;
    });
  });

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
        <span class="objects-list-count">
          {filtered().length} / {objects()?.length ?? 0}
        </span>
      </div>

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
    </div>
  );
};

export default ObjectsList;
