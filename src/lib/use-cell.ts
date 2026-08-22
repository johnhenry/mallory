import { useCallback, useSyncExternalStore } from "react";
import type { CellGraph } from "@johnhenry/math";

/**
 * Subscribe a component to one cell in a CellGraph. Reads via `graph.get`,
 * so a structurally-unchanged recompute returns the same cached reference —
 * useSyncExternalStore's Object.is check then bails without re-rendering.
 */
export function useCell<T>(graph: CellGraph, id: string): T {
  const getSnapshot = useCallback(() => graph.get<T>(id), [graph, id]);
  return useSyncExternalStore(
    useCallback((onChange) => graph.subscribe(id, onChange), [graph, id]),
    getSnapshot,
    getSnapshot, // CellGraph.get() is a pure computation, so SSR can use the same snapshot fn.
  );
}
