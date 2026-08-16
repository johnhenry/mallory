/**
 * Step-by-step playback data for the graph-theory panel's algorithm
 * animation (issue #24's remaining scope: "Dijkstra frontier expansion,
 * MST edges lighting up, BFS layers"). Every function here is a pure,
 * DOM-free transform of an algorithm's ALREADY-COMPUTED result (from
 * `graph-ops.ts`'s `runBfs`/`runDfs`/`runDijkstra`/`runMst`/
 * `runShortestPath`, themselves thin wrappers over mallory-math's `Graph`
 * methods) into a `AlgorithmStep[]` the panel steps through on its
 * existing `TIME_CELL`/`TransportControls` clock -- no algorithm is
 * reimplemented here; each function only re-groups a result mallory-math
 * already computed.
 *
 * The step order for each algorithm is the ALGORITHM'S OWN authentic
 * order, not an approximation:
 * - `bfs`/`dfs`: `Graph.bfs`/`Graph.dfs` return traversal order directly.
 * - `dijkstra`: `Graph.dijkstra` returns a `Map` in insertion order, and
 *   Dijkstra's own invariant is that it finalizes vertices in
 *   non-decreasing distance order -- so the Map's iteration order (which
 *   `runDijkstra` already converts to an array, preserving that order)
 *   IS the frontier-expansion order, with no extra bookkeeping needed.
 * - `minimumSpanningTree` (Kruskal): processes edges in ascending weight
 *   order, so its returned edge array is already the "lighting up" order.
 */

export interface AlgorithmStep {
  /** Vertices highlighted as of this step, cumulative (never shrinks step to step). */
  visitedVertices: string[];
  /** Edges highlighted as of this step, cumulative (never shrinks step to step). */
  visitedEdges: Array<{ from: string; to: string }>;
  /** A short human-readable caption for this step. */
  label: string;
}

/** DFS (or any plain traversal without layer grouping): reveals one vertex per step, in the traversal's own order. */
export function traversalSteps(order: readonly string[]): AlgorithmStep[] {
  return order.map((v, i) => ({
    visitedVertices: order.slice(0, i + 1),
    visitedEdges: [],
    label: `Visit ${v}`,
  }));
}

/**
 * BFS-distance (edge count) from `start` to every vertex reachable via
 * `neighbors`, via a plain unweighted BFS. Used to group `bfs`'s own
 * traversal order into frontier layers below -- separate from
 * mallory-math's `Graph.bfs` (which returns order, not distances) so the
 * layering is derived data, not a second traversal implementation guessing
 * at internals.
 */
export function bfsDistances(neighbors: (v: string) => readonly string[], start: string): Map<string, number> {
  const distances = new Map<string, number>([[start, 0]]);
  const queue: string[] = [start];
  let head = 0;
  while (head < queue.length) {
    const v = queue[head] as string;
    head++;
    const d = distances.get(v) as number;
    for (const n of neighbors(v)) {
      if (!distances.has(n)) {
        distances.set(n, d + 1);
        queue.push(n);
      }
    }
  }
  return distances;
}

/**
 * Groups BFS's own traversal `order` into frontier layers by
 * distance-from-start (from `bfsDistances` above), revealing one whole
 * layer per step -- the "BFS layers" animation issue #24 names, distinct
 * from a plain vertex-by-vertex reveal.
 */
export function bfsLayerSteps(order: readonly string[], distances: ReadonlyMap<string, number>): AlgorithmStep[] {
  const layers: string[][] = [];
  for (const v of order) {
    const d = distances.get(v) ?? 0;
    (layers[d] ??= []).push(v);
  }
  const steps: AlgorithmStep[] = [];
  const cumulative: string[] = [];
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i] ?? [];
    cumulative.push(...layer);
    steps.push({ visitedVertices: [...cumulative], visitedEdges: [], label: `Layer ${i}: ${layer.join(", ") || "(none)"}` });
  }
  return steps;
}

/** Dijkstra: reveals one vertex per step, in its own distance-finalization order, captioned with the newly-finalized distance. */
export function dijkstraSteps(distances: ReadonlyArray<{ vertex: string; distance: number }>): AlgorithmStep[] {
  return distances.map((d, i) => ({
    visitedVertices: distances.slice(0, i + 1).map((x) => x.vertex),
    visitedEdges: [],
    label: `Finalize ${d.vertex}: distance = ${d.distance}`,
  }));
}

/** MST (Kruskal) or a plain path: reveals one edge per step, in the given order. Shared by `mstSteps` and `pathSteps` below since both are "cumulative edge reveal," just with a different caption. */
function edgeRevealSteps(edges: ReadonlyArray<{ from: string; to: string; weight?: number }>, caption: (e: { from: string; to: string; weight?: number }) => string): AlgorithmStep[] {
  return edges.map((e, i) => ({
    visitedVertices: [],
    visitedEdges: edges.slice(0, i + 1).map((x) => ({ from: x.from, to: x.to })),
    label: caption(e),
  }));
}

export function mstSteps(edges: ReadonlyArray<{ from: string; to: string; weight: number }>): AlgorithmStep[] {
  return edgeRevealSteps(edges, (e) => `Add ${e.from}-${e.to} (weight ${e.weight})`);
}

/** Shortest path: reveals the path one edge at a time, start to end. */
export function pathSteps(path: readonly string[]): AlgorithmStep[] {
  const edges = path.slice(0, -1).map((from, i) => ({ from, to: path[i + 1] as string }));
  return edgeRevealSteps(edges, (e) => `${e.from} → ${e.to}`);
}
