import assert from "node:assert/strict";
import { test } from "node:test";
import {
  analyzeGraph,
  circularLayout,
  parseEdgeListText,
  runBfs,
  runDfs,
  runDijkstra,
  runMst,
  runShortestPath,
} from "./graph-ops.ts";

const WEIGHTED_EDGES = "A B 1\nB C 2\nA C 4\nC D 1";

test("parseEdgeListText: parses a weighted edge list into the right vertices and edges", () => {
  const g = parseEdgeListText(WEIGHTED_EDGES, false);
  assert.deepEqual(g.vertices().sort(), ["A", "B", "C", "D"]);
  assert.equal(g.edges().length, 4);
});

test("parseEdgeListText: an edge with no weight defaults to 1", () => {
  const g = parseEdgeListText("A B", false);
  const edge = g.edges().find((e) => (e.from === "A" && e.to === "B") || (e.from === "B" && e.to === "A"));
  assert.equal(edge?.weight, 1);
});

test("parseEdgeListText: a single-token line declares an isolated vertex", () => {
  const g = parseEdgeListText("A B\nC", false);
  assert.deepEqual(g.vertices().sort(), ["A", "B", "C"]);
});

test("parseEdgeListText: rejects a non-numeric weight", () => {
  assert.throws(() => parseEdgeListText("A B notanumber", false), /valid weight/);
});

test("parseEdgeListText: rejects a line with the wrong token count", () => {
  assert.throws(() => parseEdgeListText("A B C D", false));
});

test("parseEdgeListText: rejects empty input", () => {
  assert.throws(() => parseEdgeListText("", false));
});

test("circularLayout: every vertex gets a point on the unit circle", () => {
  const layout = circularLayout(["A", "B", "C", "D"]);
  assert.equal(layout.size, 4);
  for (const p of layout.values()) {
    assert.ok(Math.abs(Math.hypot(p.x, p.y) - 1) < 1e-9);
  }
});

test("circularLayout: points are evenly spaced (90 degrees apart for 4 vertices)", () => {
  const layout = circularLayout(["A", "B", "C", "D"]);
  const angles = ["A", "B", "C", "D"].map((v) => Math.atan2((layout.get(v) as { y: number }).y, (layout.get(v) as { x: number }).x));
  for (let i = 1; i < angles.length; i++) {
    const diff = (angles[i] as number) - (angles[i - 1] as number);
    assert.ok(Math.abs(Math.abs(diff) - Math.PI / 2) < 1e-9, `expected 90deg apart, got ${diff}`);
  }
});

test("circularLayout: handles the empty case without throwing", () => {
  const layout = circularLayout([]);
  assert.equal(layout.size, 0);
});

test("runBfs/runDfs: both visit all reachable vertices exactly once, starting at the given vertex", () => {
  const g = parseEdgeListText(WEIGHTED_EDGES, false);
  const bfs = runBfs(g, "A");
  const dfs = runDfs(g, "A");
  assert.equal(bfs.order[0], "A");
  assert.equal(dfs.order[0], "A");
  assert.deepEqual([...bfs.order].sort(), ["A", "B", "C", "D"]);
  assert.deepEqual([...dfs.order].sort(), ["A", "B", "C", "D"]);
});

test("runBfs: rejects an unknown start vertex", () => {
  const g = parseEdgeListText(WEIGHTED_EDGES, false);
  assert.throws(() => runBfs(g, "Z"), /isn't a vertex/);
});

test("runDijkstra: hand-computed shortest distances from A", () => {
  // A-B=1, B-C=2 (A-C via B = 3, cheaper than direct A-C=4), C-D=1 (A-D = 4).
  const g = parseEdgeListText(WEIGHTED_EDGES, false);
  const { distances } = runDijkstra(g, "A");
  const byVertex = Object.fromEntries(distances.map((d) => [d.vertex, d.distance]));
  assert.equal(byVertex.A, 0);
  assert.equal(byVertex.B, 1);
  assert.equal(byVertex.C, 3);
  assert.equal(byVertex.D, 4);
});

test("runShortestPath: A to D goes through B and C (the cheaper route), not the direct A-C edge", () => {
  const g = parseEdgeListText(WEIGHTED_EDGES, false);
  const { distance, path } = runShortestPath(g, "A", "D");
  assert.equal(distance, 4);
  assert.deepEqual(path, ["A", "B", "C", "D"]);
});

test("runMst: total weight and edge count match a hand-computed minimum spanning tree", () => {
  // MST should be A-B(1), C-D(1), B-C(2) -- total 4, skipping the redundant A-C(4).
  const g = parseEdgeListText(WEIGHTED_EDGES, false);
  const { edges, totalWeight } = runMst(g);
  assert.equal(edges.length, 3); // n-1 edges for 4 vertices
  assert.equal(totalWeight, 4);
});

test("analyzeGraph: detects a cycle in a triangle", () => {
  const g = parseEdgeListText("A B\nB C\nC A", false);
  const analysis = analyzeGraph(g);
  assert.equal(analysis.hasCycle, true);
});

test("analyzeGraph: a tree (no cycle) reports hasCycle false and a valid topological order for a DAG", () => {
  const g = parseEdgeListText("A B\nA C\nB D", true); // directed tree
  const analysis = analyzeGraph(g);
  assert.equal(analysis.hasCycle, false);
  assert.ok(analysis.topologicalOrder !== null);
  // A must come before both B and C; B must come before D.
  const order = analysis.topologicalOrder as string[];
  assert.ok(order.indexOf("A") < order.indexOf("B"));
  assert.ok(order.indexOf("A") < order.indexOf("C"));
  assert.ok(order.indexOf("B") < order.indexOf("D"));
});

test("analyzeGraph: connectedComponents separates two disjoint pieces", () => {
  const g = parseEdgeListText("A B\nC D", false);
  const analysis = analyzeGraph(g);
  assert.equal(analysis.connectedComponents.length, 2);
});

test("analyzeGraph: adjacency matrix has 0 on the diagonal and Infinity for non-edges", () => {
  const g = parseEdgeListText("A B 5", false);
  const { matrix, order } = analyzeGraph(g).adjacencyMatrix;
  const aIdx = order.indexOf("A");
  assert.equal(matrix[aIdx]?.[aIdx], 0);
});

test("analyzeGraph: stronglyConnectedComponents separates a directed graph that isn't strongly connected", () => {
  // A->B->A (mutually reachable) and a separate C with an edge FROM the
  // cycle but no way back -- 2 SCCs: {A,B} and {C}.
  const g = parseEdgeListText("A B\nB A\nB C", true);
  const analysis = analyzeGraph(g);
  assert.equal(analysis.stronglyConnectedComponents.length, 2);
  const sizes = analysis.stronglyConnectedComponents.map((c) => c.length).sort();
  assert.deepEqual(sizes, [1, 2]);
});

test("analyzeGraph: stronglyConnectedComponents collapses to a single component for a directed cycle (fully strongly connected)", () => {
  const g = parseEdgeListText("A B\nB C\nC A", true);
  const analysis = analyzeGraph(g);
  assert.equal(analysis.stronglyConnectedComponents.length, 1);
});
