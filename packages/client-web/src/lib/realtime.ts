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
  | 'docs'
  // Phase 3 O.8: Object-Updates muessen Live-Resolver der Templates
  // bumpen — sonst zeigt eine Sub-Matrix mit `{row.object}`-Template
  // veraltete Labels, bis User die Page neu laedt.
  | 'objects';

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
  'objects',
];

// Subscribe in einem reaktiven Scope (onMount / createEffect). Der
// Unsubscribe-Pfad wird automatisch ueber onCleanup ans Lifecycle
// gehaengt — Caller muss nichts machen ausser die Funktion aufzurufen.
export function subscribeWorkspace(workspaceId: string, bumps: RealtimeBumps): void {
  const channel = supabase.channel(`ws:${workspaceId}`);

  for (const table of TABLES) {
    channel.on(
      // biome-ignore lint/suspicious/noExplicitAny: Supabase-Realtime-Event-Type ist generisch typisiert; das `as any` ist die offizielle Workaround-Form aus den Supabase-JS-Docs (postgres_changes ist ein Literal-Typ-String, der TS nicht automatisch akzeptiert).
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
