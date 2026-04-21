import { describe, expect, it } from 'vitest';
import { bridgeMsgSchema, clientMsgSchema } from '../src/protocol.js';

describe('clientMsgSchema', () => {
  it('parsed gültiges hello', () => {
    const result = clientMsgSchema.safeParse({
      type: 'hello',
      clientId: 'test-client',
      protocolVersion: 1,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('hello');
    }
  });

  it('parsed gültiges snapshot', () => {
    const result = clientMsgSchema.safeParse({
      type: 'snapshot',
      version: 42,
      payload: '{"nodes":{}}',
    });
    expect(result.success).toBe(true);
  });

  it('parsed gültiges tool.result', () => {
    const result = clientMsgSchema.safeParse({
      type: 'tool.result',
      callId: 'abc-123',
      ok: true,
      result: { created: true },
    });
    expect(result.success).toBe(true);
  });

  it('parsed gültiges tool.error', () => {
    const result = clientMsgSchema.safeParse({
      type: 'tool.error',
      callId: 'abc-123',
      ok: false,
      error: { code: 'not_found', message: 'Nicht gefunden' },
    });
    expect(result.success).toBe(true);
  });

  it('lehnt unbekannten type ab', () => {
    const result = clientMsgSchema.safeParse({
      type: 'invalid',
      data: 'foo',
    });
    expect(result.success).toBe(false);
  });

  it('lehnt fehlende Pflichtfelder ab', () => {
    const result = clientMsgSchema.safeParse({
      type: 'hello',
      // clientId fehlt
    });
    expect(result.success).toBe(false);
  });
});

describe('bridgeMsgSchema', () => {
  it('parsed hello.ack', () => {
    const result = bridgeMsgSchema.safeParse({
      type: 'hello.ack',
      sessionId: 'sess-1',
      serverVersion: '0.1.0',
    });
    expect(result.success).toBe(true);
  });

  it('parsed tool.call', () => {
    const result = bridgeMsgSchema.safeParse({
      type: 'tool.call',
      callId: 'call-1',
      tool: 'matrix.state.get',
      args: {},
    });
    expect(result.success).toBe(true);
  });

  it('parsed state.request', () => {
    const result = bridgeMsgSchema.safeParse({ type: 'state.request' });
    expect(result.success).toBe(true);
  });

  it('parsed ping', () => {
    const result = bridgeMsgSchema.safeParse({ type: 'ping', seq: 1 });
    expect(result.success).toBe(true);
  });

  it('parsed notice', () => {
    const result = bridgeMsgSchema.safeParse({
      type: 'notice',
      level: 'info',
      message: 'Test',
    });
    expect(result.success).toBe(true);
  });
});
