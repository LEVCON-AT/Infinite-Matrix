import type { FastifyInstance } from 'fastify';
import type { Config } from './config.js';

const PUBLIC_ROUTES = new Set(['/healthz']);

export function registerAuth(app: FastifyInstance, config: Config): void {
  app.addHook('onRequest', async (request, reply) => {
    if (PUBLIC_ROUTES.has(request.url)) return;

    const auth = request.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      reply.code(401).send({ error: 'Bearer-Token fehlt' });
      return;
    }

    const token = auth.slice(7);
    if (token !== config.BRIDGE_TOKEN) {
      reply.code(403).send({ error: 'Ungültiger Token' });
      return;
    }
  });
}
