// Plain node:test coverage for collab-server.mjs (issue #47) -- deliberately
// OUTSIDE src/ and the vite/jsx test glob (see package.json's "test" script):
// this file has no build step at all, matching server.js itself, which
// imports it directly at runtime via plain `node server.js` in production.
// Pure Node http + ws, no DOM/browser needed, so it's fully automatable
// unlike the actual live-browser WebSocket path (verified separately, live,
// against the real production server -- see the PR description).
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { WebSocket } from "ws";
import { attachCollabWebSocketServer } from "./collab-server.mjs";

async function startTestServer() {
  const httpServer = createServer((_req, res) => res.end("ok"));
  attachCollabWebSocketServer(httpServer);
  await new Promise((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address();
  return { httpServer, port };
}

function connect(port, session) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/api/collab?session=${encodeURIComponent(session)}`);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function nextMessage(ws) {
  return new Promise((resolve) => ws.once("message", (data) => resolve(data.toString())));
}

function nextFrame(ws) {
  return new Promise((resolve) => ws.once("message", (data, isBinary) => resolve({ text: data.toString(), isBinary })));
}

test("collab-server: a message from one peer is relayed to another peer in the SAME session", async () => {
  const { httpServer, port } = await startTestServer();
  try {
    const a = await connect(port, "session-1");
    const b = await connect(port, "session-1");
    const received = nextMessage(b);
    a.send(JSON.stringify({ cellId: "x", value: 42 }));
    assert.equal(await received, JSON.stringify({ cellId: "x", value: 42 }));
    a.close();
    b.close();
  } finally {
    httpServer.close();
  }
});

test("collab-server: the relayed message arrives as a TEXT frame, not binary -- a browser delivers a binary frame's payload as a Blob, breaking JSON.parse(e.data); Node's ws client stringifies either kind identically, so only isBinary actually distinguishes them (caught via a real browser round-trip, not assumed)", async () => {
  const { httpServer, port } = await startTestServer();
  try {
    const a = await connect(port, "session-4");
    const b = await connect(port, "session-4");
    const frame = nextFrame(b);
    a.send(JSON.stringify({ cellId: "x", value: 1 }));
    const { isBinary } = await frame;
    assert.equal(isBinary, false, "the relay must re-send a text frame's payload as text, not the raw Buffer (which defaults to a binary frame)");
    a.close();
    b.close();
  } finally {
    httpServer.close();
  }
});

test("collab-server: a message is NEVER echoed back to its own sender", async () => {
  const { httpServer, port } = await startTestServer();
  try {
    const a = await connect(port, "session-2");
    let echoed = false;
    a.on("message", () => {
      echoed = true;
    });
    a.send(JSON.stringify({ cellId: "x", value: 1 }));
    // No other peer in this session -- give the event loop a tick to prove nothing arrives back.
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(echoed, false);
    a.close();
  } finally {
    httpServer.close();
  }
});

test("collab-server: two DIFFERENT sessions are fully isolated -- a message in one never reaches a peer in the other", async () => {
  const { httpServer, port } = await startTestServer();
  try {
    const a = await connect(port, "session-A");
    const b = await connect(port, "session-B");
    let leaked = false;
    b.on("message", () => {
      leaked = true;
    });
    a.send(JSON.stringify({ cellId: "x", value: 1 }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(leaked, false, "session-B's peer must never see session-A's message");
    a.close();
    b.close();
  } finally {
    httpServer.close();
  }
});

test("collab-server: a message reaches ALL other peers in a session, not just the first one (3-peer broadcast)", async () => {
  const { httpServer, port } = await startTestServer();
  try {
    const a = await connect(port, "session-3");
    const b = await connect(port, "session-3");
    const c = await connect(port, "session-3");
    const receivedB = nextMessage(b);
    const receivedC = nextMessage(c);
    a.send(JSON.stringify({ cellId: "y", value: "hi" }));
    assert.equal(await receivedB, JSON.stringify({ cellId: "y", value: "hi" }));
    assert.equal(await receivedC, JSON.stringify({ cellId: "y", value: "hi" }));
    a.close();
    b.close();
    c.close();
  } finally {
    httpServer.close();
  }
});

test("collab-server: an upgrade request with no ?session= is rejected (socket destroyed, no crash)", async () => {
  const { httpServer, port } = await startTestServer();
  try {
    await assert.rejects(connect(port, ""));
  } finally {
    httpServer.close();
  }
});
