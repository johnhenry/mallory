import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { layerColor3D } from "./CellularAutomataPanel.tsx";

test("layerColor3D: the same (z, depth) pair always produces the same color", () => {
  assert.equal(layerColor3D(2, 5).getHexString(), layerColor3D(2, 5).getHexString());
});

test("layerColor3D: different Z layers usually produce different colors (spot check, not a hash-collision guarantee)", () => {
  assert.notEqual(layerColor3D(0, 5).getHexString(), layerColor3D(4, 5).getHexString());
});

test("layerColor3D: a single-layer frame (depth <= 1) doesn't divide by zero -- hue pins to 0", () => {
  assert.equal(layerColor3D(0, 1).getHexString(), new THREE.Color("hsl(0, 65%, 55%)").getHexString());
});
