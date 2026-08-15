import assert from "node:assert/strict";
import { test } from "node:test";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsMultiRow, EXPRESSION_LIST_CELL, VIEWPORT_CELL } from "../lib/cell-ids.ts";
import { getMultiGraphSvg } from "./GraphCanvasMulti.tsx";

const VIEWPORT = { xMin: 0, xMax: 2, yMin: 0, yMax: 2 };

function fakePath(color: number) {
  return {
    stroke: { thickness: 2, color, alpha: 1, pixelHinting: false, scaleMode: "normal", caps: null, joints: null, miterLimit: 3 },
    commands: [{ op: "moveTo" as const, x: 0, y: 0 }],
  };
}

function seedRow(graph: CellGraph, id: string, opts: { visible: boolean; color: number; scatter?: unknown }) {
  const ids = cellIdsMultiRow(id);
  graph.set(ids.visible, opts.visible);
  graph.set(ids.path, fakePath(opts.color));
  if (opts.scatter !== undefined) graph.set(ids.scatter, opts.scatter);
  return ids;
}

test("getMultiGraphSvg: includes every visible row's curve, in row order", () => {
  const graph = new CellGraph();
  graph.set(VIEWPORT_CELL, VIEWPORT);
  seedRow(graph, "row-1", { visible: true, color: 0x2563eb });
  seedRow(graph, "row-2", { visible: true, color: 0xdc2626 });
  const svg = getMultiGraphSvg(graph, ["row-1", "row-2"]);
  assert.ok(svg);
  const firstIndex = svg!.indexOf("#2563eb");
  const secondIndex = svg!.indexOf("#dc2626");
  assert.ok(firstIndex > -1 && secondIndex > -1 && firstIndex < secondIndex);
});

test("getMultiGraphSvg: a hidden row's curve is excluded", () => {
  const graph = new CellGraph();
  graph.set(VIEWPORT_CELL, VIEWPORT);
  seedRow(graph, "row-1", { visible: true, color: 0x2563eb });
  seedRow(graph, "row-2", { visible: false, color: 0xdc2626 });
  const svg = getMultiGraphSvg(graph, ["row-1", "row-2"]);
  assert.ok(svg);
  assert.ok(svg!.includes("#2563eb"));
  assert.ok(!svg!.includes("#dc2626"));
});

test("getMultiGraphSvg: a visible row in finite-structure/scatter mode is excluded (no Path2D to export)", () => {
  const graph = new CellGraph();
  graph.set(VIEWPORT_CELL, VIEWPORT);
  seedRow(graph, "row-1", { visible: true, color: 0x2563eb, scatter: [{ x: 0, y: 0 }] });
  const svg = getMultiGraphSvg(graph, ["row-1"]);
  assert.equal(svg, null);
});

test("getMultiGraphSvg: no rows at all returns null rather than an empty-but-valid SVG document", () => {
  const graph = new CellGraph();
  graph.set(VIEWPORT_CELL, VIEWPORT);
  assert.equal(getMultiGraphSvg(graph, []), null);
});

test("getMultiGraphSvg: a row whose cells haven't been registered yet (not yet mounted) is skipped, not thrown", () => {
  const graph = new CellGraph();
  graph.set(VIEWPORT_CELL, VIEWPORT);
  seedRow(graph, "row-1", { visible: true, color: 0x2563eb });
  // "row-2" is in EXPRESSION_LIST_CELL's conceptual list but its ExpressionRow hasn't mounted, so none of its cells exist yet.
  const svg = getMultiGraphSvg(graph, ["row-1", "row-2"]);
  assert.ok(svg);
  assert.ok(svg!.includes("#2563eb"));
});

test("EXPRESSION_LIST_CELL sanity: getMultiGraphSvg reads whatever row-id list it's given, independent of the cell's own current value", () => {
  const graph = new CellGraph();
  graph.set(VIEWPORT_CELL, VIEWPORT);
  graph.set(EXPRESSION_LIST_CELL, ["row-1"], { auxiliary: true });
  seedRow(graph, "row-1", { visible: true, color: 0x2563eb });
  assert.ok(getMultiGraphSvg(graph, graph.get<string[]>(EXPRESSION_LIST_CELL)));
});
