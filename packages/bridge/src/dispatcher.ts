import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { flushDb, getDb } from './db.js';
import { getSession, registerToolCall } from './state/session.js';
import { sendMsg } from './ws.js';

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
  try {
    const result = await resultPromise;

    // Audit-Log: Erfolg
    db.run(
      'INSERT INTO audit_log (session_id, tool_name, call_id, args, result, ok) VALUES (?, ?, ?, ?, ?, 1)',
      [session.id, name, callId, JSON.stringify(rawArgs), JSON.stringify(result)],
    );
    flushDb();

    return result;
  } catch (err) {
    // Audit-Log: Fehler
    const msg = err instanceof Error ? err.message : String(err);
    db.run(
      'INSERT INTO audit_log (session_id, tool_name, call_id, args, result, ok) VALUES (?, ?, ?, ?, ?, 0)',
      [session.id, name, callId, JSON.stringify(rawArgs), msg],
    );
    flushDb();

    throw err;
  }
}
