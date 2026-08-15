import assert from "node:assert/strict";
import { test } from "node:test";
import { nn, variable } from "mallory-tensor-autograd";
import { Tensor } from "mallory-tensor-core";
import {
  TinyMlp,
  datasetToBatch,
  generateDataset,
  predictProbabilityGrid,
  stableBinaryCrossEntropy,
  trainModel,
} from "./ml-playground.ts";

test("generateDataset: XOR at noise 0 is exactly the four cluster centers with label = XOR of the center signs", () => {
  const points = generateDataset("xor", 4, 1, 0);
  assert.equal(points.length, 8);
  for (const p of points) {
    assert.ok(Math.abs(Math.abs(p.x) - 1.5) < 1e-12);
    assert.ok(Math.abs(Math.abs(p.y) - 1.5) < 1e-12);
    const expectedLabel = p.x * p.y < 0 ? 1 : 0;
    assert.equal(p.label, expectedLabel);
  }
});

test("generateDataset: rings at noise 0 keeps every class-0 point strictly closer to the origin than every class-1 point", () => {
  const points = generateDataset("rings", 25, 3, 0);
  const maxInner = Math.max(...points.filter((p) => p.label === 0).map((p) => Math.hypot(p.x, p.y)));
  const minOuter = Math.min(...points.filter((p) => p.label === 1).map((p) => Math.hypot(p.x, p.y)));
  assert.ok(maxInner < minOuter, `inner max ${maxInner} should be < outer min ${minOuter}`);
});

test("generateDataset: labels are exactly balanced and every point is finite, for all three datasets", () => {
  for (const type of ["xor", "moons", "rings"] as const) {
    const points = generateDataset(type, 30, 9);
    assert.equal(points.filter((p) => p.label === 0).length, 30, type);
    assert.equal(points.filter((p) => p.label === 1).length, 30, type);
    for (const p of points) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  }
});

test("generateDataset: the same seed reproduces the exact same points; a different seed does not", () => {
  const a = generateDataset("moons", 20, 11);
  const b = generateDataset("moons", 20, 11);
  const c = generateDataset("moons", 20, 12);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test("generateDataset: rejects a non-positive or over-cap points count", () => {
  assert.throws(() => generateDataset("xor", 0, 1), /positive integer/);
  assert.throws(() => generateDataset("xor", 501, 1), /positive integer/);
});

test("datasetToBatch: shapes are [N,2] and [N,1], values in point order", () => {
  const { x, y } = datasetToBatch([
    { x: 1, y: 2, label: 0 },
    { x: 3, y: 4, label: 1 },
  ]);
  assert.deepEqual(x.shape, [2, 2]);
  assert.deepEqual(y.shape, [2, 1]);
  assert.equal(x.at(0, 0), 1);
  assert.equal(x.at(1, 1), 4);
  assert.equal(y.at(1, 0), 1);
});

test("trainModel: learns XOR (loss drops below 0.01 and all four noise-0 corners classify correctly)", async () => {
  const model = new TinyMlp(8, 42);
  const points = generateDataset("xor", 20, 5);
  const result = await trainModel(model, points, 0.05, 300);
  assert.equal(result.lossHistory.length, 300);
  assert.ok(result.lossHistory[0]! > result.lossHistory[299]!);
  assert.ok(result.lossHistory[299]! < 0.01, `final loss ${result.lossHistory[299]}`);
  const grid = predictProbabilityGrid(model, { min: -3, max: 3 }, 21);
  // Grid row 0 is y=min. Corners: (-3,-3) same-sign -> label 0 (low P), (3,-3) mixed-sign -> label 1 (high P).
  assert.ok(grid[0]![0]! < 0.2, `P(-3,-3)=${grid[0]![0]}`);
  assert.ok(grid[0]![20]! > 0.8, `P(3,-3)=${grid[0]![20]}`);
  assert.ok(grid[20]![0]! > 0.8, `P(-3,3)=${grid[20]![0]}`);
  assert.ok(grid[20]![20]! < 0.2, `P(3,3)=${grid[20]![20]}`);
});

test("trainModel: fully deterministic -- same seeds give an identical lossHistory", async () => {
  const run = async () => {
    const model = new TinyMlp(6, 7);
    return (await trainModel(model, generateDataset("moons", 15, 3), 0.05, 50)).lossHistory;
  };
  assert.deepEqual(await run(), await run());
});

test("trainModel: continuing training on the same model keeps improving from where it left off", async () => {
  const model = new TinyMlp(8, 42);
  const points = generateDataset("xor", 20, 5);
  const first = await trainModel(model, points, 0.05, 50);
  const second = await trainModel(model, points, 0.05, 50);
  // The second run starts near where the first ended, far below the first run's start.
  assert.ok(second.lossHistory[0]! < first.lossHistory[0]! / 2);
});

test("trainModel: rejects an empty dataset, non-positive lr, and an out-of-range epoch count", async () => {
  const model = new TinyMlp(4, 1);
  await assert.rejects(() => trainModel(model, [], 0.05, 10), /Dataset is empty/);
  await assert.rejects(() => trainModel(model, generateDataset("xor", 5, 1), 0, 10), /Learning rate/);
  await assert.rejects(() => trainModel(model, generateDataset("xor", 5, 1), 0.05, 5000), /Epochs/);
});

test("predictProbabilityGrid: values are sigmoid(logit), hand-computed against known weights (not raw logits)", async () => {
  const { Tensor } = await import("mallory-tensor-core");
  // hidden=1, weights hand-set so logit(x, y) = relu(x): l1 = identity on x,
  // l2 = identity. At grid corner x=2 the logit is 2, so the value MUST be
  // sigmoid(2) ~= 0.8808 -- a raw logit of 2 fails this (caught a real
  // surviving mutation: dropping .sigmoid() passed every other test).
  const model = new TinyMlp(1, 1);
  model.loadStateDict({
    "l1.weight": Tensor.from([1, 0], { dtype: "f64" }).reshape([2, 1]),
    "l1.bias": Tensor.from([0], { dtype: "f64" }),
    "l2.weight": Tensor.from([1], { dtype: "f64" }).reshape([1, 1]),
    "l2.bias": Tensor.from([0], { dtype: "f64" }),
  });
  const grid = predictProbabilityGrid(model, { min: -2, max: 2 }, 3); // x values: -2, 0, 2
  const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
  assert.ok(Math.abs(grid[0]![2]! - sigmoid(2)) < 1e-9, `expected sigmoid(2)=${sigmoid(2)}, got ${grid[0]![2]}`);
  assert.ok(Math.abs(grid[0]![0]! - sigmoid(0)) < 1e-9, `relu(-2)=0 -> sigmoid(0)=0.5, got ${grid[0]![0]}`);
});

test("predictProbabilityGrid: every value is a probability in [0,1], shape resolution x resolution", () => {
  const model = new TinyMlp(4, 1);
  const grid = predictProbabilityGrid(model, { min: -2, max: 2 }, 10);
  assert.equal(grid.length, 10);
  for (const row of grid) {
    assert.equal(row.length, 10);
    for (const p of row) assert.ok(p >= 0 && p <= 1);
  }
});

test("TinyMlp: rejects a non-positive or over-cap hidden size", () => {
  assert.throws(() => new TinyMlp(0, 1), /Hidden units/);
  assert.throws(() => new TinyMlp(100, 1), /Hidden units/);
});

test("stableBinaryCrossEntropy: matches nn.binaryCrossEntropy to 1e-12 in the non-saturated regime", () => {
  const z = variable(Tensor.from([0.5, -1.2, 2.0, -0.3], { dtype: "f64" }).reshape([4, 1]));
  const y = variable(Tensor.from([1, 0, 1, 0], { dtype: "f64" }).reshape([4, 1]));
  const stable = stableBinaryCrossEntropy(z, y).value.item() as number;
  const upstream = nn.binaryCrossEntropy(z, y).value.item() as number;
  assert.ok(Math.abs(stable - upstream) < 1e-12, `stable=${stable} upstream=${upstream}`);
});

test("stableBinaryCrossEntropy: stays finite (~0) for saturated correct logits, exactly where the upstream NaNs", () => {
  const z = variable(Tensor.from([50, -50], { dtype: "f64" }).reshape([2, 1]));
  const y = variable(Tensor.from([1, 0], { dtype: "f64" }).reshape([2, 1]));
  const stable = stableBinaryCrossEntropy(z, y).value.item() as number;
  assert.ok(Number.isFinite(stable) && stable < 1e-12, `expected ~0, got ${stable}`);
  // Document the upstream behavior this guards against -- if this ever
  // starts passing, the upstream bug is fixed and the workaround can go.
  assert.ok(Number.isNaN(nn.binaryCrossEntropy(z, y).value.item() as number), "upstream no longer NaNs -- retire stableBinaryCrossEntropy");
});

test("trainModel: continuing training well past convergence never NaNs (regression for the saturated-sigmoid loss bug)", async () => {
  // The exact discovery repro: moons seed 7, model seed 42, 200 epochs then
  // 200 more -- upstream binaryCrossEntropy NaN'd at continued-epoch ~49.
  const model = new TinyMlp(8, 42);
  const points = generateDataset("moons", 60, 7);
  const first = await trainModel(model, points, 0.05, 200);
  const second = await trainModel(model, points, 0.05, 200);
  assert.ok([...first.lossHistory, ...second.lossHistory].every(Number.isFinite));
  assert.ok(second.lossHistory[199]! < first.lossHistory[199]!);
});
