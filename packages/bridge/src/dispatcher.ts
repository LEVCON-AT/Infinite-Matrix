import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { flushDb, getDb } from './db.js';
import { getSession, registerToolCall } from './state/session.js';
import { sendMsg } from './ws.js';

// Felder, die niemals im Audit-Log landen sollen (ASVS V7.3.3 — keine
// sensitiven Daten in Logs). Aktuell hat kein Tool-Schema solche
// Felder, aber das ist defense-in-depth fuer kuenftigen Ausbau:
// neue Tools koennen Passwort/Token-Felder bekommen, ohne dass jemand
// das Audit-Log-Verhalten anfasst.
const REDACTED = '[REDACTED]';
const SECRET_FIELDS = new Set([
  'password',
  'pw',
  'passphrase',
  'token',
  'apikey',
  'api_key',
  'secret',
  'authorization',
]);

function scrubArgs(value: unknown): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map((v) => scrubArgs(v));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_FIELDS.has(k.toLowerCase()) ? REDACTED : scrubArgs(v);
    }
    return out;
  }
  return value;
}

export interface ToolDef {
  name: string;
  description: string;
  schema: z.ZodType;
  jsonSchema: Record<string, unknown>;
}

const _tools = new Map<string, ToolDef>();

export function registerTool(tool: ToolDef): void {
  _tools.set(tool.name, tool);
}

export function getTools(): Map<string, ToolDef> {
  return _tools;
}

export async function invokeTool(name: string, rawArgs: unknown): Promise<unknown> {
  const tool = _tools.get(name);
  if (!tool) throw new Error(`Unbekanntes Tool: ${name}`);

  // Argumente validieren
  const parseResult = tool.schema.safeParse(rawArgs);
  if (!parseResult.success) {
    const issues = parseResult.error.issues
      .map(
        (i: { path: (string | number)[]; message: string }) => `${i.path.join('.')}: ${i.message}`,
      )
      .join('; ');
    throw new Error(`Ungültige Argumente für ${name}: ${issues}`);
  }

  const session = getSession();
  if (!session) throw new Error('Keine aktive Matrix-Session');

  const callId = randomUUID();

  // Tool-Call an Client senden
  sendMsg(session.ws, {
    type: 'tool.call',
    callId,
    tool: name,
    args: parseResult.data as Record<string, unknown>,
  });

  // Auf Antwort warten (Timeout in registerToolCall)
  const resultPromise = registerToolCall(callId);

  const db = getDb();
  // Args scrubben: bekannte Secret-Field-Namen werden vor dem
  // Stringify durch [REDACTED] ersetzt. Result wird ebenfalls
  // gescrubbt — wenn ein Tool z.B. einen frisch generierten Token
  // zurueckgibt, soll der nicht in der Audit-DB liegen.
  const scrubbedArgsJson = JSON.stringify(scrubArgs(rawArgs));
  try {
    const result = await resultPromise;

    // Audit-Log: Erfolg
    db.run(
      'INSERT INTO audit_log (session_id, tool_name, call_id, args, result, ok) VALUES (?, ?, ?, ?, ?, 1)',
      [session.id, name, callId, scrubbedArgsJson, JSON.stringify(scrubArgs(result))],
    );
    flushDb();

    return result;
  } catch (err) {
    // Audit-Log: Fehler
    const msg = err instanceof Error ? err.message : String(err);
    db.run(
      'INSERT INTO audit_log (session_id, tool_name, call_id, args, result, ok) VALUES (?, ?, ?, ?, ?, 0)',
      [session.id, name, callId, scrubbedArgsJson, msg],
    );
    flushDb();

    throw err;
  }
}
