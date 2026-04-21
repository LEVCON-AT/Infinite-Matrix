import { flushDb, getDb } from '../db.js';

let _latestPayload: string | null = null;
let _latestVersion = 0;

export function getLatestSnapshot(): { version: number; payload: string } | null {
  if (!_latestPayload) return null;
  return { version: _latestVersion, payload: _latestPayload };
}

export function storeSnapshot(sessionId: string, version: number, payload: string): void {
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
