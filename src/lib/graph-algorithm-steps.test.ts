import assert from "node:assert/strict";
import { test } from "node:test";
import { bfsDistances, bfsLayerSteps, dijkstraSteps, mstSteps, pathSteps, traversalSteps } from "./graph-algorithm-steps.ts";

test("traversalSteps: one vertex revealed per step, cumulative, hand-computed", () => {
  const steps = traversalSteps(["A", "B", "C"]);
  assert.deepEqual(steps, [
    { visitedVertices: ["A"], visitedEdges: [], label: "Visit A" },
    { visitedVertices: ["A", "B"], visitedEdges: [], label: "Visit B" },
    { visitedVertices: ["A", "B", "C"], visitedEdges: [], label: "Visit C" },
  ]);
});

test("traversalSteps: an empty order produces no steps", () => {
  assert.deepEqual(traversalSteps([]), []);
});

test("bfsDistances: hand-computed distances on a small undirected graph (A-B, B-C, A-D)", () => {
  const adjacency: Record<string, string[]> = { A: ["B", "D"], B: ["A", "C"], C: ["B"], D: ["A"] };
  const distances = bfsDistances((v) => adjacency[v] ?? [], "A");
  assert.deepEqual(new Map(distances), new Map([["A", 0], ["B", 1], ["D", 1], ["C", 2]]));
});

test("bfsDistances: an isolated start vertex (no neighbors) has only itself at distance 0", () => {
  const distances = bfsDistances(() => [], "X");
  assert.deepEqual(new Map(distances), new Map([["X", 0]]));
});

test("bfsLayerSteps: groups traversal order into frontier layers, cumulative, hand-computed", () => {
  const order = ["A", "B", "D", "C"];
  const distances = new Map([["A", 0], ["B", 1], ["D", 1], ["C", 2]]);
  const steps = bfsLayerSteps(order, distances);
  assert.deepEqual(steps, [
    { visitedVertices: ["A"], visitedEdges: [], label: "Layer 0: A" },
    { visitedVertices: ["A", "B", "D"], visitedEdges: [], label: "Layer 1: B, D" },
    { visitedVertices: ["A", "B", "D", "C"], visitedEdges: [], label: "Layer 2: C" },
  ]);
});

test("bfsLayerSteps: a single-layer graph (star from the start vertex) produces exactly 2 layers", () => {
  const order = ["A", "B", "C"];
  const distances = new Map([["A", 0], ["B", 1], ["C", 1]]);
  const steps = bfsLayerSteps(order, distances);
  assert.equal(steps.length, 2);
  assert.deepEqual(steps[1]?.visitedVertices, ["A", "B", "C"]);
});

test("dijkstraSteps: one vertex finalized per step with its distance in the caption, hand-computed", () => {
  const steps = dijkstraSteps([
    { vertex: "A", distance: 0 },
    { vertex: "B", distance: 1 },
    { vertex: "C", distance: 3 },
  ]);
  assert.deepEqual(steps, [
    { visitedVertices: ["A"], visitedEdges: [], label: "Finalize A: distance = 0" },
    { visitedVertices: ["A", "B"], visitedEdges: [], label: "Finalize B: distance = 1" },
    { visitedVertices: ["A", "B", "C"], visitedEdges: [], label: "Finalize C: distance = 3" },
  ]);
});

test("mstSteps: one edge added per step, cumulative, hand-computed", () => {
  const steps = mstSteps([
    { from: "A", to: "B", weight: 1 },
    { from: "C", to: "D", weight: 2 },
  ]);
  assert.deepEqual(steps, [
    { visitedVertices: [], visitedEdges: [{ from: "A", to: "B" }], label: "Add A-B (weight 1)" },
    {
      visitedVertices: [],
      visitedEdges: [
        { from: "A", to: "B" },
        { from: "C", to: "D" },
      ],
      label: "Add C-D (weight 2)",
    },
  ]);
});

test("pathSteps: one edge revealed per step along the path, hand-computed", () => {
  const steps = pathSteps(["A", "B", "C"]);
  assert.deepEqual(steps, [
    { visitedVertices: [], visitedEdges: [{ from: "A", to: "B" }], label: "A → B" },
    {
      visitedVertices: [],
      visitedEdges: [
        { from: "A", to: "B" },
        { from: "B", to: "C" },
      ],
      label: "B → C",
    },
  ]);
});

test("pathSteps: a single-vertex path (start === end) produces no edge-reveal steps", () => {
  assert.deepEqual(pathSteps(["A"]), []);
});
