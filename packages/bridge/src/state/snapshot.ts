import { flushDb, getDb } from '../db.js';

// AU-B1 K9 (B1-I-010): Snapshot-Groessen-Limit gegen DoS via grosse
// Payloads. 10 MB ist grosszuegig fuer normale Workspace-Snapshots
// (~100K Cells / Cards / Checklists). Jenseits davon: Disk-Fill-Risk
// + SQLite-Performance-Cliff. CWE-400.
const MAX_SNAPSHOT_BYTES = 10 * 1024 * 1024;

let _latestPayload: string | null = null;
let _latestVersion = 0;

export function getLatestSnapshot(): { version: number; payload: string } | null {
  if (!_latestPayload) return null;
  return { version: _latestVersion, payload: _latestPayload };
}

export function storeSnapshot(sessionId: string, version: number, payload: string): void {
  // AU-B1 K9 (B1-I-010): Groessen-Check vor jedem Insert. Lehnt
  // ueber-grosse Payloads ab statt sie in SQLite + Memory zu pumpen.
  if (payload.length > MAX_SNAPSHOT_BYTES) {
    console.warn(
      `[snapshot] Payload zu gross (${payload.length} > ${MAX_SNAPSHOT_BYTES}) — abgelehnt fuer session=${sessionId}`,
    );
    return;
  }

  _latestPayload = payload;
  _latestVersion = version;

  const db = getDb();
  db.run('INSERT INTO snapshots (session_id, version, payload) VALUES (?, ?, ?)', [
    sessionId,
    version,
    payload,
  ]);
  flushDb();
}
