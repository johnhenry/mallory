import type { Mesh } from "@johnhenry/math";
import assert from "node:assert/strict";
import { test } from "node:test";
import { meshToGeometry, meshToMaterial } from "./mesh-to-geometry.ts";

const SAMPLE_MESH: Mesh = {
  material: { color: 0x2563eb, alpha: 1, oneSide: false },
  faces: [
    [
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 2 },
      { x: 0, y: 1, z: 3 },
    ],
  ],
};

test("meshToGeometry emits one non-indexed position per face vertex, mapping @johnhenry/math z to Three's y-axis", () => {
  const geometry = meshToGeometry(SAMPLE_MESH);
  const position = geometry.getAttribute("position");
  assert.equal(position.count, 3);
  assert.equal(geometry.getIndex(), null);
  assert.deepEqual([...position.array.slice(0, 3)], [0, 1, 0]);
  assert.deepEqual([...position.array.slice(3, 6)], [1, 2, 0]);
  assert.deepEqual([...position.array.slice(6, 9)], [0, 3, 1]);
});

test("meshToMaterial carries color/alpha/sidedness through from the @johnhenry/math Material", () => {
  const material = meshToMaterial(SAMPLE_MESH) as import("three").MeshStandardMaterial;
  assert.equal(material.color.getHex(), 0x2563eb);
  assert.equal(material.opacity, 1);
  assert.equal(material.transparent, false);
});
