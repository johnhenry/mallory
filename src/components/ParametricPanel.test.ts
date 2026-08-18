import assert from "node:assert/strict";
import { test } from "node:test";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsParametric } from "../lib/cell-ids.ts";
import { appendRow, removeRow } from "../lib/multi-panel-rows.ts";
import { seedParametricRow } from "./ParametricPanel.tsx";

// Unlimited expressions (issue #251): ParametricPanel now holds an ordered
// list of curve rows on one shared CellGraph, each independently choosing
// parametric vs. polar mode and its own t/θ domain -- mirrors
// GraphCanvasMulti.test.ts's own "seed rows directly on a CellGraph, no
// React rendering" style.

test("seedParametricRow: a fresh row defaults to parametric mode and samples a valid path", () => {
  const graph = new CellGraph();
  seedParametricRow(graph, "row-1", 0);
  const ids = cellIdsParametric("row-1");
  assert.equal(graph.get<string>(ids.mode), "parametric");
  const path = graph.get<{ ok: true; path: unknown } | { ok: false }>(ids.path);
  assert.ok(path.ok);
});

test("seedParametricRow: two rows can independently switch mode (one parametric, one polar) without interfering", () => {
  const graph = new CellGraph();
  seedParametricRow(graph, "row-1", 0);
  seedParametricRow(graph, "row-2", 1);
  const idsA = cellIdsParametric("row-1");
  const idsB = cellIdsParametric("row-2");
  graph.set(idsB.mode, "polar");
  assert.equal(graph.get<string>(idsA.mode), "parametric");
  assert.equal(graph.get<string>(idsB.mode), "polar");
  const pathA = graph.get<{ ok: true } | { ok: false }>(idsA.path);
  const pathB = graph.get<{ ok: true } | { ok: false }>(idsB.path);
  assert.ok(pathA.ok);
  assert.ok(pathB.ok);
});

test("seedParametricRow: each row gets its own color, cycling through the shared palette by index", () => {
  const graph = new CellGraph();
  seedParametricRow(graph, "row-1", 0);
  seedParametricRow(graph, "row-2", 1);
  const colorA = graph.get<number>(cellIdsParametric("row-1").color);
  const colorB = graph.get<number>(cellIdsParametric("row-2").color);
  assert.notEqual(colorA, colorB);
});

test("appendRow/removeRow: grow and shrink a parametric panel's row list, cleaning up a removed row's own cells", () => {
  const graph = new CellGraph();
  const listCellId = cellIdsParametric("parametric-test").list;
  const rowId = crypto.randomUUID();
  seedParametricRow(graph, rowId, 0);
  graph.set(listCellId, [rowId], { auxiliary: true });

  const { id: id2, index } = appendRow(graph, listCellId);
  assert.equal(index, 1);
  seedParametricRow(graph, id2, index);
  assert.deepEqual(graph.get<string[]>(listCellId), [rowId, id2]);

  removeRow(graph, listCellId, id2, cellIdsParametric(id2));
  assert.deepEqual(graph.get<string[]>(listCellId), [rowId]);
  assert.equal(graph.hasValue(cellIdsParametric(id2).exprX), false);
});
