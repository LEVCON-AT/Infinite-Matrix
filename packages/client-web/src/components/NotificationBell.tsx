// Welle N.4 — NotificationBell + NotificationDrawer.
//
// Glocken-Icon mit Unread-Badge im Workspace-Header. Click oeffnet
// einen rechtsseitigen Drawer mit den letzten 50 Notifications. Click
// auf einen Eintrag markiert als read + navigiert via link_to.
//
// Realtime via subscribeToNotifications — Badge + Drawer-Liste
// updaten ohne Polling.

import { useNavigate } from '@solidjs/router';
import {
  type Component,
  For,
  Show,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import { useSession } from '../lib/auth';
import {
  type Notification,
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  subscribeToNotifications,
} from '../lib/notifications';
import Icon from './Icon';

export type NotificationBellProps = {
  workspaceId: string;
};

const NotificationBell: Component<NotificationBellProps> = (props) => {
  const session = useSession();
  const navigate = useNavigate();
  const [open, setOpen] = createSignal(false);
  const [items, setItems] = createSignal<Notification[]>([]);
  let drawerEl: HTMLDivElement | undefined;
  let bellEl: HTMLButtonElement | undefined;

  const [, { refetch }] = createResource(
    () => ({ wsId: props.workspaceId, userId: session()?.user?.id }),
    async ({ wsId, userId }) => {
      if (!wsId || !userId) return [] as Notification[];
      const rows = await fetchNotifications(wsId, 50);
      setItems(rows);
      return rows;
    },
  );

  const unreadCount = createMemo(() => items().filter((n) => !n.read_at).length);

  // Realtime: pro User subscriben (RLS filtert auf user_id).
  let unsubscribe: (() => void) | null = null;
  onMount(() => {
    const userId = session()?.user?.id;
    if (!userId) return;
    const sub = subscribeToNotifications(userId, (row, eventType) => {
      if (row.workspace_id !== props.workspaceId) return;
      setItems((prev) => {
        if (eventType === 'DELETE') return prev.filter((n) => n.id !== row.id);
        const idx = prev.findIndex((n) => n.id === row.id);
        if (idx >= 0) {
          const copy = prev.slice();
          copy[idx] = row;
          return copy;
        }
        // INSERT — vorne einfuegen.
        return [row, ...prev].slice(0, 50);
      });
    });
    unsubscribe = sub.unsubscribe;
  });
  onCleanup(() => unsubscribe?.());

  // Outside-Click + ESC schliessen den Drawer.
  onMount(() => {
    const onClick = (e: MouseEvent) => {
      if (!open()) return;
      const target = e.target as Node;
      if (drawerEl?.contains(target) || bellEl?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open()) {
        e.preventDefault();
        setOpen(false);
        bellEl?.focus();
      }
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    onCleanup(() => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    });
  });

  function relativeTime(iso: string): string {
    const diffMs = Date.now() - new Date(iso).getTime();
    const sec = Math.floor(diffMs / 1000);
    if (sec < 60) return 'gerade eben';
    const min = Math.floor(sec / 60);
    if (min < 60) return `vor ${min} min`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `vor ${hr} Std`;
    const d = Math.floor(hr / 24);
    if (d < 7) return `vor ${d} Tg`;
    return new Date(iso).toLocaleDateString('de-DE');
  }

  async function onItemClick(n: Notification): Promise<void> {
    if (!n.read_at) {
      try {
        await markNotificationRead(n.id);
        setItems((prev) =>
          prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)),
        );
      } catch {
        // ignore — Realtime updated dann ggf. nachtraeglich.
      }
    }
    if (n.link_to) {
      navigate(`/w/${props.workspaceId}${n.link_to}`);
      setOpen(false);
    }
  }

  async function onMarkAllRead(): Promise<void> {
    try {
      await markAllNotificationsRead(props.workspaceId);
      setItems((prev) =>
        prev.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })),
      );
    } catch {
      void refetch();
    }
  }

  return (
    <div class="notification-bell-wrap">
      <button
        ref={(el) => {
          bellEl = el;
        }}
        type="button"
        class="notification-bell"
        classList={{ 'has-unread': unreadCount() > 0 }}
        onClick={() => setOpen((o) => !o)}
        aria-label={`Benachrichtigungen (${unreadCount()} ungelesen)`}
        aria-expanded={open()}
      >
        <Icon name="bell" size={16} />
        <Show when={unreadCount() > 0}>
          <span class="notification-badge" aria-hidden="true">
            {unreadCount() > 99 ? '99+' : unreadCount()}
          </span>
        </Show>
      </button>

      <Show when={open()}>
        <div
          ref={(el) => {
            drawerEl = el;
          }}
          class="notification-drawer"
          role="dialog"
          aria-label="Benachrichtigungen"
        >
          <header class="notification-drawer-head">
            <h3>Benachrichtigungen</h3>
            <Show when={unreadCount() > 0}>
              <button
                type="button"
                class="btn-subtle"
                onClick={() => void onMarkAllRead()}
              >
                Alle als gelesen
              </button>
            </Show>
          </header>
          <div class="notification-drawer-body">
            <Show
              when={items().length > 0}
              fallback={<p class="notification-empty">Keine Benachrichtigungen.</p>}
            >
              <ul class="notification-list">
                <For each={items()}>
                  {(n) => (
                    <li
                      class="notification-item"
                      classList={{
                        unread: !n.read_at,
                        clickable: !!n.link_to,
                      }}
                    >
                      <button
                        type="button"
                        class="notification-item-button"
                        onClick={() => void onItemClick(n)}
                      >
                        <Show when={!n.read_at}>
                          <span class="notification-dot" aria-hidden="true" />
                        </Show>
                        <div class="notification-item-text">
                          <strong>{n.title}</strong>
                          <Show when={n.body}>
                            <span class="notification-item-body">{n.body}</span>
                          </Show>
                          <span class="notification-item-time">
                            {relativeTime(n.created_at)}
                          </span>
                        </div>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default NotificationBell;
