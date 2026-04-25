import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { registerAuth } from './auth.js';
import { loadConfig } from './config.js';
import { closeDb, initDb } from './db.js';
import { registerMcp } from './mcp.js';
import { registerAllTools } from './tools/index.js';
import { registerWs } from './ws.js';

const config = loadConfig();

const app = Fastify({
  logger: {
    level: config.LOG_LEVEL,
    transport:
      config.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  },
});

// CORS (ASVS V1.14.1) — Allowlist via CORS_ORIGINS-Env. Dev-Fallback
// auf reflektiv-true bleibt erhalten, weil sonst der lokale Browser-
// Test (localhost:3848) nicht laeuft. Prod: CORS_ORIGINS muss gesetzt
// sein.
//
// Validierung: jeder Origin durchlaeuft den URL-Constructor. Schemas
// werden auf http/https gewhitelistet — ohne diese Pruefung wuerde
// ein versehentlich gepflegter Eintrag wie "evil.example" (kein
// Schema) oder "javascript:alert(1)" als Origin durchgereicht. Auf
// Match wirft @fastify/cors die Anfrage ab; ohne Match liegt kein
// Schaden vor, aber ein Tippfehler wird hier sichtbar (warn-Log) und
// nicht erst am Browser-Client.
function sanitizeCorsAllowlist(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((origin) => {
      try {
        const u = new URL(origin);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          app.log.warn('CORS_ORIGINS: Eintrag "%s" mit nicht-http(s)-Schema ignoriert', origin);
          return false;
        }
        // URL("https://x.com/").origin === "https://x.com" — nur das
        // Origin-Tripel (scheme + host + port) ist relevant. Ein Eintrag
        // mit Pfad wuerde von @fastify/cors als Substring-Match anders
        // behandelt; wir lehnen das hier explizit ab.
        if (origin !== u.origin) {
          app.log.warn(
            'CORS_ORIGINS: Eintrag "%s" enthaelt Pfad/Trailing-Slash — nutze nur Origin "%s"',
            origin,
            u.origin,
          );
          return false;
        }
        return true;
      } catch {
        app.log.warn('CORS_ORIGINS: Eintrag "%s" ist keine valide URL', origin);
        return false;
      }
    });
}
const corsOrigins = config.CORS_ORIGINS ? sanitizeCorsAllowlist(config.CORS_ORIGINS) : null;
// origin-Logik: Allowlist wenn gepflegt; sonst Prod=false (Lockdown),
// Dev=true (reflektiv fuer localhost-Workflow).
const corsOrigin =
  corsOrigins && corsOrigins.length > 0 ? corsOrigins : config.NODE_ENV !== 'production';
await app.register(cors, { origin: corsOrigin });
if (!corsOrigins && config.NODE_ENV === 'production') {
  app.log.warn(
    'CORS_ORIGINS nicht gesetzt — CORS in Prod auf false. Wenn der Browser-Client unter einer anderen Origin laeuft, Allowlist explizit pflegen.',
  );
}

// Rate-Limit (ASVS V13.1.1) — Default fuer alle Routen, plus
// strengere Caps auf /mcp und /ws-Handshake (siehe ws.ts/mcp.ts).
// 50r/s pro IP fuer normale API-Calls, 200/Minute Burst-Buffer.
// /healthz wird via skipOnError ignoriert (Monitoring-Tools sollen
// nicht ausgesperrt werden).
await app.register(rateLimit, {
  max: 50,
  timeWindow: '1 second',
  // Burst-Cache: kurze Spitzen toleriert, dauerhaft hoch -> 429.
  cache: 5000,
  // Health-Checks ausnehmen — Uptimerobot soll den Endpoint poll'en
  // koennen ohne in das Limit zu laufen.
  allowList: (req) => req.url === '/healthz',
  errorResponseBuilder: () => ({
    error: 'rate_limited',
    message: 'Zu viele Anfragen. Bitte kurz warten.',
  }),
});

registerAuth(app, config);

// Health-Endpoint
app.get('/healthz', async () => ({
  ok: true,
  uptime: process.uptime(),
  version: '0.1.0',
}));

// Bootstrap
async function start(): Promise<void> {
  try {
    await initDb(config);
    app.log.info('SQLite initialisiert (%s)', config.DB_PATH);

    await registerWs(app, config);
    app.log.info('WebSocket-Handler registriert');

    registerAllTools();
    await registerMcp(app);

    await app.listen({ port: config.PORT, host: config.HOST });
    app.log.info('Bridge läuft auf %s:%d', config.HOST, config.PORT);
  } catch (err) {
    app.log.fatal(err, 'Startfehler');
    process.exit(1);
  }
}

// Graceful Shutdown
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    app.log.info('Signal %s — fahre herunter', signal);
    await app.close();
    closeDb();
    process.exit(0);
  });
}

await start();

export { app, config };
