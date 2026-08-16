import assert from "node:assert/strict";
import { test } from "node:test";
import { computeLayout, findVertexAt, nextVertexLabel } from "./graph-editor.ts";
import { circularLayout } from "./graph-ops.ts";

test("nextVertexLabel: an empty graph starts at A", () => {
  assert.equal(nextVertexLabel([]), "A");
});

test("nextVertexLabel: picks the first unused letter, not just one past the last used one", () => {
  assert.equal(nextVertexLabel(["A"]), "B");
  assert.equal(nextVertexLabel(["A", "C"]), "B"); // B is free even though C is already taken
  assert.equal(nextVertexLabel(["A", "B", "C"]), "D");
});

test("nextVertexLabel: skips labels used out of scheme order (e.g. via the text box) and still finds the lowest free one", () => {
  assert.equal(nextVertexLabel(["Z", "start", "end"]), "A"); // none of these are scheme labels A/B/...
  assert.equal(nextVertexLabel(["A", "B", "D"]), "C");
});

test("nextVertexLabel: rolls over from Z to AA after all 26 single letters are used (spreadsheet-column convention)", () => {
  const allSingleLetters = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
  assert.equal(nextVertexLabel(allSingleLetters), "AA");
  assert.equal(nextVertexLabel([...allSingleLetters, "AA"]), "AB");
});

test("findVertexAt: returns null when no vertex is within hitRadiusPx", () => {
  const positions = new Map([["A", { sx: 0, sy: 0 }]]);
  assert.equal(findVertexAt({ sx: 100, sy: 100 }, positions, 10), null);
});

test("findVertexAt: returns the vertex exactly at the point (distance 0)", () => {
  const positions = new Map([
    ["A", { sx: 50, sy: 50 }],
    ["B", { sx: 200, sy: 200 }],
  ]);
  assert.equal(findVertexAt({ sx: 50, sy: 50 }, positions, 15), "A");
});

test("findVertexAt: a point exactly at the boundary distance (hand-computed 3-4-5 triangle) counts as a hit; just past it doesn't", () => {
  const positions = new Map([["A", { sx: 0, sy: 0 }]]);
  // distance = sqrt(3^2+4^2) = 5 exactly
  assert.equal(findVertexAt({ sx: 3, sy: 4 }, positions, 5), "A");
  assert.equal(findVertexAt({ sx: 3, sy: 4 }, positions, 4.999), null);
});

test("findVertexAt: when two vertices are both in range, returns the CLOSER one regardless of iteration order", () => {
  // "near" iterates AFTER "far" here -- a mutant that just takes the LAST
  // in-range entry (ignoring distance) would wrongly return "far" for this
  // case even though it correctly matched the opposite ordering elsewhere.
  const farThenNear = new Map([
    ["far", { sx: 0, sy: 8 }],
    ["near", { sx: 0, sy: 3 }],
  ]);
  assert.equal(findVertexAt({ sx: 0, sy: 0 }, farThenNear, 10), "near");

  const nearThenFar = new Map([
    ["near", { sx: 0, sy: 3 }],
    ["far", { sx: 0, sy: 8 }],
  ]);
  assert.equal(findVertexAt({ sx: 0, sy: 0 }, nearThenFar, 10), "near");
});

test("findVertexAt: empty positions map always returns null", () => {
  assert.equal(findVertexAt({ sx: 0, sy: 0 }, new Map(), 1000), null);
});

test("computeLayout: showEditor=false always returns exactly circularLayout's own result, regardless of vertexPositions content", () => {
  const vertices = ["A", "B", "C"];
  const positions = { A: { x: 99, y: 99 }, B: { x: -5, y: -5 } };
  assert.deepEqual(computeLayout(vertices, positions, false), circularLayout(vertices));
});

test("computeLayout: showEditor=true with no stored positions matches circularLayout exactly (nothing to override)", () => {
  const vertices = ["A", "B", "C"];
  assert.deepEqual(computeLayout(vertices, {}, true), circularLayout(vertices));
});

test("computeLayout: showEditor=true overrides exactly the vertices with a stored position, leaving the rest at their circularLayout fallback", () => {
  const vertices = ["A", "B", "C"];
  const fallback = circularLayout(vertices);
  const result = computeLayout(vertices, { B: { x: 7, y: -3 } }, true);
  assert.deepEqual(result.get("A"), fallback.get("A"));
  assert.deepEqual(result.get("B"), { x: 7, y: -3 });
  assert.deepEqual(result.get("C"), fallback.get("C"));
});

test("computeLayout: a stored position for a vertex NOT in the current vertex list is ignored, not leaked into the returned layout", () => {
  const vertices = ["A", "B"];
  const result = computeLayout(vertices, { A: { x: 1, y: 1 }, ghost: { x: 42, y: 42 } }, true);
  assert.equal(result.has("ghost"), false);
  assert.equal(result.size, 2);
});
