// Realtime-Subscription pro Workspace.
//
// Hintergrund: wir wollen 2-Tab-Sync (und perspektivisch Multi-User),
// ohne dass jede Mutation von Hand refetch()t werden muss. Supabase
// broadcastet INSERT/UPDATE/DELETE ueber Postgres-Replikation (siehe
// Migration 005), und wir haengen einen Channel pro Workspace auf.
//
// Design-Entscheidung: ein Channel mit 9 Listenern statt 9 Channels.
// Ein Channel ist eine WS-Verbindung; pro Workspace reicht genau eine.
// Die workspace_id-Filter laufen serverseitig — der Client sieht nur
// Events, die zu seinem Workspace gehoeren (RLS + Filter zusammen).
//
// Keine Event-Deduplizierung gegen eigene Mutationen. Wenn Tab A
// toggleFeature() aufruft, kommt das Event auch bei Tab A wieder an
// und triggert einen Refetch — idempotent, kein Schaden. Der einfache
// Weg ist hier das richtige.

import { onCleanup } from 'solid-js';
import { supabase } from './supabase';

export type RealtimeTable =
  | 'nodes'
  | 'cells'
  | 'rows'
  | 'cols'
  | 'kb_cols'
  | 'kb_cards'
  | 'checklists'
  | 'checklist_items'
  | 'links'
  | 'docs';

export type RealtimeBumps = Partial<Record<RealtimeTable, () => void>>;

const TABLES: RealtimeTable[] = [
  'nodes',
  'cells',
  'rows',
  'cols',
  'kb_cols',
  'kb_cards',
  'checklists',
  'checklist_items',
  'links',
  'docs',
];

// Subscribe in einem reaktiven Scope (onMount / createEffect). Der
// Unsubscribe-Pfad wird automatisch ueber onCleanup ans Lifecycle
// gehaengt — Caller muss nichts machen ausser die Funktion aufzurufen.
export function subscribeWorkspace(workspaceId: string, bumps: RealtimeBumps): void {
  const channel = supabase.channel(`ws:${workspaceId}`);

  for (const table of TABLES) {
    channel.on(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      'postgres_changes' as any,
      {
        event: '*',
        schema: 'public',
        table,
        filter: `workspace_id=eq.${workspaceId}`,
      },
      () => {
        bumps[table]?.();
      },
    );
  }

  channel.subscribe();

  onCleanup(() => {
    void supabase.removeChannel(channel);
  });
}
