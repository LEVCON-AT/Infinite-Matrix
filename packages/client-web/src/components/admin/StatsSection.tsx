// Stats-Sektion (Welle B B.0.F).
//
// Aggregierte Plattform-Counts via get_admin_stats()-RPC (admin-only).
// V1: einfaches Karten-Grid mit Counts. Spaeter Trend-Diagramme.

import { type Component, For, Show, createResource } from 'solid-js';
import { type AdminStats, getAdminStats } from '../../lib/admin';
import { translateDbError } from '../../lib/errors';
import { showToast } from '../../lib/toasts';

type StatCard = {
  key: keyof Omit<AdminStats, 'as_of'>;
  label: string;
  hint?: string;
};

const CARDS: StatCard[] = [
  { key: 'users_total', label: 'User insgesamt' },
  { key: 'users_active_30d', label: 'Aktiv in 30 Tagen', hint: 'last_sign_in_at' },
  { key: 'workspaces_total', label: 'Workspaces' },
  { key: 'tasks_total', label: 'Tasks (Layer 0)' },
  { key: 'atom_manifestations_total', label: 'atom_manifestations' },
  { key: 'audit_events_24h', label: 'Audit-Events (24h)' },
];

const StatsSection: Component = () => {
  const [stats, { refetch }] = createResource(async () => {
    try {
      return await getAdminStats();
    } catch (err) {
      console.error('getAdminStats:', err);
      showToast(translateDbError(err, 'Stats nicht ladbar.'), 'error');
      return null;
    }
  });

  return (
    <section class="admin-section">
      <header class="admin-section-head">
        <h3>Statistik</h3>
        <button
          type="button"
          class="btn-subtle"
          onClick={() => void refetch()}
          disabled={stats.loading}
        >
          ↻ Neu laden
        </button>
      </header>

      <Show
        when={!stats.loading && stats() != null}
        fallback={<p class="admin-loading">Lade Counts…</p>}
      >
        <div class="admin-stats-grid">
          <For each={CARDS}>
            {(card) => (
              <div class="admin-stats-card">
                <div class="admin-stats-value">
                  {(stats() as AdminStats)[card.key].toLocaleString('de-DE')}
                </div>
                <div class="admin-stats-label">{card.label}</div>
                <Show when={card.hint}>
                  <div class="admin-stats-hint">{card.hint}</div>
                </Show>
              </div>
            )}
          </For>
        </div>
        <p class="admin-stats-asof">
          Stand: {(() => {
            const s = stats();
            if (!s) return '';
            try {
              return new Date(s.as_of).toLocaleString('de-DE');
            } catch {
              return s.as_of;
            }
          })()}
        </p>
      </Show>
    </section>
  );
};

export default StatsSection;
