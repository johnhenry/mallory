import assert from "node:assert/strict";
import { test } from "node:test";
import type { Mesh } from "@johnhenry/math";
import { CellGraph } from "@johnhenry/math";
import { cellIds3D } from "../lib/cell-ids.ts";
import { appendRow, removeRow } from "../lib/multi-panel-rows.ts";
import { getCurrentGraph3DRows, getPrimaryRow3D, seedGraph3DRow, seedGraph3DRows } from "./Graph3DCanvas.tsx";

// Unlimited overlaid surfaces (#336 item 7): Graph3DCanvas now holds an
// ordered list of surface rows on one shared CellGraph, each with its own
// z=f(x,y), free-var params, color and visibility -- mirrors
// ParametricSurfacePanel.test.ts's own "seed rows directly on a CellGraph,
// no React rendering" style.

const ROW_A = { source: "x^2-y^2", params: {}, color: 0x2563eb, visible: true };
const ROW_B = { source: "sin(x)*cos(y)", params: {}, color: 0xdc2626, visible: false };

test("seedGraph3DRow: two rows produce independent non-empty meshes, each baking in its own row color", () => {
  const graph = new CellGraph();
  seedGraph3DRow(graph, "row-1", ROW_A);
  seedGraph3DRow(graph, "row-2", ROW_B);
  const meshA = graph.get<Mesh[]>(cellIds3D("row-1").mesh);
  const meshB = graph.get<Mesh[]>(cellIds3D("row-2").mesh);
  assert.ok(meshA.length > 0);
  assert.ok(meshB.length > 0);
  assert.equal(meshA[0]?.material.color, ROW_A.color);
  assert.equal(meshB[0]?.material.color, ROW_B.color);
});

test("seedGraph3DRow: substitutes seeded free-var params into the sampled mesh", () => {
  const graph = new CellGraph();
  seedGraph3DRow(graph, "row-1", { source: "a*x*y", params: { a: 3 }, color: 0x2563eb, visible: true });
  assert.equal(graph.get<number>(cellIds3D("row-1").param("a")), 3);
  const mesh = graph.get<Mesh[]>(cellIds3D("row-1").mesh);
  for (const m of mesh) {
    for (const face of m.faces) {
      for (const vertex of face) assert.ok(Math.abs(vertex.z - 3 * vertex.x * vertex.y) < 1e-9);
    }
  }
});

test("appendRow/removeRow: grow and shrink a 3D panel's row list, cleaning up a removed row's own cells", () => {
  const graph = new CellGraph();
  const listCellId = cellIds3D("surf-test").list;
  const rowId = crypto.randomUUID();
  seedGraph3DRow(graph, rowId, ROW_A);
  graph.set(listCellId, [rowId], { auxiliary: true });

  const { id: id2 } = appendRow(graph, listCellId);
  seedGraph3DRow(graph, id2, { ...ROW_A, color: 0x16a34a });
  assert.deepEqual(graph.get<string[]>(listCellId), [rowId, id2]);

  removeRow(graph, listCellId, id2, cellIds3D(id2));
  assert.deepEqual(graph.get<string[]>(listCellId), [rowId]);
  assert.equal(graph.hasValue(cellIds3D(id2).expr), false);
});

test("getPrimaryRow3D: the first row in the list, or null for an empty list", () => {
  const graph = new CellGraph();
  const containerIds = cellIds3D("surf-container");
  graph.set(containerIds.list, [] as string[], { auxiliary: true });
  assert.equal(getPrimaryRow3D(graph, containerIds), null);

  const rowA = crypto.randomUUID();
  const rowB = crypto.randomUUID();
  seedGraph3DRow(graph, rowA, ROW_A);
  seedGraph3DRow(graph, rowB, ROW_B);
  graph.set(containerIds.list, [rowA, rowB], { auxiliary: true });
  const primary = getPrimaryRow3D(graph, containerIds);
  assert.equal(primary?.rowId, rowA);
});

test("getCurrentGraph3DRows/seedGraph3DRows: round-trips a multi-surface row list (Linked3DView's own hydrate primitive)", () => {
  const graph = new CellGraph();
  const containerIds = cellIds3D("surf-container");
  const rowA = crypto.randomUUID();
  const rowB = crypto.randomUUID();
  seedGraph3DRow(graph, rowA, ROW_A);
  seedGraph3DRow(graph, rowB, ROW_B);
  graph.set(containerIds.list, [rowA, rowB], { auxiliary: true });

  const rows = getCurrentGraph3DRows(graph, containerIds);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.source, ROW_A.source);
  assert.equal(rows[1]?.visible, false);

  // Full re-seed with a fresh row list -- the same "clear then replay" shape
  // a linked/notebook host's own hydrate effect relies on.
  seedGraph3DRows(graph, containerIds, [{ source: "x+y", params: {}, color: 0x9333ea, visible: true }]);
  const reseeded = getCurrentGraph3DRows(graph, containerIds);
  assert.equal(reseeded.length, 1);
  assert.equal(reseeded[0]?.source, "x+y");
  // The old rows' own cells are gone, not just unreferenced.
  assert.equal(graph.hasValue(cellIds3D(rowA).expr), false);
  assert.equal(graph.hasValue(cellIds3D(rowB).expr), false);
});
