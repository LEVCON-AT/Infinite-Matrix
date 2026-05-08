// Welle WV.C.1 — Vorlagen-Verwaltungs-Route.
//
// `/w/:workspaceId/templates` — Liste aller fuer den User sichtbaren
// Vorlagen mit Tab-Filter (Plattform/Workspace/Privat/Alle), Search,
// Action-Trigger pro Zeile (Bearbeiten/Duplizieren/Hotkey-Slot/Loeschen)
// + Modal-Komponenten (siehe components/templates/*).
//
// Konzept-Verankerung: §7.1 — Vorlagen-Verwaltungs-Route V1.
//
// Reuse-Anker (Adjacent-Cleanup §7.1):
// - Settings.tsx als Shell-Vorbild (Header + Back-Link + Main).
// - canWrite (lib/workspace-role) gating fuer Workspace-Mutationen.
// - cell_template_instances → Usage-Counter via Group-By-template_id.
// - resolveSlotTemplateId aus lib/hotkey-slots fuer Hotkey-Slot-Anzeige.
//
// Edit-Sub-Route /templates/edit/:id (WYSIWYG-Editor §7.3) wird in
// Welle WV.C separat gebaut — V1-Stub zeigt Toast „Editor in Vorbereitung".

import { A, useNavigate, useParams } from '@solidjs/router';
import { For, Show, createMemo, createResource, createSignal } from 'solid-js';
import Icon from '../components/Icon';
import DeleteTemplateModal from '../components/templates/DeleteTemplateModal';
import HotkeySlotPickerModal from '../components/templates/HotkeySlotPickerModal';
import NewTemplateModal from '../components/templates/NewTemplateModal';
import TemplateActionMenu from '../components/templates/TemplateActionMenu';
import { useSession } from '../lib/auth';
import { fetchCellTemplateInstancesForWorkspace } from '../lib/cell-templates';
import { translateDbError } from '../lib/errors';
import { fetchUserHotkeySlots, fetchWorkspaceHotkeySlots } from '../lib/hotkey-slots';
import { fetchMyWorkspaces } from '../lib/queries';
import { addFeatureTemplate, fetchFeatureTemplatesForWorkspace } from '../lib/templates';
import { showToast } from '../lib/toasts';
import type {
  FeatureTemplateRow,
  TemplateVisibility,
  UserHotkeySlotRow,
  WorkspaceHotkeySlotRow,
} from '../lib/types';
import { canWrite } from '../lib/workspace-role';

type TemplateTab = 'workspace' | 'platform' | 'private' | 'all';

type SortKey = 'name' | 'hotkey' | 'usage' | 'updated';
type SortDir = 'asc' | 'desc';

type ModalState =
  | { kind: 'new' }
  | { kind: 'delete'; template: FeatureTemplateRow }
  | { kind: 'hotkey-slot'; template: FeatureTemplateRow }
  | null;

const Templates = () => {
  const params = useParams<{ workspaceId: string }>();
  const session = useSession();
  const navigate = useNavigate();

  const [workspaces] = createResource(
    () => session()?.user?.id ?? null,
    () => fetchMyWorkspaces(),
  );
  const myRole = () => workspaces()?.find((w) => w.id === params.workspaceId)?.role;
  const myWriteAccess = () => canWrite(myRole());
  const myUserId = () => session()?.user?.id ?? null;

  const [templates, { refetch: refetchTemplates }] = createResource(
    () => params.workspaceId,
    async (wsId) => {
      try {
        return await fetchFeatureTemplatesForWorkspace(wsId);
      } catch (err) {
        console.error('fetchFeatureTemplates:', err);
        showToast(translateDbError(err, 'Vorlagen konnten nicht geladen werden.'), 'error');
        return [];
      }
    },
  );

  const [instances] = createResource(
    () => params.workspaceId,
    async (wsId) => {
      try {
        return await fetchCellTemplateInstancesForWorkspace(wsId);
      } catch (err) {
        console.error('fetchCellTemplateInstances:', err);
        return [];
      }
    },
  );

  const [workspaceSlots, { refetch: refetchWorkspaceSlots }] = createResource(
    () => params.workspaceId,
    async (wsId): Promise<WorkspaceHotkeySlotRow[]> => {
      try {
        return await fetchWorkspaceHotkeySlots(wsId);
      } catch (err) {
        console.error('fetchWorkspaceHotkeySlots:', err);
        return [];
      }
    },
  );

  const [userSlots, { refetch: refetchUserSlots }] = createResource(
    () => params.workspaceId,
    async (wsId): Promise<UserHotkeySlotRow[]> => {
      try {
        return await fetchUserHotkeySlots(wsId);
      } catch (err) {
        console.error('fetchUserHotkeySlots:', err);
        return [];
      }
    },
  );

  // Usage-Counter: wie viele Cell-Instanzen referenzieren die Vorlage?
  const usageByTemplate = createMemo<Map<string, number>>(() => {
    const map = new Map<string, number>();
    for (const inst of instances() ?? []) {
      map.set(inst.template_id, (map.get(inst.template_id) ?? 0) + 1);
    }
    return map;
  });

  // Effektiver Hotkey-Slot pro Vorlage: Workspace-Override-Pfad.
  // (User-Override schlaegt Workspace, aber das ist eine separate
  // Liste — hier zeigen wir den Slot, dem die Vorlage real zugewiesen
  // ist im Workspace-Kontext.)
  const slotByTemplate = createMemo<Map<string, number>>(() => {
    const map = new Map<string, number>();
    for (const ws of workspaceSlots() ?? []) {
      map.set(ws.template_id, ws.slot);
    }
    return map;
  });

  const [tab, setTab] = createSignal<TemplateTab>('workspace');
  const [query, setQuery] = createSignal('');
  const [sortKey, setSortKey] = createSignal<SortKey>('name');
  const [sortDir, setSortDir] = createSignal<SortDir>('asc');
  const [modal, setModal] = createSignal<ModalState>(null);

  // Tab → Visibility-Filter.
  function matchesTab(t: FeatureTemplateRow): boolean {
    const sel = tab();
    if (sel === 'all') return true;
    if (sel === 'platform') return t.visibility === 'platform';
    if (sel === 'workspace') return t.visibility === 'workspace';
    if (sel === 'private') return t.visibility === 'user' && t.owner_user_id === myUserId();
    return true;
  }

  function matchesQuery(t: FeatureTemplateRow): boolean {
    const q = query().trim().toLowerCase();
    if (!q) return true;
    if (t.name.toLowerCase().includes(q)) return true;
    return false;
  }

  const filteredTemplates = createMemo<FeatureTemplateRow[]>(() => {
    const list = (templates() ?? []).filter(matchesTab).filter(matchesQuery);
    const dir = sortDir() === 'asc' ? 1 : -1;
    const k = sortKey();

    const visibilityRank: Record<TemplateVisibility, number> = {
      platform: 0,
      workspace: 1,
      user: 2,
    };

    return [...list].sort((a, b) => {
      // Default-Sortier-Schicht: Sichtbarkeits-Gruppe.
      if (k === 'name') {
        const v = visibilityRank[a.visibility] - visibilityRank[b.visibility];
        if (v !== 0) return v;
        return a.name.localeCompare(b.name) * dir;
      }
      if (k === 'hotkey') {
        const sa = slotByTemplate().get(a.id) ?? 99;
        const sb = slotByTemplate().get(b.id) ?? 99;
        if (sa !== sb) return (sa - sb) * dir;
        return a.name.localeCompare(b.name);
      }
      if (k === 'usage') {
        const ua = usageByTemplate().get(a.id) ?? 0;
        const ub = usageByTemplate().get(b.id) ?? 0;
        if (ua !== ub) return (ua - ub) * dir;
        return a.name.localeCompare(b.name);
      }
      // updated
      return a.updated_at.localeCompare(b.updated_at) * dir;
    });
  });

  function toggleSort(k: SortKey) {
    if (sortKey() === k) {
      setSortDir(sortDir() === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(k);
      setSortDir('asc');
    }
  }

  function sortIcon(k: SortKey): 'arrow-up' | 'arrow-down' | null {
    if (sortKey() !== k) return null;
    return sortDir() === 'asc' ? 'arrow-up' : 'arrow-down';
  }

  // ─── Aktionen ──────────────────────────────────────────────────

  async function handleCreate(input: {
    name: string;
    symbol: string | null;
    description: string | null;
    visibility: 'workspace' | 'user';
    hotkeySlot: number | null;
  }): Promise<void> {
    if (!myUserId()) return;
    try {
      await addFeatureTemplate({
        workspaceId: params.workspaceId,
        ownerUserId: input.visibility === 'user' ? myUserId() : null,
        name: input.name,
        symbol: input.symbol,
        hotkeySlot: input.hotkeySlot,
        visibility: input.visibility,
        config: input.description ? { description: input.description } : {},
      });
      showToast('Vorlage angelegt.', 'success');
      void refetchTemplates();
      setModal(null);
    } catch (err) {
      console.error('addFeatureTemplate:', err);
      showToast(translateDbError(err, 'Vorlage konnte nicht angelegt werden.'), 'error');
    }
  }

  function handleEdit(template: FeatureTemplateRow): void {
    navigate(`/w/${params.workspaceId}/templates/edit/${template.id}`);
  }

  function handleDuplicate(template: FeatureTemplateRow): void {
    // V1: Duplikat erzeugen mit Suffix „(Kopie)" — Sections + Widgets
    // werden in C.7-Erweiterung mitkopiert. V1 nur Vorlagen-Row.
    void addFeatureTemplate({
      workspaceId: params.workspaceId,
      ownerUserId: template.owner_user_id,
      name: `${template.name} (Kopie)`,
      symbol: template.symbol,
      symbolColor: template.symbol_color,
      hotkeySlot: null, // Slot bleibt frei beim Duplikat
      visibility: template.visibility === 'platform' ? 'workspace' : template.visibility,
      titleTemplate: template.title_template,
      renderPosition: template.render_position,
      config: template.config,
    })
      .then(() => {
        showToast('Vorlage dupliziert.', 'success');
        void refetchTemplates();
      })
      .catch((err) => {
        console.error('duplicateTemplate:', err);
        showToast(translateDbError(err, 'Duplizieren fehlgeschlagen.'), 'error');
      });
  }

  function handleSlotChanged(): void {
    void refetchWorkspaceSlots();
    void refetchUserSlots();
  }

  function handleDeleted(): void {
    setModal(null);
    void refetchTemplates();
    void refetchWorkspaceSlots();
  }

  // ─── Render ────────────────────────────────────────────────────

  return (
    <div class="templates-shell">
      <header class="templates-shell-head">
        <A
          href={`/w/${params.workspaceId}`}
          class="settings-back"
          aria-label="Zurueck zum Workspace"
        >
          <Icon name="arrow-left" size={16} />
          <span>Zurueck</span>
        </A>
        <h1 class="settings-title">Vorlagen</h1>
        <div class="templates-head-actions">
          <button
            type="button"
            class="btn-primary"
            onClick={() => setModal({ kind: 'new' })}
            disabled={!myWriteAccess()}
          >
            <Icon name="plus" size={14} />
            <span>Neue Vorlage</span>
          </button>
        </div>
      </header>

      <main class="templates-main" id="templates-main" tabIndex={-1}>
        <section class="templates-toolbar">
          <nav class="templates-tabs" aria-label="Vorlagen-Filter">
            <For each={tabsForRole()}>
              {(t) => (
                <button
                  type="button"
                  class="templates-tab"
                  classList={{ active: tab() === t.key }}
                  onClick={() => setTab(t.key)}
                  aria-pressed={tab() === t.key}
                >
                  {t.label}
                </button>
              )}
            </For>
          </nav>
          <div class="templates-search">
            <Icon name="search" size={14} />
            <input
              type="search"
              class="templates-search-input"
              placeholder="Vorlage suchen…"
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              aria-label="Vorlagen durchsuchen"
              spellcheck={false}
              autocomplete="off"
            />
            <Show when={query()}>
              <button
                type="button"
                class="templates-search-clear"
                onClick={() => setQuery('')}
                aria-label="Suche leeren"
              >
                <Icon name="x" size={12} />
              </button>
            </Show>
          </div>
        </section>

        <Show when={!templates.loading} fallback={<p class="templates-loading">Laedt…</p>}>
          <Show
            when={filteredTemplates().length > 0}
            fallback={
              <div class="templates-empty">
                <Icon name="document-text" size={28} />
                <p>Keine Vorlagen gefunden.</p>
                <Show when={query() || tab() !== 'all'}>
                  <button
                    type="button"
                    class="btn-subtle"
                    onClick={() => {
                      setQuery('');
                      setTab('all');
                    }}
                  >
                    Filter zuruecksetzen
                  </button>
                </Show>
              </div>
            }
          >
            <table class="templates-table">
              <thead>
                <tr>
                  <th class="col-symbol" />
                  <th class="col-name">
                    <button
                      type="button"
                      class="templates-sort-btn"
                      onClick={() => toggleSort('name')}
                    >
                      Name
                      <Show when={sortIcon('name')}>{(i) => <Icon name={i()} size={10} />}</Show>
                    </button>
                  </th>
                  <th class="col-visibility">Sichtbarkeit</th>
                  <th class="col-hotkey">
                    <button
                      type="button"
                      class="templates-sort-btn"
                      onClick={() => toggleSort('hotkey')}
                    >
                      Hotkey
                      <Show when={sortIcon('hotkey')}>{(i) => <Icon name={i()} size={10} />}</Show>
                    </button>
                  </th>
                  <th class="col-usage">
                    <button
                      type="button"
                      class="templates-sort-btn"
                      onClick={() => toggleSort('usage')}
                    >
                      In N Cells
                      <Show when={sortIcon('usage')}>{(i) => <Icon name={i()} size={10} />}</Show>
                    </button>
                  </th>
                  <th class="col-updated">
                    <button
                      type="button"
                      class="templates-sort-btn"
                      onClick={() => toggleSort('updated')}
                    >
                      Aenderung
                      <Show when={sortIcon('updated')}>{(i) => <Icon name={i()} size={10} />}</Show>
                    </button>
                  </th>
                  <th class="col-actions" />
                </tr>
              </thead>
              <tbody>
                <For each={filteredTemplates()}>
                  {(t) => (
                    <tr class="templates-row">
                      <td class="col-symbol">
                        <span class="template-symbol" aria-hidden="true">
                          <Show
                            when={t.symbol && isKnownIconName(t.symbol)}
                            fallback={<Icon name="document-text" size={18} />}
                          >
                            <Icon name={t.symbol as Parameters<typeof Icon>[0]['name']} size={18} />
                          </Show>
                        </span>
                      </td>
                      <td class="col-name">
                        <span class="template-name">{t.name}</span>
                        <Show when={getDescription(t)}>
                          <span class="template-desc">{getDescription(t)}</span>
                        </Show>
                      </td>
                      <td class="col-visibility">
                        <span class={`template-visibility-badge v-${t.visibility}`}>
                          {visibilityLabel(t.visibility)}
                        </span>
                      </td>
                      <td class="col-hotkey">
                        <Show
                          when={slotByTemplate().get(t.id)}
                          fallback={<span class="template-slot-empty">—</span>}
                        >
                          {(slot) => <span class="template-slot-badge">{slot()}</span>}
                        </Show>
                      </td>
                      <td class="col-usage">
                        <span class="template-usage">{usageByTemplate().get(t.id) ?? 0}</span>
                      </td>
                      <td class="col-updated">
                        <span class="template-updated" title={t.updated_at}>
                          {formatRelativeDate(t.updated_at)}
                        </span>
                      </td>
                      <td class="col-actions">
                        <TemplateActionMenu
                          template={t}
                          canWrite={myWriteAccess()}
                          isMine={t.owner_user_id === myUserId()}
                          onEdit={() => handleEdit(t)}
                          onDuplicate={() => handleDuplicate(t)}
                          onSetHotkeySlot={() => setModal({ kind: 'hotkey-slot', template: t })}
                          onDelete={() => setModal({ kind: 'delete', template: t })}
                        />
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </Show>
        </Show>
      </main>

      <Show when={modal()?.kind === 'new'}>
        <NewTemplateModal
          canChooseVisibility={myWriteAccess()}
          onSubmit={handleCreate}
          onClose={() => setModal(null)}
        />
      </Show>
      <Show when={modal()}>
        {(m) => (
          <Show when={m().kind === 'delete'}>
            <DeleteTemplateModal
              template={(m() as { template: FeatureTemplateRow }).template}
              workspaceId={params.workspaceId}
              usageCount={
                usageByTemplate().get((m() as { template: FeatureTemplateRow }).template.id) ?? 0
              }
              onDeleted={handleDeleted}
              onClose={() => setModal(null)}
            />
          </Show>
        )}
      </Show>
      <Show when={modal()}>
        {(m) => (
          <Show when={m().kind === 'hotkey-slot'}>
            <HotkeySlotPickerModal
              template={(m() as { template: FeatureTemplateRow }).template}
              workspaceId={params.workspaceId}
              userId={myUserId()}
              workspaceSlots={workspaceSlots() ?? []}
              userSlots={userSlots() ?? []}
              templates={templates() ?? []}
              canSetWorkspaceSlot={myRole() === 'owner'}
              onChanged={handleSlotChanged}
              onClose={() => setModal(null)}
            />
          </Show>
        )}
      </Show>
    </div>
  );

  function tabsForRole(): { key: TemplateTab; label: string }[] {
    return [
      { key: 'workspace', label: 'Workspace' },
      { key: 'platform', label: 'Plattform' },
      { key: 'private', label: 'Privat' },
      { key: 'all', label: 'Alle' },
    ];
  }
};

function visibilityLabel(v: TemplateVisibility): string {
  if (v === 'platform') return 'Plattform';
  if (v === 'workspace') return 'Workspace';
  return 'Privat';
}

function getDescription(t: FeatureTemplateRow): string | null {
  const cfg = t.config as { description?: string };
  return cfg?.description?.trim() || null;
}

// V1-relativ: heute / gestern / vorgestern / DD.MM.YYYY.
function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days <= 0) return 'heute';
  if (days === 1) return 'gestern';
  if (days < 7) return `vor ${days} Tagen`;
  return date.toLocaleDateString('de-AT');
}

// Bekannte Heroicon-Namen (lib/Icon.tsx IconName-Union). V1: Whitelist
// per typeof — Default-Symbol fuer unbekannte Werte ist `document-text`.
// Welle WV.B-Brand-Icon-Bundle erweitert die Domain.
const KNOWN_ICON_NAMES = new Set([
  'view-columns',
  'list-bullet',
  'information-circle',
  'sparkles',
  'document-text',
  'calendar',
  'link',
  'tag',
  'eye',
  'envelope',
  'phone',
  'banknotes',
  'calculator',
  'at-symbol',
  'flag',
  'cog',
  'shield-check',
  'lock-closed',
  'users',
]);

function isKnownIconName(s: string | null): boolean {
  return s !== null && KNOWN_ICON_NAMES.has(s);
}

export default Templates;
