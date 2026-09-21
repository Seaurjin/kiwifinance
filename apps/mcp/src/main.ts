/**
 * Remote MCP entry point.
 *
 * Stateless Streamable HTTP: each request carries its own session, so the
 * server can be restarted or scaled without dropping a connection.
 *
 * Authentication here is a bearer token carrying scopes. Full OAuth 2.1 with
 * PKCE and dynamic client registration (FR-OPN-04) is the next step and needs a
 * deployed authorisation server; the scope model, the read-only default and the
 * audit trail — the parts that decide what an outside AI can actually do — are
 * in place and tested now.
 */

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { LedgerStore, seedDemo } from '@kiwi/store';
import Fastify from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { buildMcpServer } from './server.ts';
import type { Scope, Session } from './tools.ts';

const today = (): string => new Date().toISOString().slice(0, 10);

const store = LedgerStore.open(process.env['KIWI_DB'] ?? ':memory:');
const seeded = seedDemo(store, today());

/**
 * Demo tokens. A real deployment issues these from the OAuth flow, short-lived
 * and rotated; what matters structurally is that the scope travels with the
 * token and the write scope is a separate grant.
 */
const TOKENS: Record<string, { client: string; scopes: Scope[] }> = {
  [process.env['KIWI_READ_TOKEN'] ?? 'demo-read']: { client: 'demo-client', scopes: ['read'] },
  [process.env['KIWI_WRITE_TOKEN'] ?? 'demo-write']: {
    client: 'demo-client',
    scopes: ['read', 'write'],
  },
};

const app = Fastify({ logger: false });

app.post('/mcp', async (request, reply) => {
  const header = request.headers.authorization ?? '';
  const grant = TOKENS[header.replace(/^Bearer\s+/i, '')];

  if (grant === undefined) {
    return reply
      .status(401)
      .header('www-authenticate', 'Bearer realm="kiwi", error="invalid_token"')
      .send({ error: 'unauthorized' });
  }

  const session: Session = {
    ledgerId: seeded.ledgerId,
    client: grant.client,
    scopes: grant.scopes,
    today,
  };

  const server = buildMcpServer(store, session);
  // Stateless: undefined means "no session id", so each request stands alone.
  // Giving it a generator would make the transport stateful, and since a fresh
  // server is built per request there would be nothing for a session to
  // continue into — the second call would be told the server is not initialised.
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    // The option is typed as required, but undefined is what the SDK reads as
    // "stateless"; under exactOptionalPropertyTypes the two do not unify.
  } as unknown as ConstructorParameters<typeof StreamableHTTPServerTransport>[0]);

  reply.raw.on('close', () => {
    void transport.close();
    void server.close();
  });

  // The SDK's Transport interface declares onclose as required while the
  // transport class leaves it optional, so under exactOptionalPropertyTypes the
  // two do not unify. Both objects are the SDK's own; this narrows a typing
  // mismatch, not a behavioural one.
  await server.connect(transport as unknown as Parameters<McpServer['connect']>[0]);
  await transport.handleRequest(request.raw, reply.raw, request.body);
  return reply;
});

const port = Number(process.env['MCP_PORT'] ?? 8788);
await app.listen({ port, host: '0.0.0.0' });
console.log(`Kiwi MCP on http://localhost:${port}/mcp  ledger=${seeded.ledgerId}`);
console.log('Read-only token: demo-read   Read+write token: demo-write');
