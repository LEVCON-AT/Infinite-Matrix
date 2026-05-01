// Audit-Log-Viewer (Welle B B.0.E).
//
// Read-only Tabelle ueber system_audit_log. Pagination per offset, Filter
// nach action-Prefix (ilike). RLS in 046 erlaubt platform_admins SELECT
// direkt — kein RPC noetig.
//
// V1 zeigt: created_at, action, actor_id (verkurzt), workspace_name,
// payload als kollabier-bares <details>. Filter rerendert ohne page-
// Reset.

import { type Component, For, Show, createMemo, createResource, createSignal } from 'solid-js';
import { type AuditLogEntry, listSystemAuditLog } from '../../lib/admin';
import { formatDateTimeWithSecsDE } from '../../lib/dates';
import { translateDbError } from '../../lib/errors';
import { showToast } from '../../lib/toasts';

const PAGE_SIZE = 50;

const AuditLogSection: Component = () => {
  const [actionFilter, setActionFilter] = createSignal('');
  const [page, setPage] = createSignal(0);

  const [entries, { refetch }] = createResource(
    () => ({ filter: actionFilter().trim(), page: page() }),
    async ({ filter, page: p }) => {
      try {
        return await listSystemAuditLog({
          actionPrefix: filter || undefined,
          limit: PAGE_SIZE,
          offset: p * PAGE_SIZE,
        });
      } catch (err) {
        console.error('listSystemAuditLog:', err);
        showToast(translateDbError(err, 'Audit-Log nicht ladbar.'), 'error');
        return [] as AuditLogEntry[];
      }
    },
  );

  const hasNext = createMemo(() => (entries() ?? []).length === PAGE_SIZE);

  const fmtTime = formatDateTimeWithSecsDE;

  function fmtUuid(id: string | null): string {
    if (!id) return '—';
    return `${id.slice(0, 8)}…`;
  }

  return (
    <section class="admin-section admin-section-audit">
      <header class="admin-section-head">
        <h3>Audit-Log</h3>
        <input
          type="text"
          class="admin-audit-filter"
          value={actionFilter()}
          onInput={(e) => {
            setActionFilter(e.currentTarget.value);
            setPage(0);
          }}
          placeholder="Filter action (z.B. workspace.)"
        />
      </header>

      <Show when={!entries.loading} fallback={<p class="admin-loading">Lade Audit-Log…</p>}>
        <Show when={(entries() ?? []).length > 0} fallback={<p class="hint">Keine Eintraege.</p>}>
          <table class="admin-audit-table">
            <thead>
              <tr>
                <th>Zeit</th>
                <th>Action</th>
                <th>Actor</th>
                <th>Workspace</th>
                <th>Payload</th>
              </tr>
            </thead>
            <tbody>
              <For each={entries() ?? []}>
                {(e) => (
                  <tr>
                    <td class="admin-audit-time">{fmtTime(e.created_at)}</td>
                    <td class="admin-audit-action">
                      <code>{e.action}</code>
                    </td>
                    <td class="admin-audit-actor" title={e.actor_id ?? ''}>
                      {fmtUuid(e.actor_id)}
                    </td>
                    <td class="admin-audit-ws">
                      <Show
                        when={e.workspace_name}
                        fallback={<span class="hint">{fmtUuid(e.workspace_id)}</span>}
                      >
                        {e.workspace_name}
                      </Show>
                    </td>
                    <td class="admin-audit-payload">
                      <Show when={Object.keys(e.payload ?? {}).length > 0}>
                        <details>
                          <summary>{Object.keys(e.payload).length} Felder</summary>
                          <pre>{JSON.stringify(e.payload, null, 2)}</pre>
                        </details>
                      </Show>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Show>
      </Show>

      <footer class="admin-audit-paginate">
        <button
          type="button"
          class="btn-subtle"
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={page() === 0 || entries.loading}
        >
          ← Zurueck
        </button>
        <span class="admin-audit-page">Seite {page() + 1}</span>
        <button
          type="button"
          class="btn-subtle"
          onClick={() => setPage((p) => p + 1)}
          disabled={!hasNext() || entries.loading}
        >
          Weiter →
        </button>
        <button
          type="button"
          class="btn-subtle"
          onClick={() => void refetch()}
          disabled={entries.loading}
        >
          ↻ Neu laden
        </button>
      </footer>
    </section>
  );
};

export default AuditLogSection;
