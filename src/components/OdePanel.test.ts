import assert from "node:assert/strict";
import { test } from "node:test";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsOde } from "../lib/cell-ids.ts";
import { appendRow, removeRow } from "../lib/multi-panel-rows.ts";
import { decodeOdeState, encodeOdeState, type OdeRowState } from "../lib/ode-state.ts";
import { getCurrentOdeState, seedOdeRow, seedOdeState } from "./OdePanel.tsx";

// #336 item 7: OdePanel now holds an ordered list of IVP rows on one shared
// CellGraph, each with its own expr/x0/y0, sharing the container's x/y
// domain -- mirrors Ode2Panel.test.ts's own "seed rows directly on a
// CellGraph, no React rendering" style.

const ROW_A: OdeRowState = { expr: "x - y", x0: "0", y0: "1", color: 0x2563eb, visible: true };

function setupContainer(graph: CellGraph, containerId: string) {
  const containerIds = cellIdsOde(containerId);
  graph.set(containerIds.xMin, "-5");
  graph.set(containerIds.xMax, "5");
  graph.set(containerIds.yMin, "-5");
  graph.set(containerIds.yMax, "5");
  return containerIds;
}

test("seedOdeRow: two rows sharing one container's domain compute independent solutions", () => {
  const graph = new CellGraph();
  const containerIds = setupContainer(graph, "ode-test");
  seedOdeRow(graph, containerIds, "row-1", ROW_A);
  seedOdeRow(graph, containerIds, "row-2", { ...ROW_A, expr: "-x" });
  const solutionA = graph.get<{ ok: true } | { ok: false }>(cellIdsOde("row-1").solution);
  const solutionB = graph.get<{ ok: true } | { ok: false }>(cellIdsOde("row-2").solution);
  assert.ok(solutionA.ok);
  assert.ok(solutionB.ok);
});

test("seedOdeRow: each row gets its own slope field, independent of sibling rows' expression", () => {
  const graph = new CellGraph();
  const containerIds = setupContainer(graph, "ode-test");
  seedOdeRow(graph, containerIds, "row-1", ROW_A);
  seedOdeRow(graph, containerIds, "row-2", { ...ROW_A, expr: "-x" });
  const fieldA = graph.get<{ ok: boolean }>(cellIdsOde("row-1").slopeField);
  const fieldB = graph.get<{ ok: boolean }>(cellIdsOde("row-2").slopeField);
  assert.ok(fieldA.ok);
  assert.ok(fieldB.ok);
});

test("appendRow/removeRow: grow and shrink an OdePanel's row list, cleaning up a removed row's own cells and leaving the shared domain untouched", () => {
  const graph = new CellGraph();
  const containerIds = setupContainer(graph, "ode-test");
  const rowId = crypto.randomUUID();
  seedOdeRow(graph, containerIds, rowId, ROW_A);
  graph.set(containerIds.list, [rowId], { auxiliary: true });

  const { id: id2, index } = appendRow(graph, containerIds.list);
  assert.equal(index, 1);
  seedOdeRow(graph, containerIds, id2, { ...ROW_A, color: 0x16a34a });
  assert.deepEqual(graph.get<string[]>(containerIds.list), [rowId, id2]);

  removeRow(graph, containerIds.list, id2, cellIdsOde(id2));
  assert.deepEqual(graph.get<string[]>(containerIds.list), [rowId]);
  assert.equal(graph.hasValue(cellIdsOde(id2).expr), false);
  assert.equal(graph.get<string>(containerIds.xMin), "-5");
});

test("seedOdeState: re-seeding an already-populated container replaces every row (not appends), the shape NotebookOdeBlock's post-mount overwrite relies on", () => {
  const graph = new CellGraph();
  const containerIds = cellIdsOde("ode-test");
  graph.set(containerIds.list, [] as string[], { auxiliary: true });
  seedOdeState(graph, containerIds, { v: 2, xMin: "-1", xMax: "1", yMin: "-1", yMax: "1", rows: [ROW_A] });
  const firstRowId = graph.get<string[]>(containerIds.list)[0] as string;

  seedOdeState(graph, containerIds, { v: 2, xMin: "-9", xMax: "9", yMin: "-9", yMax: "9", rows: [ROW_A, { ...ROW_A, expr: "-x" }] });

  assert.equal(graph.get<string[]>(containerIds.list).length, 2, "replaced with exactly the new rows, not appended onto the old one");
  assert.equal(graph.has(cellIdsOde(firstRowId).expr), false, "the old row's cells are gone, not orphaned");
  assert.equal(graph.get<string>(containerIds.xMin), "-9");
});

test("getCurrentOdeState round-trips through seedOdeState", () => {
  const graph = new CellGraph();
  const containerIds = cellIdsOde("ode-test");
  graph.set(containerIds.list, [] as string[], { auxiliary: true });
  const state = { v: 2 as const, xMin: "-2", xMax: "2", yMin: "-3", yMax: "3", rows: [ROW_A, { ...ROW_A, expr: "-x", visible: false }] };
  seedOdeState(graph, containerIds, state);
  assert.deepEqual(getCurrentOdeState(graph, containerIds), state);
});

test("decodeOdeState: a legacy v1 (single-equation) fragment upgrades to a one-row v2 list", () => {
  const legacyV1 = { v: 1, expr: "x - y", x0: "0", y0: "1", xMin: "-5", xMax: "5", yMin: "-5", yMax: "5" };
  const encodeLegacy = encodeOdeState as unknown as (s: unknown) => string;
  const decoded = decodeOdeState(encodeLegacy(legacyV1));
  assert.ok(decoded);
  assert.equal(decoded!.v, 2);
  assert.equal(decoded!.rows.length, 1);
  assert.equal(decoded!.rows[0]?.expr, "x - y");
  assert.equal(decoded!.xMax, "5");
});
