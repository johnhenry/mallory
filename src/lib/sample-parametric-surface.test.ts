import assert from "node:assert/strict";
import { test } from "node:test";
import { Symbolic } from "@johnhenry/math";
import { PARAMETRIC_PRESETS, sampleParametricSurface } from "./sample-parametric-surface.ts";

test("PARAMETRIC_PRESETS: torus at (u,v)=(0,0) matches the closed-form outer-tube point (R+r, 0, 0) = (3,0,0)", () => {
  const p = PARAMETRIC_PRESETS.torus;
  assert.ok(p);
  const x = Symbolic.compile(p.exprX)({ u: 0, v: 0 });
  const y = Symbolic.compile(p.exprY)({ u: 0, v: 0 });
  const z = Symbolic.compile(p.exprZ)({ u: 0, v: 0 });
  assert.ok(Math.abs(x - 3) < 1e-9);
  assert.ok(Math.abs(y - 0) < 1e-9);
  assert.ok(Math.abs(z - 0) < 1e-9);
});

test("PARAMETRIC_PRESETS: sphere at (u,v)=(0, pi/2) (the equator) matches the closed-form point (r,0,0) = (2,0,0)", () => {
  const p = PARAMETRIC_PRESETS.sphere;
  assert.ok(p);
  const x = Symbolic.compile(p.exprX)({ u: 0, v: Math.PI / 2 });
  const y = Symbolic.compile(p.exprY)({ u: 0, v: Math.PI / 2 });
  const z = Symbolic.compile(p.exprZ)({ u: 0, v: Math.PI / 2 });
  assert.ok(Math.abs(x - 2) < 1e-9);
  assert.ok(Math.abs(y - 0) < 1e-9);
  assert.ok(Math.abs(z - 0) < 1e-9);
});

test("PARAMETRIC_PRESETS: Mobius strip at (u,v)=(0,0) matches the closed-form base-circle point (1,0,0)", () => {
  const p = PARAMETRIC_PRESETS.mobius;
  assert.ok(p);
  const x = Symbolic.compile(p.exprX)({ u: 0, v: 0 });
  const y = Symbolic.compile(p.exprY)({ u: 0, v: 0 });
  const z = Symbolic.compile(p.exprZ)({ u: 0, v: 0 });
  assert.ok(Math.abs(x - 1) < 1e-9);
  assert.ok(Math.abs(y - 0) < 1e-9);
  assert.ok(Math.abs(z - 0) < 1e-9);
});

test("sampleParametricSurface: every sampled torus vertex lies exactly the minor radius from the major-radius circle (a genuine torus, not an approximation)", () => {
  const p = PARAMETRIC_PRESETS.torus;
  assert.ok(p);
  const meshes = sampleParametricSurface(p.exprX, p.exprY, p.exprZ, p.uDomain, p.vDomain, 8);
  for (const mesh of meshes) {
    for (const face of mesh.faces) {
      for (const v of face) {
        const distFromCenterline = Math.hypot(Math.hypot(v.x, v.y) - 2, v.z);
        assert.ok(Math.abs(distFromCenterline - 1) < 1e-9, `vertex (${v.x},${v.y},${v.z}) is ${distFromCenterline} from centerline, expected 1`);
      }
    }
  }
});

test("sampleParametricSurface: produces a non-empty, fully-finite mesh for the sphere preset", () => {
  const p = PARAMETRIC_PRESETS.sphere;
  assert.ok(p);
  const meshes = sampleParametricSurface(p.exprX, p.exprY, p.exprZ, p.uDomain, p.vDomain, 10);
  let faceCount = 0;
  for (const mesh of meshes) {
    for (const face of mesh.faces) {
      faceCount++;
      for (const v of face) {
        assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z));
      }
    }
  }
  assert.ok(faceCount > 0);
});

test("sampleParametricSurface: a face touching a singular (non-finite) vertex is dropped, not left poisoning the mesh", () => {
  // x = 1/u has a pole at u=0, which sits inside [-1, 1].
  const meshes = sampleParametricSurface("1/u", "v", "0", { min: -1, max: 1 }, { min: -1, max: 1 }, 4);
  let faceCount = 0;
  for (const mesh of meshes) {
    for (const face of mesh.faces) {
      faceCount++;
      for (const v of face) assert.ok(Number.isFinite(v.x));
    }
  }
  // Some faces survive (the well-defined region away from u=0); none are poisoned.
  assert.ok(faceCount > 0);
  assert.ok(faceCount < 32); // 4x4 grid x 2 triangles/cell x 2 sweeps = 32 max faces if nothing were dropped
});

test("sampleParametricSurface: a flat plane x=u, y=v, z=0 produces a mesh whose vertices span exactly the given domain", () => {
  const meshes = sampleParametricSurface("u", "v", "0", { min: 0, max: 2 }, { min: 0, max: 3 }, 4);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const mesh of meshes) {
    for (const face of mesh.faces) {
      for (const v of face) {
        assert.equal(v.z, 0);
        minX = Math.min(minX, v.x);
        maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y);
        maxY = Math.max(maxY, v.y);
      }
    }
  }
  assert.equal(minX, 0);
  assert.equal(maxX, 2);
  assert.equal(minY, 0);
  assert.equal(maxY, 3);
});
