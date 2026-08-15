import assert from "node:assert/strict";
import { test } from "node:test";
import { sampleVectorField3D } from "./sample-vector-field-3d.ts";

test("sampleVectorField3D: gridDensity^3 points for a field with no non-finite values", () => {
  const points = sampleVectorField3D("-y", "x", "0.2*z", { min: -1, max: 1 }, { min: -1, max: 1 }, { min: -1, max: 1 }, 3);
  assert.equal(points.length, 27);
});

test("sampleVectorField3D: hand-computed (dx,dy,dz) at a specific grid corner", () => {
  const points = sampleVectorField3D("-y", "x", "0.2*z", { min: -1, max: 1 }, { min: -1, max: 1 }, { min: -1, max: 1 }, 3);
  const corner = points.find((p) => p.x === 1 && p.y === -1 && p.z === 1);
  assert.ok(corner, "expected a sample at x=1,y=-1,z=1");
  // dx=-y=-(-1)=1, dy=x=1, dz=0.2*1=0.2
  assert.equal(corner!.dx, 1);
  assert.equal(corner!.dy, 1);
  assert.ok(Math.abs(corner!.dz - 0.2) < 1e-12, `dz: ${corner!.dz}`);
});

test("sampleVectorField3D: grid coordinates span exactly the requested domain at density 2 (endpoints only)", () => {
  const points = sampleVectorField3D("0", "0", "0", { min: -3, max: 3 }, { min: 0, max: 10 }, { min: -1, max: 1 }, 2);
  const xs = new Set(points.map((p) => p.x));
  const ys = new Set(points.map((p) => p.y));
  const zs = new Set(points.map((p) => p.z));
  assert.deepEqual([...xs].sort((a, b) => a - b), [-3, 3]);
  assert.deepEqual([...ys].sort((a, b) => a - b), [0, 10]);
  assert.deepEqual([...zs].sort((a, b) => a - b), [-1, 1]);
});

test("sampleVectorField3D: a non-finite component (division by zero at the origin) is dropped, not left as NaN/Infinity", () => {
  // 1/x blows up at x=0, which is in-domain for a symmetric [-1,1] range.
  const points = sampleVectorField3D("1/x", "0", "0", { min: -1, max: 1 }, { min: -1, max: 1 }, { min: -1, max: 1 }, 3);
  assert.ok(points.every((p) => Number.isFinite(p.dx)));
  // Density 3 over [-1,1] means x=0 is the middle grid line (3 y * 3 z = 9 points dropped).
  assert.equal(points.length, 27 - 9);
});

test("sampleVectorField3D: the zero field produces zero vectors everywhere (not filtered -- 0 is finite)", () => {
  const points = sampleVectorField3D("0", "0", "0", { min: -1, max: 1 }, { min: -1, max: 1 }, { min: -1, max: 1 }, 2);
  assert.equal(points.length, 8);
  assert.ok(points.every((p) => p.dx === 0 && p.dy === 0 && p.dz === 0));
});
