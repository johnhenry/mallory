import assert from "node:assert/strict";
import { test } from "node:test";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildGraphSessionServer } from "./mcp-server.ts";

/**
 * Drives the full HTTP round-trip the way an external MCP client would --
 * `WebStandardStreamableHTTPServerTransport` in stateless mode, a real
 * `Request`/`Response` pair, no mocking -- proving the wiring in
 * src/routes/api.mcp.ts actually works, not just buildGraphSessionServer's
 * tool registrations in isolation.
 */
async function callTool(name: string, args: unknown): Promise<{ isError?: boolean; text: string }> {
  const server = buildGraphSessionServer();
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    const request = new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    });
    const response = await transport.handleRequest(request);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { result: { content: Array<{ type: string; text: string }>; isError?: boolean } };
    return { isError: body.result.isError, text: body.result.content[0]!.text };
  } finally {
    await transport.close();
    await server.close();
  }
}

async function listTools(): Promise<string[]> {
  const server = buildGraphSessionServer();
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    const request = new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    const response = await transport.handleRequest(request);
    const body = (await response.json()) as { result: { tools: Array<{ name: string }> } };
    return body.result.tools.map((t) => t.name);
  } finally {
    await transport.close();
    await server.close();
  }
}

test("buildGraphSessionServer: tools/list includes all 9 mallory-mcp tools plus the 2 graph-session tools", () => {
  return listTools().then((names) => {
    for (const expected of [
      "symbolic_parse",
      "symbolic_simplify",
      "symbolic_differentiate",
      "symbolic_integrate",
      "symbolic_solve",
      "symbolic_evaluate",
      "linalg_solve",
      "tensor_pipeline",
      "stats_summary",
      "gallery_list",
      "gallery_get",
    ]) {
      assert.ok(names.includes(expected), `expected tools/list to include "${expected}", got: ${names.join(", ")}`);
    }
    assert.equal(names.length, 11, `expected exactly 11 tools, got ${names.length}: ${names.join(", ")}`);
  });
});

test("buildGraphSessionServer: symbolic_differentiate(x^3) over the real HTTP round-trip matches the hand-computed derivative 3*x^2", async () => {
  const { isError, text } = await callTool("symbolic_differentiate", { expression: "x^3", variable: "x" });
  assert.equal(isError, undefined);
  const parsed = JSON.parse(text) as { text: string };
  assert.equal(parsed.text, "3*x^2");
});

test("buildGraphSessionServer: gallery_get on the known seed-multi-1 gallery seed returns its exact hand-verified state (sin(x)/cos(x), no DB read needed -- seeds are checked first)", async () => {
  const { isError, text } = await callTool("gallery_get", { id: "seed-multi-1" });
  assert.equal(isError, undefined);
  const state = JSON.parse(text);
  assert.deepEqual(state, {
    v: 1,
    rows: [
      { source: "sin(x)", color: 0x2563eb, visible: true, params: {} },
      { source: "cos(x)", color: 0xdc2626, visible: true, params: {} },
    ],
    viewport: { xMin: -10, xMax: 10, yMin: -10, yMax: 10 },
    annotations: [],
    mode: "float",
  });
});

test("buildGraphSessionServer: gallery_get on an unknown id returns isError with the same message getSavedGraph itself throws", async () => {
  const { isError, text } = await callTool("gallery_get", { id: "definitely-not-a-real-id" });
  assert.equal(isError, true);
  assert.match(text, /Unknown or deleted saved graph\./);
});

test("buildGraphSessionServer: gallery_list returns an array that includes the known seed-multi-1 summary", async () => {
  const { isError, text } = await callTool("gallery_list", {});
  assert.equal(isError, undefined);
  const list = JSON.parse(text) as Array<{ id: string; title: string; kind: string }>;
  assert.ok(Array.isArray(list));
  const seed = list.find((g) => g.id === "seed-multi-1");
  assert.ok(seed, `expected seed-multi-1 in gallery_list's result: ${JSON.stringify(list)}`);
  assert.equal(seed!.title, "sin(x) and cos(x)");
  assert.equal(seed!.kind, "multi");
});

test("buildGraphSessionServer: gallery_save is absent from tools/list by default (MALLORY_GRAPH_ENABLE_MCP_WRITE unset -- write path OFF by default)", async () => {
  assert.equal(process.env.MALLORY_GRAPH_ENABLE_MCP_WRITE, undefined, "test isolation precondition -- another test left this set");
  const names = await listTools();
  assert.ok(!names.includes("gallery_save"), `expected gallery_save to be absent, got: ${names.join(", ")}`);
  assert.equal(names.length, 11);
});

test("buildGraphSessionServer: gallery_save appears and round-trips through gallery_get when MALLORY_GRAPH_ENABLE_MCP_WRITE=1", async () => {
  process.env.MALLORY_GRAPH_ENABLE_MCP_WRITE = "1";
  try {
    const names = await listTools();
    assert.ok(names.includes("gallery_save"), `expected gallery_save present, got: ${names.join(", ")}`);
    assert.equal(names.length, 12);

    const state = {
      v: 1,
      rows: [{ source: "x^2", color: 0x2563eb, visible: true, params: {} }],
      viewport: { xMin: -10, xMax: 10, yMin: -10, yMax: 10 },
      annotations: [],
      mode: "float",
    };
    const saved = await callTool("gallery_save", { title: "mcp write test", kind: "multi", state });
    assert.equal(saved.isError, undefined);
    const { id } = JSON.parse(saved.text) as { id: string };
    assert.ok(typeof id === "string" && id.length > 0);

    const fetched = await callTool("gallery_get", { id });
    assert.equal(fetched.isError, undefined);
    assert.deepEqual(JSON.parse(fetched.text), state);
  } finally {
    delete process.env.MALLORY_GRAPH_ENABLE_MCP_WRITE;
  }
});
