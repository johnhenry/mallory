import { useEffect, useRef, useState } from "react";
import type { CellGraph } from "../lib/cell-graph.ts";

export interface CollabSessionStatus {
  connected: boolean;
  error: string | null;
}

/**
 * Wires a CellGraph to the live-collaboration WebSocket relay
 * (issue #47, `collab-server.mjs`). `sessionId === null` means "no active
 * session" -- the hook is a no-op (every panel can call this
 * unconditionally, same shape as `useCellGraphTools`).
 *
 * Design: a joining peer's initial sync comes for free from this app's
 * EXISTING share mechanism, not a server-side snapshot -- "Start live
 * session" (see GraphCanvasMulti) shares the current URL (already
 * carrying the full state in its hash, via the same live
 * `window.history.replaceState` sync every panel already does) plus a
 * `?session=` param. A joiner hydrates from the hash exactly like opening
 * any shared link already works, THEN this hook starts relaying live
 * writes from that point forward. There's no "replay history since
 * session start" -- last-write-wins per cell, matching the issue's own
 * explicit v1 scope (no CRDT/OT).
 *
 * Last-write-wins is a property of ordinary message delivery order here,
 * not a comparison this hook makes: a remote write is applied via a plain
 * `graph.set()` the instant its message arrives, so whichever write
 * (local or remote) reaches a cell last simply wins, the same as two
 * humans typing into the same input box would behave with no coordination
 * at all.
 */
export function useCollabSession(graph: CellGraph, sessionId: string | null): CollabSessionStatus {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const applyingRemoteRef = useRef(false);

  useEffect(() => {
    if (!sessionId || typeof window === "undefined") return;
    let closed = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${window.location.host}/api/collab?session=${encodeURIComponent(sessionId as string)}`);
      ws = socket;
      socket.addEventListener("open", () => {
        setConnected(true);
        setError(null);
      });
      socket.addEventListener("close", () => {
        setConnected(false);
        if (!closed) reconnectTimer = setTimeout(connect, 1000);
      });
      socket.addEventListener("error", () => setError("Connection error -- retrying…"));
      socket.addEventListener("message", (e) => {
        try {
          const { cellId, value } = JSON.parse(e.data as string) as { cellId: string; value: unknown };
          applyingRemoteRef.current = true;
          try {
            graph.set(cellId, value);
          } finally {
            applyingRemoteRef.current = false;
          }
        } catch {
          // Malformed frame -- never let one bad message take down the session.
        }
      });
    }
    connect();

    const unsubscribeWrites = graph.subscribeWrites((cellId, value) => {
      // Don't re-broadcast a write this hook itself just applied FROM a
      // peer -- the relay never echoes a sender's own message back (see
      // collab-server.mjs), but subscribeWrites fires for EVERY set() call
      // regardless of origin, so this guard is still needed locally.
      if (applyingRemoteRef.current) return;
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ cellId, value }));
    });

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      unsubscribeWrites();
      ws?.close();
    };
  }, [graph, sessionId]);

  return { connected, error };
}
