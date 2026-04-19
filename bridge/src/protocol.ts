import { z } from 'zod';

// ─── Client → Bridge ───────────────────────────────────────────────

export const clientHelloSchema = z.object({
  type: z.literal('hello'),
  clientId: z.string(),
  protocolVersion: z.number().int().default(1),
  clientVersion: z.string().optional(),
});

export const clientSnapshotSchema = z.object({
  type: z.literal('snapshot'),
  version: z.number().int(),
  payload: z.string(), // JSON-String von getPayload()
});

export const clientToolResultSchema = z.object({
  type: z.literal('tool.result'),
  callId: z.string(),
  ok: z.literal(true),
  result: z.unknown(),
});

export const clientToolErrorSchema = z.object({
  type: z.literal('tool.error'),
  callId: z.string(),
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export const clientPongSchema = z.object({
  type: z.literal('pong'),
  seq: z.number().int(),
});

export const clientMsgSchema = z.discriminatedUnion('type', [
  clientHelloSchema,
  clientSnapshotSchema,
  clientToolResultSchema,
  clientToolErrorSchema,
  clientPongSchema,
]);

export type ClientMsg = z.infer<typeof clientMsgSchema>;
export type ClientHello = z.infer<typeof clientHelloSchema>;
export type ClientSnapshot = z.infer<typeof clientSnapshotSchema>;
export type ClientToolResult = z.infer<typeof clientToolResultSchema>;
export type ClientToolError = z.infer<typeof clientToolErrorSchema>;

// ─── Bridge → Client ───────────────────────────────────────────────

export const bridgeHelloAckSchema = z.object({
  type: z.literal('hello.ack'),
  sessionId: z.string(),
  serverVersion: z.string(),
});

export const bridgeToolCallSchema = z.object({
  type: z.literal('tool.call'),
  callId: z.string(),
  tool: z.string(),
  args: z.record(z.unknown()),
});

export const bridgeStateRequestSchema = z.object({
  type: z.literal('state.request'),
});

export const bridgePingSchema = z.object({
  type: z.literal('ping'),
  seq: z.number().int(),
});

export const bridgeNoticeSchema = z.object({
  type: z.literal('notice'),
  level: z.enum(['info', 'warn', 'error']),
  message: z.string(),
});

export const bridgeMsgSchema = z.discriminatedUnion('type', [
  bridgeHelloAckSchema,
  bridgeToolCallSchema,
  bridgeStateRequestSchema,
  bridgePingSchema,
  bridgeNoticeSchema,
]);

export type BridgeMsg = z.infer<typeof bridgeMsgSchema>;
export type BridgeToolCall = z.infer<typeof bridgeToolCallSchema>;
