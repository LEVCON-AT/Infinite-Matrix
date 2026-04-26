// Settings → Workspace → Audit-Log. Phase 1 (P1.A).
//
// Zeigt workspace_audit_log-Eintraege fuer admin/owner. Filter: alle |
// nur invites | nur members. Refetch bei Filter-Aenderung.

import { useParams } from '@solidjs/router';
import { type Component, For, Show, createMemo, createResource, createSignal } from 'solid-js';
import AuditLogList from '../../components/AuditLogList';
import { type AuditAction, type AuditEntry, fetchAuditLog } from '../../lib/audit';
import { translateDbError } from '../../lib/errors';
import { fetchMembers } from '../../lib/members';
import { showToast } from '../../lib/toasts';

type FilterPreset = 'all' | 'invites' | 'members';

const FILTER_ACTIONS: Record<FilterPreset, ReadonlyArray<AuditAction>> = {
  all: [],
  invites: ['invite.created', 'invite.accepted', 'invite.revoked'],
  members: ['member.role_changed', 'member.removed', 'member.deactivated', 'member.reactivated'],
};

const FILTER_LABELS: Record<FilterPreset, string> = {
  all: 'Alle',
  invites: 'Einladungen',
  members: 'Mitglieder',
};

const WorkspaceAuditLog: Component = () => {
  const params = useParams<{ workspaceId: string }>();
  const [preset, setPreset] = createSignal<FilterPreset>('all');

  // Member-Liste fuer actor/target-Aufloesung. Read-only, kein Cache.
  const [members] = createResource(
    () => params.workspaceId,
    async (wsId) => {
      try {
        return await fetchMembers(wsId);
      } catch {
        return [];
      }
    },
  );

  const [entries] = createResource(
    () => ({ wsId: params.workspaceId, preset: preset() }),
    async (key) => {
      const actions = FILTER_ACTIONS[key.preset];
      try {
        return await fetchAuditLog(key.wsId, {
          actions: actions.length === 0 ? undefined : actions,
        });
      } catch (err) {
        showToast(translateDbError(err, 'Audit-Log konnte nicht geladen werden.'), 'error');
        return [] as AuditEntry[];
      }
    },
  );

  const liveStatus = createMemo(() => {
    if (entries.loading) return 'lade…';
    const list = entries() ?? [];
    return `${list.length} Eintrag${list.length === 1 ? '' : 'e'}`;
  });

  return (
    <article class="settings-pane">
      <header class="settings-pane-head">
        <h2>Audit-Log</h2>
        <p class="hint">
          Historie aller Mitglieder-relevanten Aktionen. Read-only fuer admin/owner. Eintraege sind
          unveraenderlich (Trigger blockt UPDATE/DELETE).
        </p>
      </header>

      <header class="settings-section-head">
        <div class="audit-filter" role="tablist" aria-label="Audit-Filter">
          <For each={Object.keys(FILTER_LABELS) as FilterPreset[]}>
            {(p) => (
              <button
                type="button"
                role="tab"
                aria-selected={preset() === p}
                class="audit-filter-tab"
                classList={{ active: preset() === p }}
                onClick={() => setPreset(p)}
              >
                {FILTER_LABELS[p]}
              </button>
            )}
          </For>
        </div>
        <span class="hint" aria-live="polite">
          {liveStatus()}
        </span>
      </header>

      <Show
        when={!entries.loading || (entries()?.length ?? 0) > 0}
        fallback={<p class="settings-empty">Lade Audit-Eintraege…</p>}
      >
        <AuditLogList entries={entries() ?? []} members={members() ?? []} />
      </Show>
    </article>
  );
};

export default WorkspaceAuditLog;
