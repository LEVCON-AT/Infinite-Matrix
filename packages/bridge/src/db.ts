import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import initSqlJs, { type Database } from 'sql.js';
import type { Config } from './config.js';

let _db: Database | null = null;
let _dbPath: string;

const MIGRATIONS = [
  // v1: Basis-Tabellen
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    connected_at TEXT NOT NULL DEFAULT (datetime('now')),
    disconnected_at TEXT,
    protocol_version INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    version INTEGER NOT NULL,
    payload TEXT NOT NULL,
    received_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    tool_name TEXT NOT NULL,
    call_id TEXT NOT NULL,
    args TEXT,
    result TEXT,
    ok INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1');`,
];

export async function initDb(config: Config): Promise<Database> {
  if (_db) return _db;

  _dbPath = config.DB_PATH;
  const dir = dirname(_dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const SQL = await initSqlJs();

  if (existsSync(_dbPath)) {
    const buffer = readFileSync(_dbPath);
    _db = new SQL.Database(buffer);
  } else {
    _db = new SQL.Database();
  }

  // WAL-Modus ist bei sql.js nicht nötig (in-memory + flush)
  _db.run('PRAGMA journal_mode = DELETE;');
  _db.run('PRAGMA foreign_keys = ON;');

  for (const migration of MIGRATIONS) {
    _db.run(migration);
  }

  flushDb();
  return _db;
}

export function getDb(): Database {
  if (!_db) throw new Error('DB nicht initialisiert — initDb() zuerst aufrufen');
  return _db;
}

export function flushDb(): void {
  if (!_db) return;
  const data = _db.export();
  writeFileSync(_dbPath, Buffer.from(data));
}

export function closeDb(): void {
  if (!_db) return;
  flushDb();
  _db.close();
  _db = null;
}
