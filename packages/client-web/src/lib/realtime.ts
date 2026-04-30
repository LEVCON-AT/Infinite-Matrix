// Realtime-Subscription pro Workspace.
//
// Hintergrund: wir wollen 2-Tab-Sync (und perspektivisch Multi-User),
// ohne dass jede Mutation von Hand refetch()t werden muss. Supabase
// broadcastet INSERT/UPDATE/DELETE ueber Postgres-Replikation (siehe
// Migration 005), und wir haengen einen Channel pro Workspace auf.
//
// Design-Entscheidung: ein Channel mit N Listenern statt N Channels.
// Ein Channel ist eine WS-Verbindung; pro Workspace reicht genau eine.
// Die workspace_id-Filter laufen serverseitig — der Client sieht nur
// Events, die zu seinem Workspace gehoeren (RLS + Filter zusammen).
//
// Phase 4 T.1.D: kb_cards + checklist_items sind weg, Daten leben
// nur noch in tasks + task_manifestations. Damit die UI-Subscriber
// (BoardView ueber kb_cards-Bumps, ChecklistPanel ueber checklist_-
// items-Bumps) ohne Aenderung weiterlaufen, routen wir Events von
// task_manifestations anhand von payload.new.kind / payload.old.kind
// auf die Legacy-Bump-Slots. tasks-Events bumpen beide Slots
// (Kanban-Sicht und Checklist-Sicht koennen beide auf Task-Felder
// reagieren). Refetches sind idempotent — kein Schaden bei Doppel-Bump.
//
// Keine Event-Deduplizierung gegen eigene Mutationen. Wenn Tab A
// toggleFeature() aufruft, kommt das Event auch bei Tab A wieder an
// und triggert einen Refetch — idempotent, kein Schaden. Der einfache
// Weg ist hier das richtige.

import { onCleanup } from 'solid-js';
import { supabase } from './supabase';

// Slot-Namen behalten ihren historischen kb_cards / checklist_items
// Bezug, weil bestehende UI-Konsumenten unter genau diesen Schluesseln
// ihre Refetches registrieren. Die DB-Tabellen dahinter sind seit
// T.1.D tasks + task_manifestations.
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
  | 'objects';

export type RealtimeBumps = Partial<Record<RealtimeTable, () => void>>;

// Tabellen, die direkt 1:1 als postgres_changes-Subscription laufen.
const DIRECT_TABLES: Array<Exclude<RealtimeTable, 'kb_cards' | 'checklist_items'>> = [
  'nodes',
  'cells',
  'rows',
  'cols',
  'kb_cols',
  'checklists',
  'links',
  'docs',
  'objects',
];

type TaskManifKindPayload = {
  new?: { kind?: string } | null;
  old?: { kind?: string } | null;
};

// Subscribe in einem reaktiven Scope (onMount / createEffect). Der
// Unsubscribe-Pfad wird automatisch ueber onCleanup ans Lifecycle
// gehaengt — Caller muss nichts machen ausser die Funktion aufzurufen.
export function subscribeWorkspace(workspaceId: string, bumps: RealtimeBumps): void {
  const channel = supabase.channel(`ws:${workspaceId}`);

  for (const table of DIRECT_TABLES) {
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

  // tasks: Aenderung an Task-Feldern (label, status, deadline, attrs, ...)
  // betrifft potenziell jede Manifestation. Beide Legacy-Slots bumpen,
  // damit Kanban- und Checklist-Sichten den Task-Update mitbekommen.
  channel.on(
    // biome-ignore lint/suspicious/noExplicitAny: siehe oben.
    'postgres_changes' as any,
    {
      event: '*',
      schema: 'public',
      table: 'tasks',
      filter: `workspace_id=eq.${workspaceId}`,
    },
    () => {
      bumps.kb_cards?.();
      bumps.checklist_items?.();
    },
  );

  // task_manifestations: kind-spezifisch routen. kanban → kb_cards-Slot,
  // checklist → checklist_items-Slot. calendar/standalone laufen ins
  // Leere (T.1.G fuegt einen calendar-Slot dazu).
  channel.on(
    // biome-ignore lint/suspicious/noExplicitAny: siehe oben.
    'postgres_changes' as any,
    {
      event: '*',
      schema: 'public',
      table: 'task_manifestations',
      filter: `workspace_id=eq.${workspaceId}`,
    },
    (payload: TaskManifKindPayload) => {
      const kind = payload.new?.kind ?? payload.old?.kind;
      if (kind === 'kanban') bumps.kb_cards?.();
      else if (kind === 'checklist') bumps.checklist_items?.();
    },
  );

  channel.subscribe();

  onCleanup(() => {
    void supabase.removeChannel(channel);
  });
}
