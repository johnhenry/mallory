import assert from "node:assert/strict";
import { test } from "node:test";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsGeometry } from "../lib/cell-ids.ts";
import type { GeometryOp } from "../lib/geometry-state.ts";
import {
  applyGeometryState,
  deleteGeometryObject,
  editGeometryOp,
  editGeometryOps,
  getCurrentGeometryState,
  recolorGeometryObject,
  replayGeometryOps,
} from "./GeometryPanel.tsx";

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

test("editGeometryOp: changing a rotation's angle after construction actually moves the dependent point (#336 item 4)", () => {
  const { graph, listIds } = freshGraph();
  const ops: GeometryOp[] = [
    { tool: "point", id: "src", x: 1, y: 0 },
    { tool: "point", id: "center", x: 0, y: 0 },
    { tool: "rotation", id: "r1", source: "src", center: "center", angleDegrees: 90 },
  ];
  replayGeometryOps(graph, listIds, ops);
  const rotated90 = graph.get<{ x: number; y: number }>("geomPoint:r1");
  assert.ok(Math.abs(rotated90.x - 0) < 1e-9 && Math.abs(rotated90.y - 1) < 1e-9, "90 degrees around the origin: (1,0) -> (0,1)");

  editGeometryOp(graph, listIds, "r1", { angleDegrees: 180 });

  const rotated180 = graph.get<{ x: number; y: number }>("geomPoint:r1");
  assert.ok(Math.abs(rotated180.x - -1) < 1e-9 && Math.abs(rotated180.y - 0) < 1e-9, "180 degrees around the origin: (1,0) -> (-1,0)");
  assert.equal(
    (getCurrentGeometryState(graph, listIds).ops.find((op) => op.id === "r1") as { tool: "rotation"; angleDegrees: number }).angleDegrees,
    180,
    "the op log itself reflects the edit, so it round-trips through save/undo/URL-hash correctly",
  );
});

test("editGeometryOp: editing one op preserves every other op's identity and order", () => {
  const { graph, listIds } = freshGraph();
  const ops: GeometryOp[] = [
    { tool: "point", id: "p1", x: 0, y: 0 },
    { tool: "point", id: "p2", x: 1, y: 0 },
    { tool: "translation", id: "t1", source: "p2", dx: 1, dy: 0 },
  ];
  replayGeometryOps(graph, listIds, ops);

  editGeometryOp(graph, listIds, "t1", { dx: 5, dy: 5 });

  assert.deepEqual(graph.get<string[]>(listIds.objectList), ["p1", "p2", "t1"], "no object dropped or reordered by the edit");
  assert.deepEqual(graph.get("geomPoint:t1"), { x: 6, y: 5 });
});

test("recolorGeometryObject: sets the live color cell and persists into the op log for round-tripping (#336 item 2)", () => {
  const { graph, listIds } = freshGraph();
  const ops: GeometryOp[] = [
    { tool: "point", id: "p1", x: 0, y: 0 },
    { tool: "point", id: "p2", x: 1, y: 0 },
    { tool: "line", id: "l1", a: "p1", b: "p2" },
  ];
  replayGeometryOps(graph, listIds, ops);
  assert.equal(graph.has("geomColor:l1"), false, "un-recolored line has no color cell -- keeps following the theme default");

  recolorGeometryObject(graph, listIds, "l1", "#ff0000");

  assert.equal(graph.get<string>("geomColor:l1"), "#ff0000");
  const persisted = getCurrentGeometryState(graph, listIds).ops.find((op) => op.id === "l1") as { tool: "line"; color?: string };
  assert.equal(persisted.color, "#ff0000", "the op log itself reflects the recolor");
});

test("recolorGeometryObject: a round trip through applyGeometryState (undo/redo, hash hydration) preserves the custom color", () => {
  const { graph, listIds } = freshGraph();
  replayGeometryOps(graph, listIds, [
    { tool: "point", id: "p1", x: 0, y: 0 },
    { tool: "point", id: "p2", x: 0, y: 1 },
    { tool: "circle", id: "c1", center: "p1", radiusPoint: "p2" },
  ]);
  recolorGeometryObject(graph, listIds, "c1", "#00ff00");
  const snapshot = getCurrentGeometryState(graph, listIds);

  applyGeometryState(graph, listIds, { v: 1, ops: [] }); // simulate a full undo-to-empty
  applyGeometryState(graph, listIds, snapshot); // then redo

  assert.equal(graph.get<string>("geomColor:c1"), "#00ff00");
});

test("deleteGeometryObject: removing a line/circle/polygon leaves its defining points untouched (nothing references a non-point object id)", () => {
  const { graph, listIds } = freshGraph();
  replayGeometryOps(graph, listIds, [
    { tool: "point", id: "p1", x: 0, y: 0 },
    { tool: "point", id: "p2", x: 1, y: 0 },
    { tool: "line", id: "l1", a: "p1", b: "p2" },
  ]);

  const removed = deleteGeometryObject(graph, listIds, "l1");

  assert.deepEqual(removed, new Set(["l1"]));
  assert.deepEqual(graph.get<string[]>(listIds.objectList), ["p1", "p2"]);
  assert.equal(graph.has("geomPoint:p1"), true);
  assert.equal(graph.has("geomPoint:p2"), true);
});

test("deleteGeometryObject: removing a point cascades to every line/circle/transform/polygon built from it", () => {
  const { graph, listIds } = freshGraph();
  replayGeometryOps(graph, listIds, [
    { tool: "point", id: "p1", x: 0, y: 0 },
    { tool: "point", id: "p2", x: 1, y: 0 },
    { tool: "point", id: "p3", x: 0, y: 1 },
    { tool: "line", id: "l1", a: "p1", b: "p2" }, // references p1
    { tool: "circle", id: "c1", center: "p1", radiusPoint: "p3" }, // references p1
    { tool: "polygon", id: "poly1", points: ["p1", "p2", "p3"] }, // references p1
    { tool: "line", id: "l2", a: "p2", b: "p3" }, // does NOT reference p1 -- must survive
  ]);

  const removed = deleteGeometryObject(graph, listIds, "p1");

  assert.deepEqual(removed, new Set(["p1", "l1", "c1", "poly1"]));
  assert.deepEqual(graph.get<string[]>(listIds.objectList), ["p2", "p3", "l2"]);
  assert.equal(graph.has("geomPoint:p1"), false);
  assert.equal(graph.has("geomLine:l1"), false);
  assert.equal(graph.has("geomCircle:c1"), false);
  assert.equal(graph.has("geomPolygon:poly1"), false);
  assert.equal(graph.has("geomLine:l2"), true, "an unrelated line not referencing the deleted point survives");
});

test("deleteGeometryObject: cascades transitively through a chain of transform-produced points", () => {
  const { graph, listIds } = freshGraph();
  replayGeometryOps(graph, listIds, [
    { tool: "point", id: "p1", x: 1, y: 0 },
    { tool: "point", id: "center", x: 0, y: 0 },
    { tool: "rotation", id: "r1", source: "p1", center: "center", angleDegrees: 90 }, // references p1
    { tool: "reflection", id: "ref1", source: "r1", center: "center" }, // references r1, NOT p1 directly
  ]);

  const removed = deleteGeometryObject(graph, listIds, "p1");

  // p1 -> r1 (direct reference) -> ref1 (transitive, references r1 which is being deleted)
  assert.deepEqual(removed, new Set(["p1", "r1", "ref1"]));
  assert.deepEqual(graph.get<string[]>(listIds.objectList), ["center"]);
});

test("deleteGeometryObject: a no-op for an id that's already gone (idempotent, safe to call twice)", () => {
  const { graph, listIds } = freshGraph();
  replayGeometryOps(graph, listIds, [{ tool: "point", id: "p1", x: 0, y: 0 }]);
  deleteGeometryObject(graph, listIds, "p1");

  const removedAgain = deleteGeometryObject(graph, listIds, "p1");

  assert.deepEqual(removedAgain, new Set(["p1"]));
  assert.deepEqual(graph.get<string[]>(listIds.objectList), []);
});

test("editGeometryOps: #336 item 6's IK solve path -- updates every joint in a chain in ONE rebuild, all applied together", () => {
  const { graph, listIds } = freshGraph();
  const ops: GeometryOp[] = [
    { tool: "point", id: "base", x: 1, y: 0 },
    { tool: "point", id: "c1", x: 0, y: 0 },
    { tool: "point", id: "c2", x: 2, y: 0 },
    { tool: "rotation", id: "r1", source: "base", center: "c1", angleDegrees: 0 },
    { tool: "rotation", id: "r2", source: "r1", center: "c2", angleDegrees: 0 },
  ];
  replayGeometryOps(graph, listIds, ops);

  editGeometryOps(graph, listIds, [
    { opId: "r1", patch: { angleDegrees: 90 } },
    { opId: "r2", patch: { angleDegrees: 45 } },
  ]);

  const updated = getCurrentGeometryState(graph, listIds).ops;
  assert.equal((updated.find((op) => op.id === "r1") as { angleDegrees: number }).angleDegrees, 90);
  assert.equal((updated.find((op) => op.id === "r2") as { angleDegrees: number }).angleDegrees, 45);
  // r1: (1,0) rotated 90 degrees around (0,0) -> (0,1)
  const r1Point = graph.get<{ x: number; y: number }>("geomPoint:r1");
  assert.ok(Math.abs(r1Point.x - 0) < 1e-9 && Math.abs(r1Point.y - 1) < 1e-9);
});

test("anchor: a point pinned to a circle sits at center + radius*(cos param, sin param)", () => {
  const { graph, listIds } = freshGraph();
  replayGeometryOps(graph, listIds, [
    { tool: "point", id: "center", x: 0, y: 0 },
    { tool: "point", id: "rim", x: 2, y: 0 },
    { tool: "circle", id: "c1", center: "center", radiusPoint: "rim" }, // radius 2
    { tool: "anchor", id: "anc1", target: "c1", param: Math.PI / 2 }, // top of the circle
  ]);
  const p = graph.get<{ x: number; y: number }>("geomPoint:anc1");
  assert.ok(Math.abs(p.x - 0) < 1e-9 && Math.abs(p.y - 2) < 1e-9);
});

test("anchor: a point pinned to a line sits at a + param*(b-a)", () => {
  const { graph, listIds } = freshGraph();
  replayGeometryOps(graph, listIds, [
    { tool: "point", id: "a", x: 0, y: 0 },
    { tool: "point", id: "b", x: 10, y: 0 },
    { tool: "line", id: "l1", a: "a", b: "b" },
    { tool: "anchor", id: "anc1", target: "l1", param: 0.25 },
  ]);
  const p = graph.get<{ x: number; y: number }>("geomPoint:anc1");
  assert.ok(Math.abs(p.x - 2.5) < 1e-9 && Math.abs(p.y - 0) < 1e-9);
});

test("anchor: moving the circle's OWN defining points moves the anchored point too (live, not frozen at construction)", () => {
  const { graph, listIds } = freshGraph();
  replayGeometryOps(graph, listIds, [
    { tool: "point", id: "center", x: 0, y: 0 },
    { tool: "point", id: "rim", x: 1, y: 0 },
    { tool: "circle", id: "c1", center: "center", radiusPoint: "rim" },
    { tool: "anchor", id: "anc1", target: "c1", param: 0 }, // rightmost point, (1, 0)
  ]);
  assert.deepEqual(graph.get<{ x: number; y: number }>("geomPoint:anc1"), { x: 1, y: 0 });

  // Translate the WHOLE circle (both its defining points, by the same
  // delta) rather than just the center -- moving center alone would also
  // change the radius (it's the live distance to rim, not a fixed value),
  // which is correct circle behavior but not what this test is about.
  graph.set("geomPoint:center", { x: 5, y: 5 });
  graph.set("geomPoint:rim", { x: 6, y: 5 });

  assert.deepEqual(graph.get<{ x: number; y: number }>("geomPoint:anc1"), { x: 6, y: 5 });
});

test("editGeometryOp: re-solving an anchor's param moves it along the same circle without touching anything else", () => {
  const { graph, listIds } = freshGraph();
  replayGeometryOps(graph, listIds, [
    { tool: "point", id: "center", x: 0, y: 0 },
    { tool: "point", id: "rim", x: 1, y: 0 },
    { tool: "circle", id: "c1", center: "center", radiusPoint: "rim" },
    { tool: "anchor", id: "anc1", target: "c1", param: 0 },
  ]);

  editGeometryOp(graph, listIds, "anc1", { param: Math.PI } as Partial<GeometryOp>);

  const p = graph.get<{ x: number; y: number }>("geomPoint:anc1");
  assert.ok(Math.abs(p.x - -1) < 1e-9 && Math.abs(p.y - 0) < 1e-9);
});

test("deleteGeometryObject: deleting a circle cascades to delete every point anchored to it", () => {
  const { graph, listIds } = freshGraph();
  replayGeometryOps(graph, listIds, [
    { tool: "point", id: "center", x: 0, y: 0 },
    { tool: "point", id: "rim", x: 1, y: 0 },
    { tool: "circle", id: "c1", center: "center", radiusPoint: "rim" },
    { tool: "anchor", id: "anc1", target: "c1", param: 0 },
    { tool: "point", id: "unrelated", x: 9, y: 9 },
  ]);

  const removed = deleteGeometryObject(graph, listIds, "c1");

  assert.deepEqual(removed, new Set(["c1", "anc1"]));
  assert.equal(graph.has("geomPoint:anc1"), false);
  assert.equal(graph.has("geomPoint:unrelated"), true, "an unrelated point survives");
});

test("applyGeometryState: a subscribeAll listener (e.g. the canvas redraw) never observes objectList referencing a deleted point cell, and fires exactly once per call (#374/#375)", () => {
  const { graph, listIds } = freshGraph();
  replayGeometryOps(graph, listIds, [
    { tool: "point", id: "p1", x: 0, y: 0 },
    { tool: "point", id: "p2", x: 3, y: 4 },
    { tool: "line", id: "l1", a: "p1", b: "p2" },
    { tool: "circle", id: "c1", center: "p1", radiusPoint: "p2" },
  ]);

  let notifyCount = 0;
  const unsubscribe = graph.subscribeAll(() => {
    notifyCount++;
    // Mirror drawGeometryPanel/geometryExportLayers's own read pattern: for
    // every id still listed in objectList, if it's a line/circle, its
    // referenced point cells must exist. Before wrapping clearGeometryState
    // + replayGeometryOps in graph.transaction, a listener firing mid-clear
    // could observe objectList still listing "l1" after "geomPoint:p1" (an
    // earlier loop iteration) had already been deleted -- reproducing
    // exactly the reported "Cannot read properties of undefined" crash.
    for (const id of graph.get<string[]>(listIds.objectList)) {
      if (graph.has(`geomLine:${id}`)) {
        const { a, b } = graph.get<{ a: string; b: string }>(`geomLine:${id}`);
        assert.ok(graph.has(`geomPoint:${a}`), `line ${id} references deleted point ${a}`);
        assert.ok(graph.has(`geomPoint:${b}`), `line ${id} references deleted point ${b}`);
      } else if (graph.has(`geomCircle:${id}`)) {
        const { center, radiusPoint } = graph.get<{ center: string; radiusPoint: string }>(`geomCircle:${id}`);
        assert.ok(graph.has(`geomPoint:${center}`), `circle ${id} references deleted point ${center}`);
        assert.ok(graph.has(`geomPoint:${radiusPoint}`), `circle ${id} references deleted point ${radiusPoint}`);
      }
    }
  });

  // Restoring an EARLIER (blank) snapshot exercises the full clear (with
  // nothing to replay) -- the widest possible window for a mid-clear
  // inconsistency, since replay adds nothing back until clear fully finishes.
  applyGeometryState(graph, listIds, { v: 1, ops: [] });
  assert.equal(notifyCount, 1, "clear-and-replay-to-blank must be one logical write, not one notification per deleted cell");

  notifyCount = 0;
  applyGeometryState(graph, listIds, {
    v: 1,
    ops: [
      { tool: "point", id: "p1", x: 0, y: 0 },
      { tool: "point", id: "p2", x: 3, y: 4 },
      { tool: "line", id: "l1", a: "p1", b: "p2" },
      { tool: "circle", id: "c1", center: "p1", radiusPoint: "p2" },
    ],
  });
  assert.equal(notifyCount, 1, "clear-and-replay must be one logical write, not one notification per rebuilt cell");

  unsubscribe();
});

test("addAngle/replayGeometryOps: mode defaults to 'shorter' when omitted from the op, matching pre-mode saved states", () => {
  const { graph, listIds } = freshGraph();
  replayGeometryOps(graph, listIds, [
    { tool: "point", id: "a", x: 1, y: 0 },
    { tool: "point", id: "vertex", x: 0, y: 0 },
    { tool: "point", id: "c", x: 0, y: 1 },
    { tool: "angle", id: "ang1", a: "a", vertex: "vertex", c: "c" },
  ]);
  assert.ok(Math.abs(graph.get<number>("geomAngleValue:ang1") - Math.PI / 2) < 1e-9);
});

test("addAngle/replayGeometryOps: mode='reflex' measures the complement of the shorter angle", () => {
  const { graph, listIds } = freshGraph();
  replayGeometryOps(graph, listIds, [
    { tool: "point", id: "a", x: 1, y: 0 },
    { tool: "point", id: "vertex", x: 0, y: 0 },
    { tool: "point", id: "c", x: 0, y: 1 },
    { tool: "angle", id: "ang1", a: "a", vertex: "vertex", c: "c", mode: "reflex" },
  ]);
  assert.ok(Math.abs(graph.get<number>("geomAngleValue:ang1") - (3 * Math.PI) / 2) < 1e-9, "360 - 90 = 270 degrees");
});

test("addAngle/replayGeometryOps: mode='clickOrder' is directional -- the a/c order (not just their positions) determines the result", () => {
  const { graph, listIds } = freshGraph();
  replayGeometryOps(graph, listIds, [
    { tool: "point", id: "a", x: 1, y: 0 },
    { tool: "point", id: "vertex", x: 0, y: 0 },
    { tool: "point", id: "c", x: 0, y: 1 },
    { tool: "angle", id: "forward", a: "a", vertex: "vertex", c: "c", mode: "clickOrder" },
    { tool: "angle", id: "backward", a: "c", vertex: "vertex", c: "a", mode: "clickOrder" },
  ]);
  assert.ok(Math.abs(graph.get<number>("geomAngleValue:forward") - Math.PI / 2) < 1e-9, "VA(0deg)->VC(90deg) CCW is 90deg");
  assert.ok(Math.abs(graph.get<number>("geomAngleValue:backward") - (3 * Math.PI) / 2) < 1e-9, "VA(90deg)->VC(0deg) CCW is 270deg");
});

test("editGeometryOp: switching an existing angle's mode live-updates its measured value (a full clear-and-replay under the hood)", () => {
  const { graph, listIds } = freshGraph();
  replayGeometryOps(graph, listIds, [
    { tool: "point", id: "a", x: 1, y: 0 },
    { tool: "point", id: "vertex", x: 0, y: 0 },
    { tool: "point", id: "c", x: 0, y: 1 },
    { tool: "angle", id: "ang1", a: "a", vertex: "vertex", c: "c" },
  ]);
  assert.ok(Math.abs(graph.get<number>("geomAngleValue:ang1") - Math.PI / 2) < 1e-9, "starts as the default 'shorter' 90deg");

  editGeometryOp(graph, listIds, "ang1", { mode: "reflex" });
  assert.ok(Math.abs(graph.get<number>("geomAngleValue:ang1") - (3 * Math.PI) / 2) < 1e-9, "now reflex: 270deg");

  editGeometryOp(graph, listIds, "ang1", { mode: "shorter" });
  assert.ok(Math.abs(graph.get<number>("geomAngleValue:ang1") - Math.PI / 2) < 1e-9, "back to shorter: 90deg");
});
