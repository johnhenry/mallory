/**
 * Server-side MCP endpoint at /api/mcp (issue #40 item 1) -- the app's
 * first TanStack Start "Server Route" (every other server-side entry
 * point in this codebase is a `createServerFn` RPC; this needs raw
 * GET/POST/DELETE dispatch on one path with SSE framing, which
 * `createServerFn` doesn't support).
 *
 * A fresh McpServer + transport per request, both closed after the
 * response completes -- the exact pattern the MCP SDK's own stateless
 * example uses (`examples/server/simpleStatelessStreamableHttp.js`):
 * `new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })`
 * per request, `res.on("close", () => { transport.close(); server.close(); })`.
 * `WebStandardStreamableHTTPServerTransport` (not the Node
 * IncomingMessage/ServerResponse-wrapping `StreamableHTTPServerTransport`)
 * is the right class here since TanStack Start server routes hand the
 * handler a real `Request` already, not a Node req/res pair.
 * `enableJsonResponse: true` -- plain JSON responses (not an SSE stream)
 * fit this endpoint's synchronous request/response tools; none of them
 * stream partial results or emit server-initiated notifications.
 */
import { createFileRoute } from "@tanstack/react-router";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildGraphSessionServer } from "../lib/mcp-server.ts";

async function handleMcpRequest(request: Request): Promise<Response> {
  const server = buildGraphSessionServer();
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await transport.close();
    await server.close();
  }
}

export const Route = createFileRoute("/api/mcp")({
  server: {
    handlers: {
      GET: ({ request }) => handleMcpRequest(request),
      POST: ({ request }) => handleMcpRequest(request),
      DELETE: ({ request }) => handleMcpRequest(request),
    },
  },
});
