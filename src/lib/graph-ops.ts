import { Graph, type Edge } from "mallory-math";

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
  };
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
