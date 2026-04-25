// Safe-Mutation-Wrapper (Plan 0g.2d).
//
// runMutation(spec, ws, run) versucht zuerst, die Mutation live
// auszufuehren. Bei NetworkError landet die Spec in der Mutation-
// Queue und der Caller sieht ein Sentinel-Result statt einer
// geworfenen Exception. Andere Fehler (RLS, Validation, FK) gehen
// hart durch — die queueable wir bewusst NICHT (sonst replay'n wir
// kaputte Specs ewig).
//
// Aufrufer sollen Mutationen so wrappen:
//   await runMutation(
//     { kind: 'update', table: 'kb_cards', values: { done: true }, match: { id } },
//     workspaceId,
//     async () => {
//       const { error } = await supabase.from('kb_cards').update(...).eq(...);
//       if (error) throw error;
//     },
//   );
//
// Doppelt zu schreiben (Spec + Run) ist redundant, aber V1: der
// Run-Pfad bleibt der Standard-Code, die Spec ist nur fuer den
// Replay-Fall noetig. Spaeter koennen wir runMutation komplett auf
// runSpec()-basierten Online-Pfad umstellen — dann faellt der
// Run-Argument weg.

import { type MutationSpec, enqueueMutation, isNetworkError } from './mutation-queue';
import { type CacheTable, deleteOne, getById, patchRow, putOne } from './offline-cache';
import { showToast } from './toasts';

export type RunMutationResult<T> =
  | { ok: true; value: T }
  | { ok: false; queued: true; queueId: string };

// Optimistic-Update: versucht die Live-Mutation, faellt offline auf
// Cache-Patch + Queue-Eintrag zurueck. Liefert in beiden Faellen
// eine Row (vom Server bzw. aus dem Cache + Patch zusammengesetzt) —
// die UI bleibt damit reaktiv, auch wenn der Server gerade weg ist.
//
// Voraussetzung: die Row liegt bereits im IDB-Cache. Der Workspace
// wird daraus uebernommen, damit der Caller workspaceId nicht
// durchreichen muss. Liegt die Row nicht im Cache (frisch geladene
// Tab-Sitzung ohne vorherigen Read), faellt die Funktion auf das
// klassische Throw-Verhalten zurueck — V1-Pragmatik.
export async function runOptimisticUpdate<T extends { id: string; workspace_id: string }>(args: {
  table: CacheTable;
  id: string;
  patch: Record<string, unknown>;
  label?: string;
  run: () => Promise<T>;
}): Promise<T> {
  try {
    return await args.run();
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const cached = await getById<T>(args.table, args.id);
    if (!cached) {
      // Ohne Cache-Eintrag koennen wir kein synthetisches Result
      // bauen — Original-Fehler durchwerfen, Caller toastet.
      throw err;
    }
    await enqueueMutation({
      spec: {
        kind: 'update',
        table: args.table,
        values: args.patch,
        match: { id: args.id },
      },
      workspaceId: cached.workspace_id,
      label: args.label,
    });
    const patched = await patchRow<T>(args.table, args.id, args.patch);
    showToast(
      args.label
        ? `Offline gespeichert: ${args.label}.`
        : 'Offline gespeichert. Wird beim Reconnect synchronisiert.',
      'info',
    );
    return patched ?? ({ ...cached, ...args.patch } as T);
  }
}

// Optimistic-Insert: client erzeugt die UUID + alle Pflichtfelder,
// schiebt die Row in den Cache und queued einen Insert-Spec. Online
// laeuft die Live-Insert-Funktion durch — return ist die Server-Row
// (autoritativ inkl. created_at/updated_at). Offline reicht der
// Aufrufer einen synthetischen Builder, der die Row aus den Args
// + crypto.randomUUID() zusammensetzt. buildOffline darf async sein,
// damit der Builder z.B. die Position aus dem Cache ableiten kann.
export async function runOptimisticInsert<T extends { id: string; workspace_id: string }>(args: {
  table: CacheTable;
  workspaceId: string;
  buildOffline: (id: string) => T | Promise<T>;
  label?: string;
  run: () => Promise<T>;
}): Promise<T> {
  try {
    const live = await args.run();
    // Cache-Sync: damit nachfolgende Drill-Down-Reads die neue Row
    // sofort sehen, schreiben wir die Server-Row in den Cache.
    void putOne(args.table, live).catch(() => {});
    return live;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const id = crypto.randomUUID();
    const synth = await args.buildOffline(id);
    await putOne(args.table, synth);
    await enqueueMutation({
      spec: {
        kind: 'insert',
        table: args.table,
        values: synth as Record<string, unknown>,
      },
      workspaceId: args.workspaceId,
      label: args.label,
    });
    showToast(
      args.label
        ? `Offline angelegt: ${args.label}.`
        : 'Offline angelegt. Wird beim Reconnect synchronisiert.',
      'info',
    );
    return synth;
  }
}

// Optimistic-Delete: Cache-Row weg + Delete-Spec in die Queue. Online
// laeuft die Live-Delete-Funktion durch + Cache wird ebenfalls
// aufgeraeumt. Stale-Konflikt (Row schon weg) ist hier kein Problem,
// das Endergebnis (weg) ist erreicht.
//
// workspaceId optional: wenn nicht uebergeben, wird sie aus dem
// Cache gezogen (Row liegt da, weil sie aus einem vorherigen Read
// stammt). Spart den Aufrufern der zig delX(id)-Helfer den expliziten
// Workspace-Param.
export async function runOptimisticDelete(args: {
  table: CacheTable;
  id: string;
  workspaceId?: string;
  label?: string;
  run: () => Promise<void>;
}): Promise<void> {
  try {
    await args.run();
    await deleteOne(args.table, args.id);
    return;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    let wsId = args.workspaceId;
    if (!wsId) {
      const cached = await getById(args.table, args.id);
      wsId = cached?.workspace_id;
    }
    if (!wsId) {
      // Ohne workspace_id koennen wir den Spec nicht scopen — Original-
      // Fehler reichen wir durch (Row vermutlich schon weg).
      throw err;
    }
    await deleteOne(args.table, args.id);
    await enqueueMutation({
      spec: {
        kind: 'delete',
        table: args.table,
        match: { id: args.id },
      },
      workspaceId: wsId,
      label: args.label,
    });
    showToast(
      args.label
        ? `Offline geloescht: ${args.label}.`
        : 'Offline geloescht. Wird beim Reconnect synchronisiert.',
      'info',
    );
  }
}

export async function runMutation<T>(
  spec: MutationSpec,
  workspaceId: string,
  run: () => Promise<T>,
  opts?: { label?: string; quiet?: boolean },
): Promise<RunMutationResult<T>> {
  try {
    const value = await run();
    return { ok: true, value };
  } catch (err) {
    if (!isNetworkError(err)) {
      // Server-Fehler / Validation / RLS — nicht queueable. Caller
      // bekommt den Original-Fehler und kann translateDbError nutzen.
      throw err;
    }
    const entry = await enqueueMutation({
      spec,
      workspaceId,
      label: opts?.label,
    });
    if (!opts?.quiet) {
      showToast(
        opts?.label
          ? `Offline gespeichert: ${opts.label}. Wird beim Reconnect synchronisiert.`
          : 'Offline gespeichert. Wird beim Reconnect synchronisiert.',
        'info',
      );
    }
    return { ok: false, queued: true, queueId: entry.id };
  }
}
