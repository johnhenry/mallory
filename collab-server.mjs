// Live-collaboration WebSocket relay (issue #47). A raw Node http.Server
// 'upgrade' event handler, wired in by server.js AFTER srvx's serve() --
// this genuinely can't live as a TanStack Start server route
// (src/routes/api.*.ts): 'upgrade' fires before any fetch-style request
// routing even begins, so it has to attach directly to the underlying
// http.Server instance srvx's Server.node.server exposes.
//
// Deliberately a dumb relay, not `mallory-iteration`'s suggested
// `withWebSocket`/`AsyncChannel` transport: that abstraction is built for
// backpressure-aware ASYNC ITERABLE processing pipelines, and this is a
// simple bidirectional "receive one message, forward it to N peers"
// broadcast -- wrapping it in a channel abstraction would add indirection
// without solving a real problem here. The server never parses/validates
// message contents beyond JSON well-formedness; it doesn't know or care
// that a message happens to be a CellGraph {cellId, value} write (see
// use-collab-session.ts on the client side) -- last-write-wins is a
// property of "whichever message a peer applies last wins" on the client,
// no server-side merge logic needed for a v1 this small.
import { WebSocketServer } from "ws";

const MAX_SESSION_PEERS = 32;

/** @param {import("node:http").Server} httpServer */
export function attachCollabWebSocketServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true });
  /** @type {Map<string, Set<import("ws").WebSocket>>} */
  const sessions = new Map();

  httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/api/collab") return; // not ours -- leave the socket alone for any other upgrade handler
    const sessionId = url.searchParams.get("session");
    if (!sessionId) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      let peers = sessions.get(sessionId);
      if (!peers) sessions.set(sessionId, (peers = new Set()));
      if (peers.size >= MAX_SESSION_PEERS) {
        ws.close(1013, "Session is full.");
        return;
      }
      peers.add(ws);

      ws.on("message", (data) => {
        // `data` arrives as a Node Buffer even for a text frame the sender
        // sent as a plain JSON string -- relaying the Buffer object as-is
        // makes `ws` re-send it as a BINARY frame (Buffers default to
        // binary unless told otherwise), which a browser then delivers to
        // `message` handlers as a Blob instead of a string, breaking
        // `JSON.parse(e.data)` on the receiving end (caught via a live
        // browser + real Node ws-client round-trip check, not assumed --
        // `.toString()` here restores it to a proper text frame). Relayed
        // to every OTHER peer in the same session -- never echoed back to
        // the sender, which is what lets the client apply an incoming
        // message unconditionally (see use-collab-session.ts's
        // remote-apply guard) without needing a message-id round-trip to
        // distinguish "my own write echoed back" from "a peer's write".
        const text = data.toString();
        for (const peer of peers) {
          if (peer !== ws && peer.readyState === peer.OPEN) peer.send(text);
        }
      });

      ws.on("close", () => {
        peers.delete(ws);
        if (peers.size === 0) sessions.delete(sessionId);
      });
    });
  });

  return wss;
}
