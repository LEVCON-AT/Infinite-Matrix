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
// Q.2: task_manifestations ist aufgeloest, atom_manifestations ist die
// Single-Source. Wir routen Events anhand `payload.new.atom_type` +
// `payload.new.kind`:
//   - atom_type='task' + kind='kanban'    → kb_cards-Slot
//   - atom_type='task' + kind='checklist' → checklist_items-Slot
//   - atom_type=anderes (link/checklist/doc) → atom_manifestations-Slot
//     (Calendar-Reload via Workspace.tsx)
// Refetches sind idempotent — kein Schaden bei Doppel-Bump.
//
// Keine Event-Deduplizierung gegen eigene Mutationen. Wenn Tab A
// toggleFeature() aufruft, kommt das Event auch bei Tab A wieder an
// und triggert einen Refetch — idempotent, kein Schaden. Der einfache
// Weg ist hier das richtige.

import { onCleanup } from 'solid-js';
import { supabase } from './supabase';

// Slot-Namen behalten ihren historischen kb_cards / checklist_items
// Bezug, weil bestehende UI-Konsumenten unter genau diesen Schluesseln
// ihre Refetches registrieren. Die DB-Tabelle dahinter ist seit Q.2
// atom_manifestations (kind='kanban'/'checklist', atom_type='task').
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
  | 'objects'
  // T.AC.A.5 + Q.2: Calendar-Slot fuer non-task Atoms (Link/Checklist via
  // atom_manifestations). Bumps refetchen wsAtomManifestations in
  // Workspace.tsx.
  | 'atom_manifestations'
  // Welle D.9: Multi-User-Sync fuer Pins + Tag-System. Andere User
  // pinnen Doku, taggen Atome → Sicht muss live ohne Refresh updaten.
  | 'atom_pins'
  | 'workspace_tags'
  | 'atom_tags';

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
  'atom_pins',
  'workspace_tags',
  'atom_tags',
];

type AtomManifPayload = {
  new?: { atom_type?: string; kind?: string } | null;
  old?: { atom_type?: string; kind?: string } | null;
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

  // atom_manifestations: Q.2 Single-Source. Wir routen anhand atom_type
  // + kind:
  //   - atom_type='task' + kind='kanban'    → kb_cards-Slot
  //   - atom_type='task' + kind='checklist' → checklist_items-Slot
  //   - atom_type='task' + kind='calendar'  → kein Legacy-Slot (Workspace.tsx
  //     refetcht Tasks ueber den tasks-Subscribe oben).
  //   - atom_type<>task                     → atom_manifestations-Slot
  //     (Link/Checklist im Calendar via Workspace.tsx → wsAtomManifestations)
  channel.on(
    // biome-ignore lint/suspicious/noExplicitAny: siehe oben.
    'postgres_changes' as any,
    {
      event: '*',
      schema: 'public',
      table: 'atom_manifestations',
      filter: `workspace_id=eq.${workspaceId}`,
    },
    (payload: AtomManifPayload) => {
      const atomType = payload.new?.atom_type ?? payload.old?.atom_type;
      const kind = payload.new?.kind ?? payload.old?.kind;
      if (atomType === 'task') {
        if (kind === 'kanban') bumps.kb_cards?.();
        else if (kind === 'checklist') bumps.checklist_items?.();
        // calendar-Manifestations werden ueber den tasks-Subscribe
        // covered (Task-Aenderungen feuern wsTasks-Refetch, der
        // calendarEvents neu rechnet).
      } else {
        bumps.atom_manifestations?.();
      }
    },
  );

  channel.subscribe();

  onCleanup(() => {
    void supabase.removeChannel(channel);
  });
}
