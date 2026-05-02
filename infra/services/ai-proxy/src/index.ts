// Matrix AI-Proxy.
//
// Wraps OpenAI + Gemini API-Calls server-side, weil deren Endpoints
// keine browser-direkten CORS-Headers anbieten. Anthropic geht direkt
// aus dem Browser (dangerous-direct-browser-access-Flag) — dieser
// Proxy ist nur fuer OpenAI + Gemini.
//
// Sicherheits-Modell V1 (passthrough):
//   - Origin-Whitelist: nur staging.matrix.levcon.at + localhost.
//   - Authorization: Bearer <user_jwt> Pflicht. Wir validieren NICHT
//     gegen Supabase-public-key (dafuer bräuchten wir den jwks-
//     endpoint und ein crypto-lib) — V1 reicht der "anwesend"-Check;
//     nginx hat zusaetzlich rate-limiting konfiguriert.
//   - Body durchgereicht 1:1. apiKey kommt im Body (apiKey-Field).
//
// V2 wird eine sauberere Variante haben: Service holt apiKey aus DB
// via service_role-RPC, decryptet, macht Outbound. Browser sieht den
// Key nie. Bedingt User-JWT-Validation gegen Supabase-jwks.
//
// Endpoints:
//   POST /openai
//     Body: { apiKey, model, messages, tools, ... }
//     Returns: SSE-stream von OpenAI Chat-Completions.
//   POST /gemini/{model}
//     Body: { apiKey, contents, systemInstruction, tools, ... }
//     Returns: SSE-stream von Gemini streamGenerateContent.
//
// Boot:
//   PORT=8081 node dist/index.js
//
// nginx:
//   location /api/ai-proxy/ {
//     proxy_pass http://127.0.0.1:8081/;
//     proxy_buffering off;     # SSE-stream nicht puffern
//     proxy_read_timeout 300s; # lange LLM-Calls
//   }

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const PORT = Number(process.env.PORT ?? 8081);

const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/staging\.matrix\.levcon\.at$/,
  /^https:\/\/matrix\.levcon\.at$/,
  /^http:\/\/localhost:\d+$/,
];

function corsHeaders(req: IncomingMessage): Record<string, string> {
  const origin = (req.headers.origin as string | undefined) ?? '';
  const allowed = ALLOWED_ORIGIN_PATTERNS.some((p) => p.test(origin));
  if (!allowed) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) {
    chunks.push(typeof c === 'string' ? Buffer.from(c) : (c as Buffer));
  }
  return Buffer.concat(chunks);
}

async function streamUpstream(
  upstream: Response,
  res: ServerResponse,
  req: IncomingMessage,
): Promise<void> {
  res.writeHead(upstream.status, {
    ...corsHeaders(req),
    'content-type': upstream.headers.get('content-type') ?? 'application/json',
    'cache-control': 'no-cache',
  });
  // Body-Snippet immer loggen (temporary fuer Debug). Begrenzt auf
  // 2KB. Spiegelt sowohl Errors als auch erste Chunks von Streams,
  // damit wir Empty-Responses und Stream-Format-Issues sehen.
  const isError = upstream.status < 200 || upstream.status >= 300;
  const debugLog = process.env.AI_PROXY_DEBUG === '1' || isError;
  if (!upstream.body) {
    console.log(`[ai-proxy] upstream ${upstream.status} (no body)`);
    res.end();
    return;
  }
  const reader = upstream.body.getReader();
  let bytesTotal = 0;
  let firstSnippet = '';
  let chunkCount = 0;
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytesTotal += value.byteLength;
    chunkCount += 1;
    if (debugLog && firstSnippet.length < 2048) {
      firstSnippet += decoder.decode(value, { stream: true }).slice(0, 2048 - firstSnippet.length);
    }
    res.write(Buffer.from(value));
  }
  res.end();
  console.log(`[ai-proxy] upstream ${upstream.status} bytes=${bytesTotal} chunks=${chunkCount}`);
  if (debugLog && firstSnippet) {
    console.log(`[ai-proxy] body-snippet: ${firstSnippet.replace(/\n/g, '\\n')}`);
  }
}

function jsonError(req: IncomingMessage, res: ServerResponse, status: number, msg: string): void {
  res.writeHead(status, {
    ...corsHeaders(req),
    'content-type': 'application/json',
  });
  res.end(JSON.stringify({ error: msg }));
}

async function handleOpenAi(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const raw = await readBody(req);
  let body: { apiKey?: string } & Record<string, unknown>;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    jsonError(req, res, 400, 'invalid_json');
    return;
  }
  const apiKey = body.apiKey;
  if (!apiKey || typeof apiKey !== 'string') {
    jsonError(req, res, 400, 'apiKey_required');
    return;
  }
  // apiKey aus dem upstream-body strippen
  const { apiKey: _drop, ...providerBody } = body;
  void _drop;

  const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(providerBody),
  });
  await streamUpstream(upstream, res, req);
}

async function handleGemini(
  req: IncomingMessage,
  res: ServerResponse,
  modelId: string,
): Promise<void> {
  const raw = await readBody(req);
  let body: { apiKey?: string } & Record<string, unknown>;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    jsonError(req, res, 400, 'invalid_json');
    return;
  }
  const apiKey = body.apiKey;
  if (!apiKey || typeof apiKey !== 'string') {
    jsonError(req, res, 400, 'apiKey_required');
    return;
  }
  const { apiKey: _drop, ...providerBody } = body;
  void _drop;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
  const upstream = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(providerBody),
  });
  await streamUpstream(upstream, res, req);
}

const server = createServer(async (req, res) => {
  const startMs = Date.now();
  const reqLog = `${req.method} ${req.url}`;
  try {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders(req));
      res.end();
      console.log(`[ai-proxy] ${reqLog} 204 (preflight) ${Date.now() - startMs}ms`);
      return;
    }
    if (req.method !== 'POST') {
      jsonError(req, res, 405, 'method_not_allowed');
      console.warn(`[ai-proxy] ${reqLog} 405`);
      return;
    }
    // Origin-Check (nicht via cors-headers, hart blocken).
    const origin = (req.headers.origin as string | undefined) ?? '';
    if (origin && !ALLOWED_ORIGIN_PATTERNS.some((p) => p.test(origin))) {
      jsonError(req, res, 403, 'origin_not_allowed');
      console.warn(`[ai-proxy] ${reqLog} 403 origin=${origin}`);
      return;
    }
    // User-JWT Anwesenheits-Check (V1).
    const auth = req.headers['authorization'] as string | undefined;
    if (!auth || !auth.startsWith('Bearer ')) {
      jsonError(req, res, 401, 'unauthenticated');
      console.warn(`[ai-proxy] ${reqLog} 401 (no bearer)`);
      return;
    }

    const url = new URL(req.url ?? '/', 'http://internal');
    if (url.pathname === '/openai') {
      await handleOpenAi(req, res);
      console.log(`[ai-proxy] POST /openai ${res.statusCode} ${Date.now() - startMs}ms`);
      return;
    }
    if (url.pathname.startsWith('/gemini/')) {
      const modelId = url.pathname.slice('/gemini/'.length);
      if (!modelId) {
        jsonError(req, res, 400, 'model_required');
        console.warn(`[ai-proxy] ${reqLog} 400 (no model)`);
        return;
      }
      await handleGemini(req, res, modelId);
      console.log(
        `[ai-proxy] POST /gemini/${modelId} ${res.statusCode} ${Date.now() - startMs}ms`,
      );
      return;
    }
    jsonError(req, res, 404, 'not_found');
    console.warn(`[ai-proxy] ${reqLog} 404`);
  } catch (err) {
    console.error(`[ai-proxy] ${reqLog} 502:`, err);
    jsonError(req, res, 502, (err as Error).message ?? 'upstream_error');
  }
});

// Bind nur auf 127.0.0.1 (loopback). nginx proxy_pass routed darauf.
// Defense-in-Depth: selbst wenn Ionos-Firewall Port 8081 oeffnet,
// kommt nichts von ausserhalb durch — der Service ist nicht
// reachable.
const HOST = process.env.HOST ?? '127.0.0.1';
server.listen(PORT, HOST, () => {
  console.log(`[ai-proxy] listening on ${HOST}:${PORT}`);
});

const shutdown = (sig: string) => {
  console.log(`[ai-proxy] ${sig} — shutting down`);
  server.close(() => process.exit(0));
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
