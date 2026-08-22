import assert from "node:assert/strict";
import { test } from "node:test";
import { triOrientation } from "@johnhenry/math";
import { triCenterX, triCorners, triEdgeSegment } from "./tri-geometry.ts";

test("triCorners: an 'up' cell has its apex at top-center, base at the bottom corners", () => {
  const corners = triCorners(2, 3, 10, 8, "up");
  assert.equal(corners.length, 3);
  const [bl, br, apex] = corners as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
  const cx = triCenterX(2, 10);
  assert.deepEqual(bl, { x: cx - 5, y: 32 });
  assert.deepEqual(br, { x: cx + 5, y: 32 });
  assert.deepEqual(apex, { x: cx, y: 24 });
});

test("triCorners: a 'down' cell has its apex at bottom-center, base at the top corners", () => {
  const corners = triCorners(2, 3, 10, 8, "down");
  const [tl, tr, apex] = corners as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
  const cx = triCenterX(2, 10);
  assert.deepEqual(tl, { x: cx - 5, y: 24 });
  assert.deepEqual(tr, { x: cx + 5, y: 24 });
  assert.deepEqual(apex, { x: cx, y: 32 });
});

/** Two points are "the same edge endpoint" if they land on the same pixel. */
function sameEdge(a: readonly [{ x: number; y: number }, { x: number; y: number }], b: readonly [{ x: number; y: number }, { x: number; y: number }]): boolean {
  const eq = (p: { x: number; y: number }, q: { x: number; y: number }) => p.x === q.x && p.y === q.y;
  return (eq(a[0], b[0]) && eq(a[1], b[1])) || (eq(a[0], b[1]) && eq(a[1], b[0]));
}

test("triCorners: right neighbor (x+1, y) shares a REAL pixel edge (not just a touching bounding box)", () => {
  for (const [x, y] of [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 5],
  ]) {
    const orientation = triOrientation(x, y);
    const rightOrientation = triOrientation(x + 1, y);
    const a = triCorners(x, y, 10, 8, orientation);
    const b = triCorners(x + 1, y, 10, 8, rightOrientation);
    // The shared edge is each triangle's apex plus its near base-corner --
    // for an "up" cell that's its right base corner; for "down" its right
    // base corner too (both are the corner closest to x+1).
    const aRightEdge: [{ x: number; y: number }, { x: number; y: number }] = orientation === "up" ? [a[1]!, a[2]!] : [a[1]!, a[2]!];
    const bLeftEdge: [{ x: number; y: number }, { x: number; y: number }] = rightOrientation === "up" ? [b[0]!, b[2]!] : [b[0]!, b[2]!];
    assert.ok(sameEdge(aRightEdge, bLeftEdge), `(${x},${y}) and (${x + 1},${y}) don't share a pixel edge`);
  }
});

test("triEdgeSegment: an 'up' cell's 'right' edge coincides with its right neighbor's 'left' edge", () => {
  const up = triCorners(0, 0, 10, 8, "up");
  const down = triCorners(1, 0, 10, 8, "down");
  const [a1, a2] = triEdgeSegment(up, "right");
  const [b1, b2] = triEdgeSegment(down, "left");
  const eq = (p: { x: number; y: number }, q: { x: number; y: number }) => p.x === q.x && p.y === q.y;
  assert.ok((eq(a1, b1) && eq(a2, b2)) || (eq(a1, b2) && eq(a2, b1)));
});

test("triEdgeSegment: an 'up' cell's 'top' edge (its base) coincides with its top neighbor's 'bottom' edge", () => {
  const up = triCorners(0, 0, 10, 8, "up");
  const down = triCorners(0, 1, 10, 8, "down");
  const [a1, a2] = triEdgeSegment(up, "top");
  const [b1, b2] = triEdgeSegment(down, "bottom");
  const eq = (p: { x: number; y: number }, q: { x: number; y: number }) => p.x === q.x && p.y === q.y;
  assert.ok((eq(a1, b1) && eq(a2, b2)) || (eq(a1, b2) && eq(a2, b1)));
});

test("triCorners: an 'up' cell's top neighbor (x, y+1) -- always 'down' by parity -- shares its base as a REAL pixel edge (mallory-math's own triNeighbor: only 'up' cells have a 'top' direction, pointing to (x,y+1))", () => {
  for (const [x, y] of [
    [0, 0],
    [2, 0],
    [1, 1],
    [3, 5],
  ]) {
    assert.equal(triOrientation(x, y), "up", "test fixture must be an 'up' cell");
    const a = triCorners(x, y, 10, 8, "up");
    const b = triCorners(x, y + 1, 10, 8, "down");
    // The base is the two non-apex corners -- for "up" that's [0,1]
    // (bottom), for "down" also [0,1] (top).
    const aBase: [{ x: number; y: number }, { x: number; y: number }] = [a[0]!, a[1]!];
    const bBase: [{ x: number; y: number }, { x: number; y: number }] = [b[0]!, b[1]!];
    assert.ok(sameEdge(aBase, bBase), `(${x},${y})'s base doesn't coincide with (${x},${y + 1})'s base`);
  }
});
