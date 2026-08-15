import assert from "node:assert/strict";
import { test } from "node:test";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsGeometry } from "../lib/cell-ids.ts";
import type { GeometryOp } from "../lib/geometry-state.ts";
import { applyGeometryState, getCurrentGeometryState, replayGeometryOps } from "./GeometryPanel.tsx";

function freshGraph() {
  const graph = new CellGraph();
  const listIds = cellIdsGeometry("geo-test");
  graph.set(listIds.objectList, [] as string[], { auxiliary: true });
  graph.set(listIds.opsLog, [] as GeometryOp[], { auxiliary: true });
  return { graph, listIds };
}

test("applyGeometryState: restoring an earlier snapshot removes objects added afterward, matching the ops log exactly", () => {
  const { graph, listIds } = freshGraph();
  const ops: GeometryOp[] = [
    { tool: "point", id: "p1", x: 0, y: 0 },
    { tool: "point", id: "p2", x: 3, y: 4 },
    { tool: "line", id: "l1", a: "p1", b: "p2" },
  ];
  replayGeometryOps(graph, listIds, ops);
  const snapshot = getCurrentGeometryState(graph, listIds);
  assert.deepEqual(snapshot, { v: 1, ops });
  // 3-4-5 triangle: the line's dependent length cell should read 5.
  assert.equal(graph.get<number>("geomLength:l1"), 5);

  // Add a point AFTER the snapshot was taken -- this must not survive the restore.
  replayGeometryOps(graph, listIds, [{ tool: "point", id: "p3", x: 9, y: 9 }]);
  assert.equal(graph.has("geomPoint:p3"), true);
  assert.deepEqual(graph.get<string[]>(listIds.objectList), ["p1", "p2", "l1", "p3"]);

  applyGeometryState(graph, listIds, snapshot);

  assert.deepEqual(graph.get<string[]>(listIds.objectList), ["p1", "p2", "l1"]);
  assert.equal(graph.has("geomPoint:p3"), false, "the post-snapshot point's cell must be deleted, not just dropped from the object list");
  assert.deepEqual(graph.get("geomPoint:p1"), { x: 0, y: 0 });
  assert.deepEqual(graph.get("geomPoint:p2"), { x: 3, y: 4 });
  assert.equal(graph.get<number>("geomLength:l1"), 5, "the dependent length cell recomputes correctly after replay");
  assert.deepEqual(getCurrentGeometryState(graph, listIds), snapshot, "a full round trip through applyGeometryState reproduces the exact same state");
});

test("applyGeometryState: restoring to an empty snapshot clears every object", () => {
  const { graph, listIds } = freshGraph();
  replayGeometryOps(graph, listIds, [{ tool: "point", id: "p1", x: 1, y: 1 }]);
  assert.equal(graph.has("geomPoint:p1"), true);

  applyGeometryState(graph, listIds, { v: 1, ops: [] });

  assert.deepEqual(graph.get<string[]>(listIds.objectList), []);
  assert.equal(graph.has("geomPoint:p1"), false);
});
