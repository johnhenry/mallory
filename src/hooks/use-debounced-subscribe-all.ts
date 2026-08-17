import { useEffect, useRef } from "react";
import type { CellGraph } from "../lib/cell-graph.ts";

/**
 * Subscribes to every cell in `graph` (`subscribeAll`) but only invokes
 * `fn` after `delayMs` of quiet since the last notification -- the same
 * "coalesce a burst into one call" shape `useUndoHistory` already
 * established for its own debounced snapshot recording (see
 * use-undo-history.ts's doc comment), pulled out here as a standalone hook
 * so other `subscribeAll` listeners can reuse it directly instead of each
 * hand-rolling their own timer.
 *
 * Intended for listeners whose real dependency set is a *dynamic* handful
 * of cells that isn't known ahead of time (e.g. a per-row or per-free-
 * variable id, where the set of rows/variables itself changes) -- the
 * shape `graph.subscribeMany` (cell-graph.ts) deliberately doesn't cover.
 * Debouncing doesn't make the listener correct the way `subscribeMany`
 * does (it still eventually fires for writes it doesn't actually depend
 * on), but it bounds a high-frequency burst (an RAF-driven playback clock,
 * a live drag preview, ...) to at most one call per `delayMs`, instead of
 * once per write (issue #235).
 *
 * `enabled` (default true) mirrors `useUndoHistory`'s own flag: when false,
 * no `subscribeAll` listener is registered at all (same as the caller
 * simply not calling this hook), for a caller like GraphCanvas whose own
 * `syncUrl` prop can turn URL-sync off entirely -- called unconditionally
 * every render either way, per the rules of hooks.
 */
export function useDebouncedSubscribeAll(graph: CellGraph, fn: () => void, delayMs = 250, enabled = true): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = graph.subscribeAll(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fnRef.current();
      }, delayMs);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [graph, delayMs, enabled]);
}
