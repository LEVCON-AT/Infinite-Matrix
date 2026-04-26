// AuditLogList — Phase 1 (P1.A).
//
// Read-only Anzeige der workspace_audit_log-Eintraege. Live-Refetch
// bei Filter-Aenderung. Keine Pagination — Default-Limit 200 reicht
// fuer P1.A; CSV-Export + Pagination kommen Phase 1.5.

import { type Component, For, Show } from 'solid-js';
import { type AuditEntry, describeAuditAction } from '../lib/audit';
import type { WorkspaceMember } from '../lib/members';
import Icon from './Icon';

export type AuditLogListProps = {
  entries: AuditEntry[];
  // Optional: Member-Lookup zum Aufloesen actor/target uuid -> Display-Label.
  members?: WorkspaceMember[];
};

const formatTimestamp = (iso: string): string => {
  const d = new Date(iso);
  // Lokales Format: "26.04.2026, 12:34". Konsistent in der Spalte
  // ohne Sekunden — Audit ist Tages/Stundengranular.
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const actionToToneClass = (action: string): string => {
  if (action === 'invite.created') return 'audit-tone-info';
  if (action === 'invite.accepted') return 'audit-tone-ok';
  if (action === 'invite.revoked') return 'audit-tone-warn';
  if (action === 'member.role_changed') return 'audit-tone-warn';
  if (action === 'member.removed') return 'audit-tone-danger';
  if (action === 'workspace.ownership_transferred') return 'audit-tone-warn';
  return 'audit-tone-neutral';
};

const AuditLogList: Component<AuditLogListProps> = (p) => {
  const memberLookup = () => {
    const map = new Map<string, string>();
    for (const m of p.members ?? []) {
      const label = m.display_name?.trim() || m.email || m.user_id.slice(0, 8);
      map.set(m.user_id, label);
    }
    return map;
  };

  const actorLabel = (id: string | null): string => {
    if (!id) return 'System';
    return memberLookup().get(id) ?? `${id.slice(0, 8)}…`;
  };

  return (
    <ul class="audit-list" aria-label="Workspace-Audit-Log">
      <For each={p.entries} fallback={<li class="audit-empty">Keine Eintraege.</li>}>
        {(e) => (
          <li class={`audit-entry ${actionToToneClass(e.action)}`}>
            <div class="audit-entry-head">
              <span class="audit-action-chip">{describeAuditAction(e.action)}</span>
              <time class="audit-time" datetime={e.created_at}>
                {formatTimestamp(e.created_at)}
              </time>
            </div>
            <div class="audit-entry-body">
              <span class="audit-actor">
                <Icon name="user" size={12} />
                <span>{actorLabel(e.actor_id)}</span>
              </span>
              <Show when={e.target_user_id && e.target_user_id !== e.actor_id}>
                <span class="audit-target">
                  <Icon name="arrow-path" size={12} />
                  <span>{actorLabel(e.target_user_id)}</span>
                </span>
              </Show>
              <Show when={typeof e.payload?.role === 'string'}>
                <span class={`settings-role-chip role-${e.payload.role as string}`}>
                  {e.payload.role as string}
                </span>
              </Show>
              <Show when={typeof e.payload?.invited_email === 'string'}>
                <span class="audit-meta">
                  <Icon name="envelope" size={12} />
                  <span>{e.payload.invited_email as string}</span>
                </span>
              </Show>
            </div>
          </li>
        )}
      </For>
    </ul>
  );
};

export default AuditLogList;
