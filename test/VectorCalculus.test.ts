import assert from "node:assert/strict";
import { test } from "node:test";
import { DualNumber } from "../src/DualNumber.ts";
import { VectorCalculus } from "../src/VectorCalculus.ts";

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

// f(x, y) = x^2*y + y^3  =>  grad = (2xy, x^2 + 3y^2)
const f = (xs: DualNumber[]) =>
  (xs[0] as DualNumber)
    .pow(2)
    .multiply(xs[1] as DualNumber)
    .add((xs[1] as DualNumber).pow(3));

test("VectorCalculus.gradient matches the hand-computed partials", () => {
  const [gx, gy] = VectorCalculus.gradient(f, [1, 2]);
  assert.ok(close(gx as number, 4)); // 2*1*2
  assert.ok(close(gy as number, 13)); // 1 + 3*4
});

test("VectorCalculus.directionalDerivative projects the gradient onto a unit direction", () => {
  // grad = (4, 13); direction (3,4) normalizes to (0.6, 0.8) -> 4*0.6 + 13*0.8 = 12.8
  const d = VectorCalculus.directionalDerivative(f, [1, 2], [3, 4]);
  assert.ok(close(d, 12.8));
  assert.throws(() => VectorCalculus.directionalDerivative(f, [1, 2], [0, 0]));
});

test("VectorCalculus.jacobian of F(x,y) = [x^2*y, x + y^2]", () => {
  const F = (xs: DualNumber[]) => [
    (xs[0] as DualNumber).pow(2).multiply(xs[1] as DualNumber),
    (xs[0] as DualNumber).add((xs[1] as DualNumber).pow(2)),
  ];
  const J = VectorCalculus.jacobian(F, [1, 2]);
  assert.deepEqual(
    J.map((row) => row.map((x) => Math.round(x * 1e9) / 1e9)),
    [
      [4, 1],
      [1, 4],
    ],
  );
});

test("VectorCalculus.divergence of F(x,y) = [x^2, y^3] at (1,2)", () => {
  const F = (xs: DualNumber[]) => [(xs[0] as DualNumber).pow(2), (xs[1] as DualNumber).pow(3)];
  const div = VectorCalculus.divergence(F, [1, 2]);
  assert.ok(close(div, 14)); // 2*1 + 3*4
});

test("VectorCalculus.curl3D of the rotational field F(x,y,z) = (-y, x, 0) is (0,0,2)", () => {
  const F = (xs: DualNumber[]) => [(xs[1] as DualNumber).negate(), xs[0] as DualNumber, DualNumber.constant(0)];
  const [cx, cy, cz] = VectorCalculus.curl3D(F, [0, 0, 0]);
  assert.ok(close(cx as number, 0) && close(cy as number, 0) && close(cz as number, 2));
});

test("VectorCalculus.hessian of x^2*y at (1,2) matches [[2y,2x],[2x,0]]", () => {
  const g = (xs: DualNumber[]) => (xs[0] as DualNumber).pow(2).multiply(xs[1] as DualNumber);
  const H = VectorCalculus.hessian(g, [1, 2]);
  assert.ok(close(H[0]?.[0] as number, 4, 1e-3)); // 2y
  assert.ok(close(H[0]?.[1] as number, 2, 1e-3)); // 2x
  assert.ok(close(H[1]?.[0] as number, 2, 1e-3)); // 2x
  assert.ok(close(H[1]?.[1] as number, 0, 1e-3)); // 0
});

test("VectorCalculus.symbolicGradient matches DualNumber.gradient exactly", () => {
  const [gx, gy] = VectorCalculus.symbolicGradient("x^2*y + y^3", ["x", "y"], { x: 1, y: 2 });
  assert.equal(gx, 4);
  assert.equal(gy, 13);
});
