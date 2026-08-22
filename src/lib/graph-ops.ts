import { Graph, type Edge } from "@johnhenry/math";

/**
 * Parses a graph from a text edge list: one edge per line, "from to
 * [weight]" (weight defaults to 1), whitespace/comma separated. A line with
 * just one token declares an isolated vertex (no edge). Vertex names are
 * plain strings, so "A B 5" and "A,B,5" both work.
 */
export function parseEdgeListText(text: string, directed: boolean): Graph<string> {
  const graph = new Graph<string>(directed);
  const lines = text
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) throw new Error("Enter at least one edge or vertex.");

  for (const line of lines) {
    const parts = line.split(/[\s,]+/).filter(Boolean);
    if (parts.length === 1) {
      graph.addVertex(parts[0] as string);
    } else if (parts.length === 2) {
      const [from, to] = parts as [string, string];
      graph.addVertex(from).addVertex(to).addEdge(from, to, 1);
    } else if (parts.length === 3) {
      const [from, to, weightStr] = parts as [string, string, string];
      const weight = Number(weightStr);
      if (Number.isNaN(weight)) throw new Error(`"${weightStr}" isn't a valid weight in line "${line}".`);
      graph.addVertex(from).addVertex(to).addEdge(from, to, weight);
    } else {
      throw new Error(`Each line needs 1-3 tokens ("vertex", "from to", or "from to weight") -- got "${line}".`);
    }
  }
  return graph;
}

export interface LayoutPoint {
  x: number;
  y: number;
}

/**
 * A simple deterministic circular layout: vertices evenly spaced on a unit
 * circle, in the order `Graph.vertices()` returns them. Not force-directed
 * (no edge-crossing minimization) -- a reasonable, always-legible v1 that
 * needs no iterative simulation, unlike a spring layout.
 */
export function circularLayout(vertices: readonly string[]): Map<string, LayoutPoint> {
  const layout = new Map<string, LayoutPoint>();
  const n = vertices.length;
  vertices.forEach((v, i) => {
    const angle = n > 0 ? (2 * Math.PI * i) / n - Math.PI / 2 : 0;
    layout.set(v, { x: Math.cos(angle), y: Math.sin(angle) });
  });
  return layout;
}

export interface GraphAnalysis {
  vertices: string[];
  edges: Array<Edge<string>>;
  hasCycle: boolean;
  connectedComponents: string[][];
  topologicalOrder: string[] | null;
  adjacencyMatrix: { matrix: number[][]; order: string[] };
  /**
   * Strongly connected components (issue #297, the matrix<->graph duality
   * feature): maximal vertex sets where every vertex can reach every other
   * via DIRECTED edges. On an undirected graph this is identical to
   * `connectedComponents` (mallory-math's own `stronglyConnectedComponents`
   * doc comment: "On an undirected graph this always reduces to
   * connectedComponents") -- computed unconditionally here rather than
   * branching on `graph.directed`, since calling it costs nothing extra
   * and callers that only care about the directed case can compare
   * `stronglyConnectedComponents.length` against 1 (irreducible, per
   * `frobenius.ts`'s own convention) regardless.
   */
  stronglyConnectedComponents: string[][];
}

/** Runs every structural algorithm that needs no start vertex, in one pass -- the panel's "always visible" summary. */
export function analyzeGraph(graph: Graph<string>): GraphAnalysis {
  return {
    vertices: graph.vertices(),
    edges: graph.edges(),
    hasCycle: graph.hasCycle(),
    connectedComponents: graph.connectedComponents(),
    topologicalOrder: graph.topologicalSort(),
    adjacencyMatrix: graph.toAdjacencyMatrix(),
    stronglyConnectedComponents: graph.stronglyConnectedComponents(),
  };
}

export interface CondensationResult {
  /** One vertex ("C0", "C1", ...) per strongly connected component; one edge Ci -> Cj whenever the original graph has ANY edge from a Ci-member to a Cj-member (deduplicated -- the condensation cares about reachability between components, not how many original edges cross it). */
  graph: Graph<string>;
  /** Condensed vertex id -> its original member vertices, for labeling/tooltips. */
  members: Map<string, string[]>;
}

/**
 * "Skeletonizes" a directed graph into its condensation (issue #297, per
 * the video's own framing: "consider each component as a black box: we
 * don't care what's inside, only about their external connections"). The
 * condensation of ANY directed graph is a DAG -- a cycle among components
 * would mean they're mutually reachable, i.e. actually one component, not
 * several (this is exactly why `stronglyConnectedComponents` is a
 * well-defined partition in the first place).
 */
export function buildCondensationGraph(graph: Graph<string>, components: readonly string[][]): CondensationResult {
  const componentOf = new Map<string, number>();
  components.forEach((component, i) => {
    for (const v of component) componentOf.set(v, i);
  });

  const condensed = new Graph<string>(true);
  const members = new Map<string, string[]>();
  components.forEach((component, i) => {
    const id = `C${i}`;
    condensed.addVertex(id);
    members.set(id, component);
  });

  const seenEdges = new Set<string>();
  for (const e of graph.edges()) {
    const fromId = `C${componentOf.get(e.from)}`;
    const toId = `C${componentOf.get(e.to)}`;
    if (fromId === toId) continue; // an edge inside one component, not between two
    const key = `${fromId}->${toId}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    condensed.addEdge(fromId, toId, 1);
  }

  return { graph: condensed, members };
}

export interface TraversalResult {
  order: string[];
}

export function runBfs(graph: Graph<string>, start: string): TraversalResult {
  if (!graph.vertices().includes(start)) throw new Error(`"${start}" isn't a vertex in this graph.`);
  return { order: graph.bfs(start) };
}

export function runDfs(graph: Graph<string>, start: string): TraversalResult {
  if (!graph.vertices().includes(start)) throw new Error(`"${start}" isn't a vertex in this graph.`);
  return { order: graph.dfs(start) };
}

export interface DijkstraResult {
  distances: Array<{ vertex: string; distance: number }>;
}

export function runDijkstra(graph: Graph<string>, start: string): DijkstraResult {
  if (!graph.vertices().includes(start)) throw new Error(`"${start}" isn't a vertex in this graph.`);
  const distances = [...graph.dijkstra(start)].map(([vertex, distance]) => ({ vertex, distance }));
  return { distances };
}

export function runShortestPath(graph: Graph<string>, start: string, end: string): { distance: number; path: string[] } {
  if (!graph.vertices().includes(start)) throw new Error(`"${start}" isn't a vertex in this graph.`);
  if (!graph.vertices().includes(end)) throw new Error(`"${end}" isn't a vertex in this graph.`);
  return graph.shortestPath(start, end);
}

export function runMst(graph: Graph<string>): { edges: Array<Edge<string>>; totalWeight: number } {
  const edges = graph.minimumSpanningTree();
  return { edges, totalWeight: edges.reduce((sum, e) => sum + e.weight, 0) };
}
