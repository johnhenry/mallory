import assert from "node:assert/strict";
import { test } from "node:test";
import { constant, nn, optim, variable } from "@johnhenry/math-plus-tensor-autograd";
import { Tensor } from "@johnhenry/math-plus-tensor-core";
import { hasSink, metric } from "@johnhenry/math-plus-telemetry";
import {
  MAX_CLASSES,
  TinyMlp,
  datasetToBatch,
  generateDataset,
  inferNumClasses,
  installMetricSink,
  predictClassGrid,
  predictProbabilityGrid,
  trainModel,
  type LabeledPoint,
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

test('generateDataset: "drawn" always returns an empty array, regardless of pointsPerClass/seed -- its points come from user clicks (a separate cell), not procedural generation', () => {
  assert.deepEqual(generateDataset("drawn", 30, 9), []);
  assert.deepEqual(generateDataset("drawn", 1, 1, 0), []);
});

test('generateDataset: "csv" always returns an empty array, regardless of pointsPerClass/seed -- its points come from an imported CSV column (a separate cell, issue #253), not procedural generation', () => {
  assert.deepEqual(generateDataset("csv", 30, 9), []);
  assert.deepEqual(generateDataset("csv", 1, 1, 0), []);
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

test("trainModel: rejects a non-positive schedule step size and a non-positive gamma", async () => {
  const model = new TinyMlp(4, 1);
  const points = generateDataset("xor", 5, 1);
  await assert.rejects(() => trainModel(model, points, 0.05, 10, { stepSize: 0, gamma: 0.5 }), /Schedule step size/);
  await assert.rejects(() => trainModel(model, points, 0.05, 10, { stepSize: 5, gamma: 0 }), /Schedule gamma/);
});

test("trainModel: a StepLR schedule produces a lossHistory of exactly `epochs` entries (one per single-epoch fit() chunk, none lost or duplicated)", async () => {
  const model = new TinyMlp(6, 3);
  const points = generateDataset("moons", 10, 2);
  const result = await trainModel(model, points, 0.1, 12, { stepSize: 4, gamma: 0.5 });
  assert.equal(result.lossHistory.length, 12);
});

test("trainModel: with a schedule, same seeds give an identical lossHistory (still fully deterministic)", async () => {
  const run = async () => {
    const model = new TinyMlp(6, 7);
    return (await trainModel(model, generateDataset("moons", 15, 3), 0.05, 20, { stepSize: 5, gamma: 0.5 })).lossHistory;
  };
  assert.deepEqual(await run(), await run());
});

test("trainModel: a StepLR schedule matches a hand-rolled reference loop bit-for-bit -- same optimizer instance reused across chunks (Adam's momentum state persists), scheduler.step() once per epoch, exactly mirroring trainer.js's own step() (model.zeroGrad -> variable(x)/constant(y) -> forward -> loss -> backward -> optimizer.step) plus scheduler.step() after", async () => {
  const points = generateDataset("moons", 10, 4);
  const { x, y } = datasetToBatch(points);
  const schedule = { stepSize: 4, gamma: 0.5 };

  const modelA = new TinyMlp(6, 11);
  const resultA = await trainModel(modelA, points, 0.1, 12, schedule);

  const modelB = new TinyMlp(6, 11);
  const optimizer = new optim.Adam(modelB.parameters(), { lr: 0.1 });
  const scheduler = new optim.StepLR(optimizer, schedule);
  const lossHistoryB: number[] = [];
  for (let epoch = 0; epoch < 12; epoch++) {
    modelB.zeroGrad();
    const prediction = modelB.forward(variable(x));
    const loss = nn.binaryCrossEntropy(prediction, constant(y));
    loss.backward();
    optimizer.step();
    scheduler.step();
    lossHistoryB.push(loss.value.item() as number);
  }

  assert.deepEqual(resultA.lossHistory, lossHistoryB);
});

test("trainModel: onEpoch fires exactly once per epoch, in order, with the epoch index and that epoch's own loss value", async () => {
  const model = new TinyMlp(4, 5);
  const points = generateDataset("moons", 8, 6);
  const events: { epoch: number; loss: number }[] = [];
  const result = await trainModel(model, points, 0.05, 6, undefined, (event) => {
    events.push(event);
  });
  assert.equal(events.length, 6);
  assert.deepEqual(
    events.map((e) => e.epoch),
    [0, 1, 2, 3, 4, 5],
  );
  assert.deepEqual(
    events.map((e) => e.loss),
    result.lossHistory,
  );
});

test("trainModel: onEpoch does not change training results -- with or without it, same seeds give the exact same lossHistory (chunking for observation is numerically transparent)", async () => {
  const withoutObserver = async () => {
    const model = new TinyMlp(6, 9);
    return (await trainModel(model, generateDataset("moons", 12, 8), 0.05, 10)).lossHistory;
  };
  const withObserver = async () => {
    const model = new TinyMlp(6, 9);
    return (await trainModel(model, generateDataset("moons", 12, 8), 0.05, 10, undefined, () => {})).lossHistory;
  };
  assert.deepEqual(await withoutObserver(), await withObserver());
});

test("trainModel: an async onEpoch is awaited before the next epoch starts -- a callback that appends to a shared log sees strictly increasing epoch numbers with no interleaving", async () => {
  const model = new TinyMlp(4, 13);
  const points = generateDataset("xor", 6, 14);
  const log: number[] = [];
  await trainModel(model, points, 0.05, 5, undefined, async (event) => {
    await new Promise((resolve) => setTimeout(resolve, 1));
    log.push(event.epoch);
  });
  assert.deepEqual(log, [0, 1, 2, 3, 4]);
});

test("installMetricSink: forwards a matching-runId metric event's name and value to onMetric", () => {
  const received: { name: string; value: number }[] = [];
  const uninstall = installMetricSink("run-a", (name, value) => received.push({ name, value }));
  try {
    metric("run-a", 0, "loss", 0.42);
    metric("run-a", 1, "loss", 0.31);
  } finally {
    uninstall();
  }
  assert.deepEqual(received, [
    { name: "loss", value: 0.42 },
    { name: "loss", value: 0.31 },
  ]);
});

test("installMetricSink: ignores metric events from a DIFFERENT runId -- the scoping that keeps two concurrent panel instances' telemetry from cross-contaminating", () => {
  const received: { name: string; value: number }[] = [];
  const uninstall = installMetricSink("run-a", (name, value) => received.push({ name, value }));
  try {
    metric("run-b", 0, "loss", 0.99); // different runId -- must be ignored
    metric("run-a", 0, "loss", 0.5); // matching runId -- must be forwarded
  } finally {
    uninstall();
  }
  assert.deepEqual(received, [{ name: "loss", value: 0.5 }]);
});

test("installMetricSink: the returned uninstall function removes the sink -- hasSink() is false afterward, and a subsequent metric() call reaches nothing", () => {
  const uninstall = installMetricSink("run-c", () => {
    throw new Error("must not be called after uninstall");
  });
  assert.equal(hasSink(), true);
  uninstall();
  assert.equal(hasSink(), false);
  metric("run-c", 0, "loss", 1); // no sink installed -- must not throw, must not call the (throwing) handler
});

test("predictProbabilityGrid: values are sigmoid(logit), hand-computed against known weights (not raw logits)", async () => {
  const { Tensor } = await import("@johnhenry/math-plus-tensor-core");
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

test("TinyMlp: rejects an out-of-[0,1) dropout rate", () => {
  assert.throws(() => new TinyMlp(4, 1, -0.1), /Dropout rate/);
  assert.throws(() => new TinyMlp(4, 1, 1), /Dropout rate/);
});

test("TinyMlp: defaults to training mode; dropout rate 0 (the default) never touches the forward pass regardless of mode", async () => {
  const { Tensor } = await import("@johnhenry/math-plus-tensor-core");
  const model = new TinyMlp(4, 1);
  assert.equal(model.training, true);
  const input = variable(Tensor.from([1, -1], { dtype: "f64" }).reshape([1, 2]));
  const trainingOutput = model.forward(input).value.at(0, 0);
  model.eval();
  assert.equal(model.training, false);
  const evalOutput = model.forward(input).value.at(0, 0);
  assert.equal(trainingOutput, evalOutput);
});

test("TinyMlp.forward: eval mode always matches the plain (dropout-free) computation; training mode with a large dropout rate almost never does", async () => {
  const { Tensor } = await import("@johnhenry/math-plus-tensor-core");
  // hidden=20 so a stochastic dropout mask coincidentally reproducing the
  // all-kept mask (the only way training-mode output could equal eval-mode
  // output) has probability 0.5^20 ~= 1e-6 -- negligible flake risk.
  const model = new TinyMlp(20, 3, 0.5);
  const l1Weight = model.l1.weight.value;
  const l1Bias = model.l1.bias!.value;
  const l2Weight = model.l2.weight.value;
  const l2Bias = model.l2.bias!.value;
  const input = variable(Tensor.from([0.7, -0.3], { dtype: "f64" }).reshape([1, 2]));

  // Plain computation with no dropout layer at all -- the ground truth eval-mode should match exactly.
  // nn.Linear.forward is x.matmul(weight).add(bias) with weight shape [inFeatures, outFeatures].
  const plainHidden = input.matmul(variable(l1Weight)).add(variable(l1Bias)).relu();
  const plainOutput = plainHidden.matmul(variable(l2Weight)).add(variable(l2Bias)).value.at(0, 0);

  model.eval();
  const evalOutput = model.forward(input).value.at(0, 0);
  assert.ok(Math.abs((evalOutput as number) - (plainOutput as number)) < 1e-9, "eval mode must exactly match the dropout-free computation");

  model.train();
  const trainingOutput = model.forward(input).value.at(0, 0);
  assert.notEqual(trainingOutput, plainOutput, "training mode with p=0.5 across 20 units should not coincidentally match the all-kept case");
});

test("predictProbabilityGrid: switches the model to eval mode for inference and restores the prior training flag afterward", () => {
  const model = new TinyMlp(4, 1, 0.5);
  model.training = true;
  predictProbabilityGrid(model, { min: -2, max: 2 }, 3);
  assert.equal(model.training, true, "predictProbabilityGrid must restore the model's training flag, not leave it in eval mode");
});

test("nn.binaryCrossEntropy stays finite (~0) for saturated correct logits (regression: this used to NaN, see math-plus#85)", () => {
  // mallory-tensor-autograd's own binaryCrossEntropy used to NaN here --
  // this repo carried a local stableBinaryCrossEntropy workaround until the
  // fix landed upstream (math-plus#85, pulled in via mallory-tensor-
  // autograd 0.2.2). Kept as a regression guard on the published fix.
  const z = variable(Tensor.from([50, -50], { dtype: "f64" }).reshape([2, 1]));
  const y = variable(Tensor.from([1, 0], { dtype: "f64" }).reshape([2, 1]));
  const loss = nn.binaryCrossEntropy(z, y).value.item() as number;
  assert.ok(Number.isFinite(loss) && loss < 1e-12, `expected ~0, got ${loss}`);
});

// -- Issue #253: multi-class (more than 2 labels) support --------------------

/** Three tightly-clustered, well-separated classes -- exact fixed points (no RNG) so grid predictions at each center are unambiguous. */
function threeClassPoints(): LabeledPoint[] {
  const centers: Array<[number, number, number]> = [
    [-2, -2, 0],
    [2, -2, 1],
    [0, 2, 2],
  ];
  const points: LabeledPoint[] = [];
  for (const [cx, cy, label] of centers) {
    for (let i = 0; i < 10; i++) {
      points.push({ x: cx + ((i % 5) - 2) * 0.03, y: cy + (Math.floor(i / 5) - 0.5) * 0.03, label });
    }
  }
  return points;
}

test("inferNumClasses: empty or binary-only points give 2; the max label present (0-indexed) plus one otherwise", () => {
  assert.equal(inferNumClasses([]), 2);
  assert.equal(inferNumClasses([{ x: 0, y: 0, label: 0 }]), 2);
  assert.equal(inferNumClasses([{ x: 0, y: 0, label: 1 }]), 2);
  assert.equal(inferNumClasses(threeClassPoints()), 3);
  assert.equal(inferNumClasses([{ x: 0, y: 0, label: 7 }]), 8);
});

test("TinyMlp: rejects a numClasses below 2, non-integer, or above MAX_CLASSES", () => {
  assert.throws(() => new TinyMlp(4, 1, 0, 1), /Number of classes/);
  assert.throws(() => new TinyMlp(4, 1, 0, 1.5), /Number of classes/);
  assert.throws(() => new TinyMlp(4, 1, 0, MAX_CLASSES + 1), /Number of classes/);
});

test("TinyMlp: numClasses defaults to 2 -- the output layer stays width 1, matching the pre-#253 architecture bit-for-bit", () => {
  const model = new TinyMlp(4, 1);
  assert.equal(model.numClasses, 2);
  assert.deepEqual(model.l2.weight.value.shape, [4, 1]);
});

test("TinyMlp: numClasses=5 widens the output layer to 5 logits", () => {
  const model = new TinyMlp(4, 1, 0, 5);
  assert.equal(model.numClasses, 5);
  assert.deepEqual(model.l2.weight.value.shape, [4, 5]);
  const input = variable(Tensor.from([0.3, -0.1], { dtype: "f64" }).reshape([1, 2]));
  assert.deepEqual(model.forward(input).value.shape, [1, 5]);
});

test("datasetToBatch: numClasses=2 (default, unchanged) gives y shape [N,1]; numClasses>2 gives y shape [N] of integer labels", () => {
  const points = threeClassPoints();
  const binary = datasetToBatch(points);
  assert.deepEqual(binary.y.shape, [points.length, 1]);
  const multi = datasetToBatch(points, 3);
  assert.deepEqual(multi.y.shape, [points.length]);
  assert.deepEqual([...multi.y.toArray()].map(Number), points.map((p) => p.label));
});

test("trainModel: learns a well-separated 3-class dataset -- loss drops and predictClassGrid recovers each cluster's own label at its center", async () => {
  const points = threeClassPoints();
  const model = new TinyMlp(8, 42, 0, 3);
  const result = await trainModel(model, points, 0.1, 300);
  assert.equal(result.lossHistory.length, 300);
  assert.ok(result.lossHistory[0]! > result.lossHistory[299]!, "loss should decrease");
  assert.ok(result.lossHistory[299]! < 0.2, `final loss ${result.lossHistory[299]}`);

  const grid = predictClassGrid(model, { min: -3, max: 3 }, 13); // x,y in {-3,-2.5,...,3}; -2/2/0 land exactly on grid points
  const at = (x: number, y: number) => {
    const i = Math.round(((x + 3) / 6) * 12);
    const j = Math.round(((y + 3) / 6) * 12);
    return grid[j]![i]!;
  };
  assert.equal(at(-2, -2), 0, "cluster 0's own center should classify as class 0");
  assert.equal(at(2, -2), 1, "cluster 1's own center should classify as class 1");
  assert.equal(at(0, 2), 2, "cluster 2's own center should classify as class 2");
});

test("trainModel: a 3-class model is fully deterministic -- same seeds give an identical lossHistory", async () => {
  const run = async () => {
    const model = new TinyMlp(6, 7, 0, 3);
    return (await trainModel(model, threeClassPoints(), 0.05, 30)).lossHistory;
  };
  assert.deepEqual(await run(), await run());
});

test("predictProbabilityGrid: rejects a model built with more than 2 classes", () => {
  const model = new TinyMlp(4, 1, 0, 3);
  assert.throws(() => predictProbabilityGrid(model, { min: -2, max: 2 }, 3), /binary/);
});

test("predictClassGrid: rejects a binary (numClasses===2, the default) model", () => {
  const model = new TinyMlp(4, 1);
  assert.throws(() => predictClassGrid(model, { min: -2, max: 2 }, 3), /3 or more classes/);
});

test("predictClassGrid: every value is a valid class index, shape resolution x resolution", () => {
  const model = new TinyMlp(4, 1, 0, 4);
  const grid = predictClassGrid(model, { min: -2, max: 2 }, 10);
  assert.equal(grid.length, 10);
  for (const row of grid) {
    assert.equal(row.length, 10);
    for (const c of row) {
      assert.ok(Number.isInteger(c) && c >= 0 && c < 4);
    }
  }
});

test("predictClassGrid: switches the model to eval mode for inference and restores the prior training flag afterward", () => {
  const model = new TinyMlp(4, 1, 0.5, 3);
  model.training = true;
  predictClassGrid(model, { min: -2, max: 2 }, 3);
  assert.equal(model.training, true, "predictClassGrid must restore the model's training flag, not leave it in eval mode");
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
