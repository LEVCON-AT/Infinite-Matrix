import type { WebSocket } from '@fastify/websocket';

interface Deferred<T = unknown> {
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface Session {
  id: string;
  clientId: string;
  ws: WebSocket;
  connectedAt: Date;
  protocolVersion: number;
  pendingToolCalls: Map<string, Deferred>;
  snapshotVersion: number;
}

const TOOL_CALL_TIMEOUT_MS = 15_000;

let _session: Session | null = null;

export function getSession(): Session | null {
  return _session;
}

export function hasSession(): boolean {
  return _session !== null;
}

export function createSession(
  id: string,
  clientId: string,
  ws: WebSocket,
  protocolVersion: number,
): Session {
  _session = {
    id,
    clientId,
    ws,
    connectedAt: new Date(),
    protocolVersion,
    pendingToolCalls: new Map(),
    snapshotVersion: 0,
  };
  return _session;
}

export function clearSession(): void {
  if (!_session) return;
  // Alle ausstehenden Tool-Calls mit Fehler ablehnen
  for (const [callId, deferred] of _session.pendingToolCalls) {
    clearTimeout(deferred.timer);
    deferred.reject(new Error(`Session beendet, Tool-Call ${callId} abgebrochen`));
  }
  _session.pendingToolCalls.clear();
  _session = null;
}

export function registerToolCall(callId: string): Promise<unknown> {
  const session = _session;
  if (!session) return Promise.reject(new Error('Keine aktive Session'));

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      session.pendingToolCalls.delete(callId);
      reject(new Error(`Tool-Call ${callId} Timeout nach ${TOOL_CALL_TIMEOUT_MS}ms`));
    }, TOOL_CALL_TIMEOUT_MS);

    session.pendingToolCalls.set(callId, { resolve, reject, timer });
  });
}

export function resolveToolCall(callId: string, result: unknown): boolean {
  if (!_session) return false;
  const deferred = _session.pendingToolCalls.get(callId);
  if (!deferred) return false;

  clearTimeout(deferred.timer);
  _session.pendingToolCalls.delete(callId);
  deferred.resolve(result);
  return true;
}

export function rejectToolCall(callId: string, error: Error): boolean {
  if (!_session) return false;
  const deferred = _session.pendingToolCalls.get(callId);
  if (!deferred) return false;

  clearTimeout(deferred.timer);
  _session.pendingToolCalls.delete(callId);
  deferred.reject(error);
  return true;
}
