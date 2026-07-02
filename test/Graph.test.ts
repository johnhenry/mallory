import assert from "node:assert/strict";
import { test } from "node:test";
import { Graph3DUtils } from "../src/Graph3DUtils.ts";
import { GraphUtils } from "../src/GraphUtils.ts";
import { Polygon } from "../src/Polygon.ts";
import { Vector } from "../src/Vector.ts";

const pt = (...xs: number[]) => Vector.fromArray(xs);
const mat = <T>(rows: T[][]) => Vector.fromArray(rows.map((r) => Vector.fromArray(r)));

test("singleRangeVector samples a function", () => {
  const ys = GraphUtils.singleRangeVector((x) => x * x, 0, 3, 1);
  assert.deepEqual([...ys], [0, 1, 4, 9]);
});

test("placement descriptor with scale from z", () => {
  const p = GraphUtils.placement(pt(2, 3, 4)) as { x: number; y: number; scaleX: number };
  assert.equal(p.x, 2);
  assert.equal(p.y, 3);
  assert.equal(p.scaleX, 4);
  const noZ = GraphUtils.placement(pt(1, 1)) as { scaleX: number };
  assert.equal(noZ.scaleX, 1, "z=0 leaves scale at 1");
});

test("barPlacement flips negative bars", () => {
  const p = GraphUtils.barPlacement(pt(5, -3), 20);
  assert.equal(p.width, 20);
  assert.equal(p.height, -3);
  assert.equal(p.scaleY, -1);
});

test("vectorToCurve emits moveTo then lineTo commands", () => {
  const path = GraphUtils.vectorToCurve(
    mat([
      [0, 0],
      [1, 2],
      [3, 4],
    ]),
  );
  assert.equal(path.commands.length, 3);
  assert.deepEqual(path.commands[0], { op: "moveTo", x: 0, y: 0 });
  assert.deepEqual(path.commands[2], { op: "lineTo", x: 3, y: 4 });
});

test("polygonToCurve is a closed filled path", () => {
  const poly = new Polygon(pt(0, 0), pt(2, 0), pt(2, 2), pt(0, 2));
  const path = GraphUtils.polygonToCurve(poly);
  assert.ok(path.fill);
  assert.equal(path.commands[0]?.op, "moveTo");
  assert.equal(path.commands.length, poly.edgeCount + 1);
});

test("dualRangeVector builds a grid", () => {
  const grid = Graph3DUtils.dualRangeVector((x, y) => x + y, 0, 2, 1, 0, 2, 1);
  assert.equal(grid.length, 3);
  assert.deepEqual([...(grid[0] as Vector<number>)], [0, 1, 2]);
  assert.deepEqual([...(grid[2] as Vector<number>)], [2, 3, 4]);
});

test("nRangeVector works in N dimensions (bug fix) without mutating inputs", () => {
  const mins = [0, 0];
  const maxes = [1, 1];
  const steps = [1, 1];
  const grid = Graph3DUtils.nRangeVector((coords) => coords.reduce((a, b) => a + b, 0), mins, maxes, steps);
  // 2x2 grid of coordinate sums
  assert.deepEqual([...(grid[0] as Vector<number>)], [0, 1]);
  assert.deepEqual([...(grid[1] as Vector<number>)], [1, 2]);
  assert.deepEqual(mins, [0, 0], "inputs untouched");
});

test("polygonToMesh3D fan-triangulates", () => {
  const poly = new Polygon(pt(0, 0, 0), pt(1, 0, 0), pt(1, 1, 0), pt(0, 1, 0));
  const mesh = Graph3DUtils.polygonToMesh3D(poly, 0xff0000, 1);
  assert.equal(mesh.faces.length, 2, "quad -> 2 triangles");
  assert.equal(mesh.material.color, 0xff0000);
  assert.equal(mesh.faces[0]?.length, 3);
});

test("create3DPrism produces a 12-face tube", () => {
  const mesh = Graph3DUtils.create3DPrism(pt(0, 0, 0), pt(1, 0, 0));
  assert.equal(mesh.faces.length, 12);
});

test("pointMatrixToMesh3D uses alpha1 for the first sweep (bug fix)", () => {
  const grid = mat([
    [pt(0, 0, 0), pt(0, 1, 0)],
    [pt(1, 0, 1), pt(1, 1, 1)],
  ]);
  const meshes = Graph3DUtils.pointMatrixToMesh3D(grid, 0x111111, 0.25, 0x222222, 0.75);
  assert.equal(meshes.length, 2);
  assert.equal(meshes[0]?.material.alpha, 0.25, "first sweep uses alpha1");
  assert.equal(meshes[1]?.material.alpha, 0.75);
  assert.ok((meshes[0]?.faces.length ?? 0) >= 1);
});
