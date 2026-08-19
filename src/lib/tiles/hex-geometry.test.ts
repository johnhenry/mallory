import assert from "node:assert/strict";
import { test } from "node:test";
import { HEX_AXIAL_DIRECTIONS, hexNeighbor } from "mallory-math";
import { hexCenter, hexCorners, hexEdgeSegment } from "./hex-geometry.ts";

test("hexCenter: direction 0 (E) neighbor offset is pure +x, hand-computed", () => {
  const origin = hexCenter(0, 0, 10);
  const east = hexCenter(1, 0, 10);
  assert.ok(Math.abs(east.x - origin.x - 10 * Math.sqrt(3)) < 1e-9);
  assert.ok(Math.abs(east.y - origin.y) < 1e-9, "E is a pure horizontal move");
});

test("hexCenter: direction 3 (W) neighbor offset is pure -x", () => {
  const origin = hexCenter(0, 0, 10);
  const west = hexCenter(-1, 0, 10);
  assert.ok(Math.abs(west.x - origin.x + 10 * Math.sqrt(3)) < 1e-9);
  assert.ok(Math.abs(west.y - origin.y) < 1e-9);
});

test("hexCenter: NE (dq=1,dr=-1) moves +x and -y (up-right); SW (dq=-1,dr=1) moves -x and +y (down-left)", () => {
  const origin = hexCenter(0, 0, 10);
  const ne = hexCenter(1, -1, 10);
  const sw = hexCenter(-1, 1, 10);
  assert.ok(ne.x > origin.x && ne.y < origin.y, "NE: +x, -y (up-right on a y-down canvas)");
  assert.ok(sw.x < origin.x && sw.y > origin.y, "SW: -x, +y (down-left)");
});

test("hexCenter: NW (dq=0,dr=-1) moves -x and -y; SE (dq=0,dr=1) moves +x and +y", () => {
  const origin = hexCenter(0, 0, 10);
  const nw = hexCenter(0, -1, 10);
  const se = hexCenter(0, 1, 10);
  assert.ok(nw.x < origin.x && nw.y < origin.y, "NW: -x, -y");
  assert.ok(se.x > origin.x && se.y > origin.y, "SE: +x, +y");
});

test("hexCorners: all 6 corners are exactly `size` away from the center (a regular hexagon)", () => {
  const corners = hexCorners(50, 60, 12);
  assert.equal(corners.length, 6);
  for (const c of corners) {
    const dist = Math.hypot(c.x - 50, c.y - 60);
    assert.ok(Math.abs(dist - 12) < 1e-9, `corner at distance ${dist}, expected 12`);
  }
});

test("hexCorners: consecutive corners are spaced exactly 60 degrees apart", () => {
  const corners = hexCorners(0, 0, 10);
  for (let i = 0; i < 6; i++) {
    const a = corners[i]!;
    const b = corners[(i + 1) % 6]!;
    const angleA = Math.atan2(a.y, a.x);
    const angleB = Math.atan2(b.y, b.x);
    let delta = angleB - angleA;
    if (delta < 0) delta += 2 * Math.PI;
    assert.ok(Math.abs(delta - Math.PI / 3) < 1e-9, `expected 60deg (pi/3), got ${(delta * 180) / Math.PI}deg`);
  }
});

test("hexEdgeSegment: direction d's edge from a hex coincides pixel-exactly with direction (d+3)%6's edge from its direction-d neighbor", () => {
  const size = 12;
  for (let d = 0; d < HEX_AXIAL_DIRECTIONS.length; d++) {
    const origin = hexCenter(0, 0, size);
    const [nq, nr] = hexNeighbor(0, 0, d as 0 | 1 | 2 | 3 | 4 | 5);
    const neighborCenter = hexCenter(nq, nr, size);
    const originCorners = hexCorners(origin.x, origin.y, size);
    const neighborCorners = hexCorners(neighborCenter.x, neighborCenter.y, size);
    const [a1, a2] = hexEdgeSegment(originCorners, d);
    const [b1, b2] = hexEdgeSegment(neighborCorners, (d + 3) % 6);
    const close = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9;
    const matches = (close(a1, b1) && close(a2, b2)) || (close(a1, b2) && close(a2, b1));
    assert.ok(matches, `direction ${d}'s edge doesn't coincide with its neighbor's (d+3)%6=${(d + 3) % 6} edge`);
  }
});

test("hexCorners: pointy-top orientation has a vertex directly above the center (smallest y), not a flat edge", () => {
  const corners = hexCorners(0, 0, 10);
  const minY = Math.min(...corners.map((c) => c.y));
  const atTop = corners.filter((c) => Math.abs(c.y - minY) < 1e-9);
  assert.equal(atTop.length, 1, "exactly one vertex at the topmost point, not two (which would mean a flat top edge)");
  assert.ok(Math.abs(atTop[0]!.x) < 1e-9, "that vertex is directly above the center (x=0)");
});
