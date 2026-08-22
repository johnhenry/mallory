import assert from "node:assert/strict";
import { test } from "node:test";
import { CellGraph } from "@johnhenry/math";
import { cellIdsOde2 } from "../lib/cell-ids.ts";
import { appendRow, removeRow } from "../lib/multi-panel-rows.ts";
import { decodeOde2State, encodeOde2State } from "../lib/ode2-state.ts";
import { seedOde2Row } from "./Ode2Panel.tsx";

// Unlimited expressions (issue #251): Ode2Panel now holds an ordered list
// of equation rows on one shared CellGraph, each with its own a/b/c
// coefficients and initial condition, sharing the container's own x/y
// viewport -- mirrors GraphCanvasMulti.test.ts's own "seed rows directly on
// a CellGraph, no React rendering" style.

const UNDERDAMPED_ROW = { a: "1", b: "0.4", c: "4", x0: "0", y0: "1", yPrime0: "0", color: 0x2563eb, visible: true };

function setupContainer(graph: CellGraph, containerId: string) {
  const containerIds = cellIdsOde2(containerId);
  graph.set(containerIds.xMin, "0");
  graph.set(containerIds.xMax, "10");
  graph.set(containerIds.yMin, "-1.5");
  graph.set(containerIds.yMax, "1.5");
  return containerIds;
}

test("seedOde2Row: two rows sharing one container's x-domain compute independent solutions", () => {
  const graph = new CellGraph();
  const containerIds = setupContainer(graph, "ode2-test");
  seedOde2Row(graph, containerIds, "row-1", UNDERDAMPED_ROW);
  seedOde2Row(graph, containerIds, "row-2", { ...UNDERDAMPED_ROW, b: "4", c: "4" }); // critically damped
  const solutionA = graph.get<{ ok: true } | { ok: false }>(cellIdsOde2("row-1").solution);
  const solutionB = graph.get<{ ok: true } | { ok: false }>(cellIdsOde2("row-2").solution);
  assert.ok(solutionA.ok);
  assert.ok(solutionB.ok);
});

test("seedOde2Row: each row gets its own closed-form root case, independent of sibling rows", () => {
  const graph = new CellGraph();
  const containerIds = setupContainer(graph, "ode2-test");
  seedOde2Row(graph, containerIds, "row-1", UNDERDAMPED_ROW); // disc = 0.16 - 16 < 0
  seedOde2Row(graph, containerIds, "row-2", { ...UNDERDAMPED_ROW, b: "5", c: "4" }); // disc = 25-16 > 0, overdamped
  const closedFormA = graph.get<{ found: boolean; rootCase?: string }>(cellIdsOde2("row-1").closedForm);
  const closedFormB = graph.get<{ found: boolean; rootCase?: string }>(cellIdsOde2("row-2").closedForm);
  assert.equal(closedFormA.rootCase, "complex");
  assert.equal(closedFormB.rootCase, "distinct-real");
});

test("seedOde2Row: each row gets its own color, cycling through the shared palette by index", () => {
  const graph = new CellGraph();
  const containerIds = setupContainer(graph, "ode2-test");
  seedOde2Row(graph, containerIds, "row-1", UNDERDAMPED_ROW);
  seedOde2Row(graph, containerIds, "row-2", { ...UNDERDAMPED_ROW, color: 0xdc2626 });
  assert.notEqual(graph.get<number>(cellIdsOde2("row-1").color), graph.get<number>(cellIdsOde2("row-2").color));
});

test("appendRow/removeRow: grow and shrink an Ode2Panel's row list, cleaning up a removed row's own cells and leaving the shared viewport untouched", () => {
  const graph = new CellGraph();
  const containerIds = setupContainer(graph, "ode2-test");
  const rowId = crypto.randomUUID();
  seedOde2Row(graph, containerIds, rowId, UNDERDAMPED_ROW);
  graph.set(containerIds.list, [rowId], { auxiliary: true });

  const { id: id2, index } = appendRow(graph, containerIds.list);
  assert.equal(index, 1);
  seedOde2Row(graph, containerIds, id2, { ...UNDERDAMPED_ROW, color: 0x16a34a });
  assert.deepEqual(graph.get<string[]>(containerIds.list), [rowId, id2]);

  removeRow(graph, containerIds.list, id2, cellIdsOde2(id2));
  assert.deepEqual(graph.get<string[]>(containerIds.list), [rowId]);
  assert.equal(graph.hasValue(cellIdsOde2(id2).a), false);
  assert.equal(graph.get<string>(containerIds.xMin), "0");
});

test("decodeOde2State: a legacy v1 (single-equation) fragment upgrades to a one-row v2 list", () => {
  const legacyV1 = { v: 1, a: "1", b: "0.4", c: "4", x0: "0", y0: "1", yPrime0: "0", xMin: "0", xMax: "10", yMin: "-1.5", yMax: "1.5" };
  const encodeLegacy = encodeOde2State as unknown as (s: unknown) => string;
  const decoded = decodeOde2State(encodeLegacy(legacyV1));
  assert.ok(decoded);
  assert.equal(decoded!.v, 2);
  assert.equal(decoded!.rows.length, 1);
  assert.equal(decoded!.rows[0]?.b, "0.4");
  assert.equal(decoded!.xMax, "10");
});
