import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyInstance } from 'fastify';
import { getTools, invokeTool } from './dispatcher.js';

interface McpSession {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

const _sessions = new Map<string, McpSession>();

function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'infinite-matrix', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  for (const [name, tool] of getTools()) {
    server.registerTool(
      name,
      {
        description: tool.description,
        inputSchema: tool.schema,
      },
      async (args: Record<string, unknown>) => {
        try {
          const result = await invokeTool(name, args);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: 'text' as const, text: `Fehler: ${msg}` }],
            isError: true,
          };
        }
      },
    );
  }

  return server;
}

export async function registerMcp(app: FastifyInstance): Promise<void> {
  app.post('/mcp', async (request, reply) => {
    const sessionId = request.headers['mcp-session-id'] as string | undefined;
    let session = sessionId ? _sessions.get(sessionId) : undefined;

    if (!session) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });
      const server = createMcpServer();
      await server.connect(transport);

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) _sessions.delete(sid);
      };

      session = { server, transport };

      // handleRequest muss laufen bevor sessionId verfügbar ist
      await transport.handleRequest(request.raw, reply.raw, request.body);

      if (transport.sessionId) {
        _sessions.set(transport.sessionId, session);
      }

      reply.hijack();
      return;
    }

    await session.transport.handleRequest(request.raw, reply.raw, request.body);
    reply.hijack();
  });

  app.get('/mcp', async (request, reply) => {
    const sessionId = request.headers['mcp-session-id'] as string | undefined;
    const session = sessionId ? _sessions.get(sessionId) : undefined;
    if (!session) {
      reply.code(400).send({ error: 'Ungültige oder fehlende MCP-Session-ID' });
      return;
    }
    await session.transport.handleRequest(request.raw, reply.raw);
    reply.hijack();
  });

  app.delete('/mcp', async (request, reply) => {
    const sessionId = request.headers['mcp-session-id'] as string | undefined;
    const session = sessionId ? _sessions.get(sessionId) : undefined;
    if (!session) {
      reply.code(400).send({ error: 'Ungültige oder fehlende MCP-Session-ID' });
      return;
    }
    await session.transport.handleRequest(request.raw, reply.raw);
    await session.server.close();
    if (sessionId) _sessions.delete(sessionId);
    reply.hijack();
  });

  app.log.info('MCP-Server registriert (%d Tools)', getTools().size);
}
