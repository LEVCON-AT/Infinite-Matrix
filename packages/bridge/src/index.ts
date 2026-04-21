import cors from '@fastify/cors';
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

await app.register(cors, { origin: true });

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
