import assert from "node:assert/strict";
import { test } from "node:test";
import { triCorners } from "./tri-geometry.ts";

test("triCorners: an 'up' cell has its apex at top-center of the bounding box, base at the bottom corners", () => {
  const corners = triCorners(2, 3, 10, 8, "up");
  assert.equal(corners.length, 3);
  const [bl, br, apex] = corners as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
  assert.deepEqual(bl, { x: 20, y: 32 });
  assert.deepEqual(br, { x: 30, y: 32 });
  assert.deepEqual(apex, { x: 25, y: 24 });
});

test("triCorners: a 'down' cell has its apex at bottom-center of the bounding box, base at the top corners", () => {
  const corners = triCorners(2, 3, 10, 8, "down");
  const [tl, tr, apex] = corners as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
  assert.deepEqual(tl, { x: 20, y: 24 });
  assert.deepEqual(tr, { x: 30, y: 24 });
  assert.deepEqual(apex, { x: 25, y: 32 });
});

test("triCorners: adjacent cells (x, x+1) in the same row have touching bounding boxes (no gap, no overlap)", () => {
  const a = triCorners(0, 0, 10, 8, "up");
  const b = triCorners(1, 0, 10, 8, "down");
  const aRightEdgeX = Math.max(...a.map((p) => p.x));
  const bLeftEdgeX = Math.min(...b.map((p) => p.x));
  assert.equal(aRightEdgeX, bLeftEdgeX);
});
