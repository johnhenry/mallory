import assert from "node:assert/strict";
import { test } from "node:test";
import { CellGraph } from "@johnhenry/math";
import { cellIdsImplicit } from "../lib/cell-ids.ts";
import { appendRow, removeRow } from "../lib/multi-panel-rows.ts";
import { boundOrDefault, seedImplicitRow } from "./ImplicitPanel.tsx";

test("boundOrDefault: a literal \"0\" is used as-is, not treated as falsy (the bug: Number(x) || fallback discards it)", () => {
  assert.equal(boundOrDefault("0", -5), 0);
});

test("boundOrDefault: a genuinely non-numeric string falls back to the default", () => {
  assert.equal(boundOrDefault("not a number", -5), -5);
});

test("boundOrDefault: an empty string is JS's own Number('') === 0 quirk, not a parse failure -- returns 0, not the fallback", () => {
  assert.equal(boundOrDefault("", -5), 0);
});

test("boundOrDefault: an ordinary numeric string passes through unchanged", () => {
  assert.equal(boundOrDefault("3.3", -5), 3.3);
  assert.equal(boundOrDefault("-2", 5), -2);
});

// Unlimited expressions (issue #251): ImplicitPanel now holds an ordered
// list of relation rows on one shared CellGraph, each sharing the
// container's own domain bounds but computing its own segments/color/
// visibility independently -- mirrors GraphCanvasMulti.test.ts's own
// "seed rows directly on a CellGraph, no React rendering" style.
function setupContainer(graph: CellGraph, containerId: string) {
  const containerIds = cellIdsImplicit(containerId);
  graph.set(containerIds.xMin, "-5");
  graph.set(containerIds.xMax, "5");
  graph.set(containerIds.yMin, "-5");
  graph.set(containerIds.yMax, "5");
  return containerIds;
}

test("seedImplicitRow: two rows sharing one container's domain compute independent segments for their own relation", () => {
  const graph = new CellGraph();
  const containerIds = setupContainer(graph, "implicit-test");
  seedImplicitRow(graph, containerIds, "row-1", 0, "x^2+y^2=4");
  seedImplicitRow(graph, containerIds, "row-2", 1, "y=x");
  const idsA = cellIdsImplicit("row-1");
  const idsB = cellIdsImplicit("row-2");
  const segmentsA = graph.get<{ ok: true; segments: unknown[] } | { ok: false }>(idsA.segments);
  const segmentsB = graph.get<{ ok: true; segments: unknown[] } | { ok: false }>(idsB.segments);
  assert.ok(segmentsA.ok && segmentsA.segments.length > 0);
  assert.ok(segmentsB.ok && segmentsB.segments.length > 0);
});

test("seedImplicitRow: each row gets its own color, cycling through the shared palette by index", () => {
  const graph = new CellGraph();
  const containerIds = setupContainer(graph, "implicit-test");
  seedImplicitRow(graph, containerIds, "row-1", 0, "x^2+y^2=4");
  seedImplicitRow(graph, containerIds, "row-2", 1, "y=x");
  const colorA = graph.get<number>(cellIdsImplicit("row-1").color);
  const colorB = graph.get<number>(cellIdsImplicit("row-2").color);
  assert.notEqual(colorA, colorB);
});

test("appendRow: grows the container's row list and returns a fresh id/index for palette cycling", () => {
  const graph = new CellGraph();
  const containerIds = setupContainer(graph, "implicit-test");
  const rowId = crypto.randomUUID();
  seedImplicitRow(graph, containerIds, rowId, 0, "x^2+y^2=4");
  graph.set(containerIds.list, [rowId], { auxiliary: true });
  const { id, index } = appendRow(graph, containerIds.list);
  assert.equal(index, 1);
  seedImplicitRow(graph, containerIds, id, index, "y=x");
  assert.deepEqual(graph.get<string[]>(containerIds.list), [rowId, id]);
});

test("removeRow: drops the row from the list and deletes its own cells, leaving the shared domain untouched", () => {
  const graph = new CellGraph();
  const containerIds = setupContainer(graph, "implicit-test");
  seedImplicitRow(graph, containerIds, "row-1", 0, "x^2+y^2=4");
  seedImplicitRow(graph, containerIds, "row-2", 1, "y=x");
  graph.set(containerIds.list, ["row-1", "row-2"], { auxiliary: true });
  removeRow(graph, containerIds.list, "row-2", cellIdsImplicit("row-2"));
  assert.deepEqual(graph.get<string[]>(containerIds.list), ["row-1"]);
  assert.equal(graph.hasValue(cellIdsImplicit("row-2").expr), false);
  assert.equal(graph.get<string>(containerIds.xMin), "-5");
});
