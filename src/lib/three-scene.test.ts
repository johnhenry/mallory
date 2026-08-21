/**
 * Unit tests for three-scene.ts's pure parts: the axis-convention
 * adapters (the Omnigraph plan's top correctness risk -- see
 * toThreePoint's own doc-comment table) and disposeGroup. createThreeScene
 * itself needs a live WebGL context, which the test environment doesn't
 * have -- same policy as every existing 3D panel (samplers and pure
 * helpers get tests, GL setup doesn't).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { disposeGroup, planePointToThree, toThreePoint } from "./three-scene.ts";

test("toThreePoint: mallory (x, y, z-height) maps to Three (x, height-up, y-depth) -- the same swap meshToGeometry performs for surface meshes", () => {
  const v = toThreePoint({ x: 1, y: 2, z: 3 });
  assert.equal(v.x, 1);
  assert.equal(v.y, 3, "mallory height (z) becomes Three's y-up");
  assert.equal(v.z, 2, "mallory y becomes Three's z-depth");
});

test("planePointToThree: a 2D point (x, y) lands flat on the ground plane at (x, 0, y) -- exactly where a surface evaluated at that (x, y) sits in the plane", () => {
  const v = planePointToThree({ x: 4, y: -1.5 });
  assert.equal(v.x, 4);
  assert.equal(v.y, 0);
  assert.equal(v.z, -1.5);
});

test("toThreePoint and planePointToThree agree: a mallory point at height 0 and its 2D shadow land on the same Three point", () => {
  const from3D = toThreePoint({ x: 2, y: 7, z: 0 });
  const from2D = planePointToThree({ x: 2, y: 7 });
  assert.deepEqual([from3D.x, from3D.y, from3D.z], [from2D.x, from2D.y, from2D.z]);
});

test("disposeGroup: removes all children and disposes their geometry/material, including nested ones", () => {
  const group = new THREE.Group();
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.MeshBasicMaterial();
  let geometryDisposed = false;
  let materialDisposed = false;
  geometry.addEventListener("dispose", () => {
    geometryDisposed = true;
  });
  material.addEventListener("dispose", () => {
    materialDisposed = true;
  });
  const inner = new THREE.Group();
  inner.add(new THREE.Mesh(geometry, material));
  group.add(inner);

  disposeGroup(group);
  assert.equal(group.children.length, 0);
  assert.equal(geometryDisposed, true, "nested mesh geometry disposed");
  assert.equal(materialDisposed, true, "nested mesh material disposed");
});
