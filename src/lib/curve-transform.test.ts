import assert from "node:assert/strict";
import { test } from "node:test";
import type { Path2D } from "mallory-math";
import { derivativeCurve, integralCurve } from "./curve-transform.ts";

/** A minimal fake Path2D -- only `commands` is read by curve-transform.ts, so `stroke` is a throwaway placeholder. */
function fakePath(points: Array<{ x: number; y: number; move?: boolean }>): Path2D {
  return {
    stroke: { color: 0, alpha: 1, thickness: 1 },
    commands: points.map((p, i) => ({ op: i === 0 || p.move ? "moveTo" : "lineTo", x: p.x, y: p.y })),
  } as Path2D;
}

test("derivativeCurve: a straight line y=2x has constant slope 2 at each pair's midpoint, hand-computed", () => {
  const path = fakePath([
    { x: 0, y: 0 },
    { x: 1, y: 2 },
    { x: 2, y: 4 },
  ]);
  assert.deepEqual(derivativeCurve(path), [
    [
      { x: 0.5, y: 2 },
      { x: 1.5, y: 2 },
    ],
  ]);
});

test("derivativeCurve: a gap (second moveTo) splits into two independently-differentiated runs", () => {
  const path = fakePath([
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    { x: 5, y: 5, move: true },
    { x: 6, y: 7 },
  ]);
  assert.deepEqual(derivativeCurve(path), [[{ x: 0.5, y: 1 }], [{ x: 5.5, y: 2 }]]);
});

test("derivativeCurve: a vertical jump (dx=0) is skipped rather than dividing by zero", () => {
  const path = fakePath([
    { x: 0, y: 0 },
    { x: 0, y: 5 },
  ]);
  assert.deepEqual(derivativeCurve(path), [[]]);
});

test("integralCurve: a straight line y=2x integrates to y=x^2 (starting at 0), hand-computed against the closed form", () => {
  const path = fakePath([
    { x: 0, y: 0 },
    { x: 1, y: 2 },
    { x: 2, y: 4 },
  ]);
  assert.deepEqual(integralCurve(path), [
    [
      { x: 0, y: 0 },
      { x: 1, y: 1 }, // integral of 2x from 0 to 1 = 1^2 = 1
      { x: 2, y: 4 }, // integral of 2x from 0 to 2 = 2^2 = 4
    ],
  ]);
});

test("integralCurve: a single-point run (no pairs) produces just its own (x, 0) starting point", () => {
  const path = fakePath([{ x: 3, y: 7 }]);
  assert.deepEqual(integralCurve(path), [[{ x: 3, y: 0 }]]);
});

test("integralCurve: a gap splits into two independently-integrated runs, each restarting from 0", () => {
  const path = fakePath([
    { x: 0, y: 1 },
    { x: 1, y: 1 }, // constant y=1 -> area 1
    { x: 10, y: 2, move: true },
    { x: 12, y: 2 }, // constant y=2 over width 2 -> area 4
  ]);
  assert.deepEqual(integralCurve(path), [
    [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
    [
      { x: 10, y: 0 },
      { x: 12, y: 4 },
    ],
  ]);
});
