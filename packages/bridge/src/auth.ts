import type { FastifyInstance } from 'fastify';
import type { Config } from './config.js';

const PUBLIC_ROUTES = new Set(['/healthz']);

export function registerAuth(app: FastifyInstance, config: Config): void {
  app.addHook('onRequest', async (request, reply) => {
    // Query-String abstreifen für Route-Match (/healthz?foo=bar bleibt public)
    const path = request.url.split('?')[0];
    if (PUBLIC_ROUTES.has(path)) return;

    let token: string | null = null;

    // Browser-WebSockets können keine Custom-Headers setzen → Token via Query-Param
    if (path === '/ws') {
      const url = new URL(request.url, 'http://localhost');
      token = url.searchParams.get('token');
    } else {
      const auth = request.headers.authorization;
      if (auth?.startsWith('Bearer ')) token = auth.slice(7);
    }

    if (!token) {
      reply.code(401).send({ error: 'Token fehlt' });
      return;
    }

    if (token !== config.BRIDGE_TOKEN) {
      reply.code(403).send({ error: 'Ungültiger Token' });
      return;
    }
  });
}
