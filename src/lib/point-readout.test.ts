import assert from "node:assert/strict";
import { test } from "node:test";
import { sampleExpr } from "./sample-function.ts";
import { findNearestPointOnRows } from "./point-readout.ts";
import { toScreenX, toScreenY, type Viewport } from "./viewport.ts";

const VIEWPORT: Viewport = { xMin: -5, xMax: 5, yMin: -5, yMax: 5 };
const WIDTH = 500;
const HEIGHT = 500;

function candidates() {
  return [
    { rowId: "a", path: sampleExpr("x", { min: -5, max: 5 }, 400), color: 0x2563eb },
    { rowId: "b", path: sampleExpr("-x", { min: -5, max: 5 }, 400), color: 0xdc2626 },
  ];
}

test("findNearestPointOnRows: a click near row a's curve (y=x) selects row a, not row b", () => {
  const sx = toScreenX(2, VIEWPORT, WIDTH);
  const sy = toScreenY(2, VIEWPORT, HEIGHT); // on y=x at (2,2)
  const result = findNearestPointOnRows(candidates(), sx, sy, VIEWPORT, WIDTH, HEIGHT);
  assert.ok(result);
  assert.equal(result!.rowId, "a");
  assert.ok(Math.abs(result!.x - 2) < 0.1, `x: ${result!.x}`);
  assert.ok(Math.abs(result!.y - 2) < 0.1, `y: ${result!.y}`);
  assert.equal(result!.color, 0x2563eb);
});

test("findNearestPointOnRows: a click near row b's curve (y=-x) selects row b, not row a", () => {
  const sx = toScreenX(2, VIEWPORT, WIDTH);
  const sy = toScreenY(-2, VIEWPORT, HEIGHT); // on y=-x at (2,-2)
  const result = findNearestPointOnRows(candidates(), sx, sy, VIEWPORT, WIDTH, HEIGHT);
  assert.ok(result);
  assert.equal(result!.rowId, "b");
  assert.ok(Math.abs(result!.x - 2) < 0.1, `x: ${result!.x}`);
  assert.ok(Math.abs(result!.y - -2) < 0.1, `y: ${result!.y}`);
});

test("findNearestPointOnRows: near the curves' intersection (origin), either row is an equally valid nearest match", () => {
  const sx = toScreenX(0, VIEWPORT, WIDTH);
  const sy = toScreenY(0, VIEWPORT, HEIGHT);
  const result = findNearestPointOnRows(candidates(), sx, sy, VIEWPORT, WIDTH, HEIGHT);
  assert.ok(result);
  assert.ok(["a", "b"].includes(result!.rowId));
  assert.ok(Math.abs(result!.x) < 0.1);
  assert.ok(Math.abs(result!.y) < 0.1);
});

test("findNearestPointOnRows: a click far from every curve returns null instead of snapping to a distant point", () => {
  // (0, 4.9) is near the top of the viewport; both y=x and y=-x pass through
  // y=0 there, so the perpendicular distance to either line is ~3.46 data
  // units (~173px at this viewport/canvas scale) -- well past the threshold.
  const sx = toScreenX(0, VIEWPORT, WIDTH);
  const sy = toScreenY(4.9, VIEWPORT, HEIGHT);
  const result = findNearestPointOnRows(candidates(), sx, sy, VIEWPORT, WIDTH, HEIGHT);
  assert.equal(result, null);
});

test("findNearestPointOnRows: an empty candidate list returns null", () => {
  const result = findNearestPointOnRows([], 250, 250, VIEWPORT, WIDTH, HEIGHT);
  assert.equal(result, null);
});

test("findNearestPointOnRows: the maxScreenDistance threshold is respected exactly (a point just outside it is rejected)", () => {
  // A flat (constant) curve so a purely vertical screen offset IS the exact
  // perpendicular distance to the nearest sampled point -- unlike a diagonal
  // curve (e.g. y=x), where a vertical offset is foreshortened by sqrt(2).
  const flat = [{ rowId: "a", path: sampleExpr("2", { min: -5, max: 5 }, 400), color: 0x2563eb }];
  const sx = toScreenX(0, VIEWPORT, WIDTH);
  const sy = toScreenY(2, VIEWPORT, HEIGHT);
  const tooFar = findNearestPointOnRows(flat, sx, sy + 21, VIEWPORT, WIDTH, HEIGHT);
  assert.equal(tooFar, null);
  const justInside = findNearestPointOnRows(flat, sx, sy + 19, VIEWPORT, WIDTH, HEIGHT);
  assert.ok(justInside);
});
