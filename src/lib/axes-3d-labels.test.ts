import assert from "node:assert/strict";
import { test } from "node:test";
import { setupTestDom } from "./test-dom.ts";

await setupTestDom();
const { buildAxesLabelGroup, buildSymmetricAxesHelper } = await import("./axes-3d-labels.ts");
const { CSS2DObject } = await import("three/addons/renderers/CSS2DRenderer.js");
const THREE = await import("three");

function labelsAt(group: ReturnType<typeof buildAxesLabelGroup>, x: number, y: number, z: number) {
  return group.children.filter((c) => c instanceof CSS2DObject && c.position.x === x && c.position.y === y && c.position.z === z) as InstanceType<typeof CSS2DObject>[];
}

test("buildAxesLabelGroup: extent=5, default targetTickCount=5 -- computeNiceTicks(-5,5,5) gives [-4,-2,0,2,4], hand-computed", () => {
  const group = buildAxesLabelGroup(5);
  // 4 nonzero ticks * 3 axes + 1 origin label = 13.
  assert.equal(group.children.length, 13);
});

test("buildAxesLabelGroup: the origin gets exactly one label (not one per axis), text '0'", () => {
  const group = buildAxesLabelGroup(5);
  const originLabels = labelsAt(group, 0, 0, 0);
  assert.equal(originLabels.length, 1);
  assert.equal(originLabels[0]?.element.textContent, "0");
});

test("buildAxesLabelGroup: a nonzero tick value gets 3 labels, one per axis, each colored to match THREE.AxesHelper's red/green/blue X/Y/Z convention", () => {
  const group = buildAxesLabelGroup(5);
  const xLabel = labelsAt(group, 4, 0, 0)[0];
  const yLabel = labelsAt(group, 0, 4, 0)[0];
  const zLabel = labelsAt(group, 0, 0, 4)[0];
  assert.ok(xLabel && yLabel && zLabel);
  assert.equal(xLabel.element.textContent, "4");
  assert.equal(yLabel.element.textContent, "4");
  assert.equal(zLabel.element.textContent, "4");
  assert.equal(xLabel.element.style.color, "#dc2626");
  assert.equal(yLabel.element.style.color, "#16a34a");
  assert.equal(zLabel.element.style.color, "#2563eb");
});

test("buildAxesLabelGroup: a negative tick value is labeled with its own sign, not mirrored to positive", () => {
  const group = buildAxesLabelGroup(5);
  const negXLabel = labelsAt(group, -4, 0, 0)[0];
  assert.ok(negXLabel);
  assert.equal(negXLabel.element.textContent, "-4");
});

test("buildAxesLabelGroup: a smaller extent produces fewer, tighter ticks -- extent=1 with default targetTickCount=5", () => {
  const group = buildAxesLabelGroup(1);
  // computeNiceTicks(-1,1,5): roughStep=0.4, exponent=floor(log10(0.4))=-1, magnitude=0.1,
  // residual=4, niceResidual=5 (residual>2), step=0.5, decimals=1 -> ticks [-1,-0.5,0,0.5,1].
  const originLabels = labelsAt(group, 0, 0, 0);
  const halfLabels = labelsAt(group, 0.5, 0, 0);
  const oneLabels = labelsAt(group, 1, 0, 0);
  assert.equal(originLabels.length, 1);
  assert.equal(halfLabels[0]?.element.textContent, "0.5");
  assert.equal(oneLabels[0]?.element.textContent, "1");
  assert.equal(group.children.length, 4 * 3 + 1);
});

test("buildSymmetricAxesHelper: unlike THREE.AxesHelper (origin to +extent only), each axis line spans -extent to +extent -- so every negative tick label from buildAxesLabelGroup has a line under it", () => {
  const group = buildSymmetricAxesHelper(5);
  assert.equal(group.children.length, 3, "one Line per axis");
  for (const child of group.children) {
    assert.ok(child instanceof THREE.Line);
    const positions = (child as InstanceType<typeof THREE.Line>).geometry.getAttribute("position");
    assert.equal(positions.count, 2, "a 2-point line segment");
    const from = new THREE.Vector3().fromBufferAttribute(positions, 0);
    const to = new THREE.Vector3().fromBufferAttribute(positions, 1);
    // Each axis's two endpoints are +5 and -5 along exactly one axis, 0 on the other two.
    const fromMag = Math.max(Math.abs(from.x), Math.abs(from.y), Math.abs(from.z));
    const toMag = Math.max(Math.abs(to.x), Math.abs(to.y), Math.abs(to.z));
    assert.equal(fromMag, 5);
    assert.equal(toMag, 5);
    assert.ok((from.x === -5 && to.x === 5) || (from.y === -5 && to.y === 5) || (from.z === -5 && to.z === 5), "one axis runs from -5 to +5");
  }
});
