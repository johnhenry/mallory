import assert from "node:assert/strict";
import { test } from "node:test";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsParametricSurface } from "../lib/cell-ids.ts";
import { appendRow, removeRow } from "../lib/multi-panel-rows.ts";
import { DEFAULT_PARAMETRIC_SURFACE_STATE, decodeParametricSurfaceState, encodeParametricSurfaceState } from "../lib/parametric-surface-state.ts";
import { getCurrentState, restoreState, seedParametricSurfaceRow } from "./ParametricSurfacePanel.tsx";

// Unlimited expressions (issue #251): ParametricSurfacePanel now holds an
// ordered list of surface rows on one shared CellGraph, each with its own
// x/y/z(u,v), u/v domain, color and visibility -- mirrors
// GraphCanvasMulti.test.ts's own "seed rows directly on a CellGraph, no
// React rendering" style.

const TORUS_ROW = {
  exprX: "(2+cos(v))*cos(u)",
  exprY: "(2+cos(v))*sin(u)",
  exprZ: "sin(v)",
  uMin: "0",
  uMax: "6.28318",
  vMin: "0",
  vMax: "6.28318",
  color: 0x2563eb,
  visible: true,
};

test("seedParametricSurfaceRow: two rows produce independent non-empty meshes", () => {
  const graph = new CellGraph();
  seedParametricSurfaceRow(graph, "row-1", TORUS_ROW);
  seedParametricSurfaceRow(graph, "row-2", { ...TORUS_ROW, color: 0xdc2626 });
  const meshA = graph.get<{ ok: true; value: unknown[] } | { ok: false }>(cellIdsParametricSurface("row-1").mesh);
  const meshB = graph.get<{ ok: true; value: unknown[] } | { ok: false }>(cellIdsParametricSurface("row-2").mesh);
  assert.ok(meshA.ok && meshA.value.length > 0);
  assert.ok(meshB.ok && meshB.value.length > 0);
});

test("seedParametricSurfaceRow: each row keeps its own color, independent of the other rows", () => {
  const graph = new CellGraph();
  seedParametricSurfaceRow(graph, "row-1", TORUS_ROW);
  seedParametricSurfaceRow(graph, "row-2", { ...TORUS_ROW, color: 0xdc2626 });
  assert.equal(graph.get<number>(cellIdsParametricSurface("row-1").color), 0x2563eb);
  assert.equal(graph.get<number>(cellIdsParametricSurface("row-2").color), 0xdc2626);
});

test("appendRow/removeRow: grow and shrink a parametric-surface panel's row list, cleaning up a removed row's own cells", () => {
  const graph = new CellGraph();
  const listCellId = cellIdsParametricSurface("surf-test").list;
  const rowId = crypto.randomUUID();
  seedParametricSurfaceRow(graph, rowId, TORUS_ROW);
  graph.set(listCellId, [rowId], { auxiliary: true });

  const { id: id2 } = appendRow(graph, listCellId);
  seedParametricSurfaceRow(graph, id2, { ...TORUS_ROW, color: 0x16a34a });
  assert.deepEqual(graph.get<string[]>(listCellId), [rowId, id2]);

  removeRow(graph, listCellId, id2, cellIdsParametricSurface(id2));
  assert.deepEqual(graph.get<string[]>(listCellId), [rowId]);
  assert.equal(graph.hasValue(cellIdsParametricSurface(id2).exprX), false);
});

test("getCurrentState/restoreState: round-trips a multi-surface snapshot (undo/redo's own primitive)", () => {
  const graph = new CellGraph();
  const containerIds = cellIdsParametricSurface("surf-container");
  const rowA = crypto.randomUUID();
  const rowB = crypto.randomUUID();
  seedParametricSurfaceRow(graph, rowA, TORUS_ROW);
  seedParametricSurfaceRow(graph, rowB, { ...TORUS_ROW, color: 0xdc2626, visible: false });
  graph.set(containerIds.list, [rowA, rowB], { auxiliary: true });

  const snapshot = getCurrentState(graph, containerIds);
  assert.equal(snapshot.rows.length, 2);
  assert.equal(snapshot.rows[1]?.visible, false);

  // Mutate, then restore the earlier snapshot -- the row count/colors should
  // go back to what was captured, same as GraphCanvasMulti's own
  // restoreMultiGraphState test coverage.
  graph.set(cellIdsParametricSurface(rowA).color, 0x000000);
  restoreState(graph, containerIds, snapshot);
  const restoredIds = graph.get<string[]>(containerIds.list);
  assert.equal(restoredIds.length, 2);
});

test("decodeParametricSurfaceState: a legacy v1 (single-surface) fragment upgrades to a one-row v2 list", () => {
  const legacyV1 = {
    v: 1,
    exprX: "u",
    exprY: "v",
    exprZ: "0",
    uMin: "-1",
    uMax: "1",
    vMin: "-1",
    vMax: "1",
  };
  const fragment = encodeParametricSurfaceState(legacyV1 as unknown as typeof DEFAULT_PARAMETRIC_SURFACE_STATE);
  const decoded = decodeParametricSurfaceState(fragment);
  assert.ok(decoded);
  assert.equal(decoded!.v, 2);
  assert.equal(decoded!.rows.length, 1);
  assert.equal(decoded!.rows[0]?.exprX, "u");
});
