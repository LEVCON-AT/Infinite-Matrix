import { randomUUID } from 'node:crypto';
import websocket from '@fastify/websocket';
import type { FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import { flushDb, getDb } from './db.js';
import { type BridgeMsg, type ClientMsg, clientMsgSchema } from './protocol.js';
import {
  type Session,
  clearSession,
  createSession,
  getSession,
  hasSession,
  rejectToolCall,
  resolveToolCall,
} from './state/session.js';
import { storeSnapshot } from './state/snapshot.js';

type Logger = FastifyInstance['log'];
type Socket = import('@fastify/websocket').WebSocket;

// Parsen + Schema-Validierung in einem Schritt. Bei Fehler wird der
// Client per notice informiert und null zurueckgegeben — Caller bricht
// dann ab.
function parseAndValidate(raw: Buffer | string, socket: Socket, log: Logger): ClientMsg | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    sendMsg(socket, { type: 'notice', level: 'error', message: 'Ungültiges JSON' });
    return null;
  }
  const result = clientMsgSchema.safeParse(parsed);
  if (!result.success) {
    log.warn({ errors: result.error.issues }, 'Ungültige Client-Nachricht');
    sendMsg(socket, {
      type: 'notice',
      level: 'warn',
      message: `Ungültige Nachricht: ${result.error.issues[0]?.message}`,
    });
    return null;
  }
  return result.data;
}

// Erste Nachricht muss type:'hello' sein. Erfolgreiche Initialisierung
// signalisiert der Caller via Rueckgabewert true.
function tryEstablishSession(msg: ClientMsg, socket: Socket, log: Logger): boolean {
  if (msg.type !== 'hello') {
    sendMsg(socket, {
      type: 'notice',
      level: 'error',
      message: 'Erste Nachricht muss type:hello sein',
    });
    socket.close(4003, 'Expected hello');
    return false;
  }
  const sessionId = randomUUID();
  createSession(sessionId, msg.clientId, socket, msg.protocolVersion);
  const db = getDb();
  db.run('INSERT INTO sessions (id, client_id, protocol_version) VALUES (?, ?, ?)', [
    sessionId,
    msg.clientId,
    msg.protocolVersion,
  ]);
  flushDb();
  log.info({ sessionId, clientId: msg.clientId }, 'Client verbunden');
  sendMsg(socket, { type: 'hello.ack', sessionId, serverVersion: '0.1.0' });
  sendMsg(socket, { type: 'state.request' });
  return true;
}

// Post-Hello-Dispatch. Switch ist hier isoliert, damit der message-
// Handler oben unter dem Komplexitaets-Limit bleibt (biome:
// noExcessiveCognitiveComplexity).
function dispatchClientMsg(msg: ClientMsg, session: Session, log: Logger): void {
  switch (msg.type) {
    case 'snapshot':
      storeSnapshot(session.id, msg.version, msg.payload);
      session.snapshotVersion = msg.version;
      log.debug({ version: msg.version }, 'Snapshot empfangen');
      break;
    case 'tool.result':
      resolveToolCall(msg.callId, msg.result);
      log.debug({ callId: msg.callId }, 'Tool-Result empfangen');
      break;
    case 'tool.error':
      rejectToolCall(msg.callId, new Error(msg.error.message));
      log.warn({ callId: msg.callId, error: msg.error }, 'Tool-Error empfangen');
      break;
    case 'pong':
      log.trace({ seq: msg.seq }, 'Pong empfangen');
      break;
    case 'hello':
      // Doppeltes Hello ignorieren — Session laeuft bereits.
      break;
  }
}

export async function registerWs(app: FastifyInstance, config: Config): Promise<void> {
  await app.register(websocket);

  app.get('/ws', { websocket: true }, (socket, request) => {
    // Token-Prüfung aus Query-Param oder Header
    const url = new URL(request.url, `http://${request.hostname}`);
    const tokenParam = url.searchParams.get('token');
    const authHeader = request.headers.authorization;
    const token = tokenParam || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null);

    if (token !== config.BRIDGE_TOKEN) {
      sendMsg(socket, { type: 'notice', level: 'error', message: 'Ungültiger Token' });
      socket.close(4001, 'Unauthorized');
      return;
    }

    if (hasSession()) {
      sendMsg(socket, {
        type: 'notice',
        level: 'error',
        message: 'Session bereits aktiv — nur ein Client gleichzeitig erlaubt (v1)',
      });
      socket.close(4002, 'Session busy');
      return;
    }

    // Auf Hello warten — erster Message muss type:'hello' sein
    let helloReceived = false;

    socket.on('message', (raw: Buffer | string) => {
      const msg = parseAndValidate(raw, socket, app.log);
      if (!msg) return;
      if (!helloReceived) {
        helloReceived = tryEstablishSession(msg, socket, app.log);
        return;
      }
      const session = getSession();
      if (!session) return;
      dispatchClientMsg(msg, session, app.log);
    });

    socket.on('close', () => {
      const session = getSession();
      if (session) {
        // Disconnect in DB loggen
        const db = getDb();
        db.run("UPDATE sessions SET disconnected_at = datetime('now') WHERE id = ?", [session.id]);
        flushDb();

        app.log.info({ sessionId: session.id }, 'Client getrennt');
        clearSession();
      }
    });

    socket.on('error', (err: Error) => {
      app.log.error(err, 'WebSocket-Fehler');
      clearSession();
    });
  });
}

function sendMsg(ws: import('@fastify/websocket').WebSocket, msg: BridgeMsg): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export { sendMsg };
