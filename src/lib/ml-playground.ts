import { nn, optim, trainer, variable } from "mallory-tensor-autograd";
import { Rng, Tensor } from "mallory-tensor-core";
import { setSink, type TrainingEvent } from "mallory-telemetry";

export type DatasetType = "xor" | "moons" | "rings" | "drawn" | "csv";

/**
 * `label` was `0 | 1` before issue #253's multi-class support -- widened to
 * a plain non-negative integer class index (0-indexed, contiguous: a
 * dataset with `numClasses` classes uses labels `0..numClasses-1`).
 * `inferNumClasses` below derives the model's output width from whatever
 * labels are actually present; `xor`/`moons`/`rings` still only ever
 * produce 0/1 (unchanged), so nothing about the existing binary path
 * changes shape -- only `"drawn"` (now supporting more than 2 label
 * buttons) and `"csv"` (labels come from an imported column, issue #253)
 * can produce a label above 1.
 */
export interface LabeledPoint {
  x: number;
  y: number;
  label: number;
}

/**
 * Issue #253's multi-class cap: an 8-color categorical palette (see
 * MlPlaygroundPanel.tsx's CLASS_COLORS) bounds how many distinct classes a
 * "drawn" or "csv" dataset can usefully render/train -- both the drawn-
 * points UI and the CSV import handoff (DataImportPanel.tsx) enforce this
 * same cap so a model never needs more output units than the app can ever
 * actually construct.
 */
export const MAX_CLASSES = 8;

/**
 * The number of classes a model should be built with for a given points
 * array: 1 + the largest label present (0-indexed, contiguous), clamped to
 * at least 2 (a model always has at least a binary decision to make, even
 * before any points exist -- e.g. a freshly-selected "csv"/"drawn" dataset
 * with zero points yet). Does NOT validate the upper bound -- callers that
 * construct labels themselves (the "drawn" UI, CSV import) are responsible
 * for keeping every label below `MAX_CLASSES`; `TinyMlp`'s own constructor
 * is what actually enforces the cap.
 */
export function inferNumClasses(points: readonly LabeledPoint[]): number {
  let max = 0;
  for (const p of points) if (p.label > max) max = p.label;
  return Math.max(2, Math.floor(max) + 1);
}

/** Box-Muller from two seeded uniforms -- deterministic gaussian noise without needing a tensor-shaped sampler for a handful of scalar draws. */
function gaussian(rng: Rng): number {
  const u1 = Math.max(rng.nextFloat(), 1e-12);
  const u2 = rng.nextFloat();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Seeded toy datasets (issue #34's XOR / two-moons, plus a rings set):
 * `pointsPerClass` points per label, deterministic for a given seed via
 * tensor-core's `Rng` (the same PCG32 the Monte Carlo panel already uses).
 * `noise` is the gaussian jitter's standard deviation -- 0 gives exactly
 * the underlying geometry (the tests pin that: XOR's four cluster centers,
 * rings' strict radius separation).
 *
 * `"drawn"` and `"csv"` are deliberately NOT procedurally generated here --
 * both always return an empty array. `"drawn"`'s points come from user
 * clicks on the panel's own canvas (issue #34's "user-drawn points as a
 * dataset source"), held in a separate `mlDrawnPoints` cell; `"csv"`'s
 * points come from DataImportPanel's CSV-to-ML handoff (issue #253), held
 * in `mlCsvPoints`. The panel's `points` cell reads from the matching cell
 * directly when `dataset` selects either, bypassing this function
 * entirely. Both cases still exist explicitly (not a `default`) so this
 * switch stays exhaustive over `DatasetType`.
 */
export function generateDataset(type: DatasetType, pointsPerClass: number, seed: number, noise = 0.25): LabeledPoint[] {
  if (!Number.isInteger(pointsPerClass) || pointsPerClass <= 0 || pointsPerClass > 500) {
    throw new Error("Points per class must be a positive integer up to 500.");
  }
  const rng = new Rng(seed);
  const points: LabeledPoint[] = [];
  switch (type) {
    case "xor": {
      // Four gaussian clusters at (±1.5, ±1.5); label = XOR of the center signs.
      const centers: Array<[number, number, 0 | 1]> = [
        [1.5, 1.5, 0],
        [-1.5, -1.5, 0],
        [1.5, -1.5, 1],
        [-1.5, 1.5, 1],
      ];
      // pointsPerClass per LABEL -- each label owns two clusters, alternated.
      for (let i = 0; i < pointsPerClass * 2; i++) {
        const [cx, cy, label] = centers[i % 4]!;
        points.push({ x: cx + gaussian(rng) * noise, y: cy + gaussian(rng) * noise, label });
      }
      break;
    }
    case "moons": {
      for (let i = 0; i < pointsPerClass; i++) {
        const t = (i / Math.max(1, pointsPerClass - 1)) * Math.PI;
        points.push({ x: 2 * Math.cos(t) - 1 + gaussian(rng) * noise, y: 2 * Math.sin(t) - 0.5 + gaussian(rng) * noise, label: 0 });
        points.push({ x: 2 - 2 * Math.cos(t) - 1 + gaussian(rng) * noise, y: 0.5 - 2 * Math.sin(t) + 0.5 + gaussian(rng) * noise, label: 1 });
      }
      break;
    }
    case "rings": {
      for (let i = 0; i < pointsPerClass; i++) {
        const theta0 = rng.nextFloat() * 2 * Math.PI;
        const r0 = 0.7 * Math.sqrt(rng.nextFloat());
        points.push({ x: r0 * Math.cos(theta0) + gaussian(rng) * noise * 0.3, y: r0 * Math.sin(theta0) + gaussian(rng) * noise * 0.3, label: 0 });
        const theta1 = rng.nextFloat() * 2 * Math.PI;
        const r1 = 2 + rng.nextFloat() * 0.4;
        points.push({ x: r1 * Math.cos(theta1) + gaussian(rng) * noise * 0.3, y: r1 * Math.sin(theta1) + gaussian(rng) * noise * 0.3, label: 1 });
      }
      break;
    }
    case "drawn": {
      break;
    }
    case "csv": {
      break;
    }
  }
  return points;
}

/**
 * A 2 -> hidden -> (1 or numClasses) MLP with a ReLU between -- composed
 * from two `nn.Linear` layers as a `Module` subclass, since the published
 * nn namespace has no activation *Module* for `Sequential` to chain (ReLU
 * exists as a `Variable` method, applied functionally in `forward`).
 * `Module.parameters()`'s reflection walk finds both layers' weights.
 * Seeded init via `Linear`'s own `rng` option, so training is fully
 * deterministic end to end.
 *
 * `dropoutRate` (default 0, i.e. off) inserts an `nn.Dropout` between the
 * ReLU and the output layer. `trainer.fit`'s `step()` calls
 * `model.forward(variable(x))` with a single argument (see trainer.js), so
 * there's no channel to pass a per-call training flag through -- instead
 * this follows the standard `Module.training` attribute convention
 * (`nn.Dropout.forward` itself takes an explicit `training` bool), toggled
 * via `train()`/`eval()`. Defaults to training mode; `predictProbabilityGrid`
 * switches to eval mode for inference so dropout doesn't corrupt the
 * decision boundary it renders.
 *
 * `numClasses` (issue #253, default 2) sizes the output layer: exactly 2
 * classes keeps the ORIGINAL single-logit-plus-sigmoid architecture
 * unchanged (output width 1 -- every pre-#253 test's `loadStateDict`
 * shapes and hand-computed values still hold bit-for-bit), while 3+
 * classes widens the output layer to `numClasses` logits, trained via
 * `trainModel`'s softmax cross-entropy path instead of binary
 * cross-entropy. `predictProbabilityGrid` only supports the binary
 * (numClasses===2) shape; `predictClassGrid` is the 3+-class equivalent.
 */
export class TinyMlp extends nn.Module {
  readonly l1: InstanceType<typeof nn.Linear>;
  readonly l2: InstanceType<typeof nn.Linear>;
  readonly dropout: InstanceType<typeof nn.Dropout>;
  readonly numClasses: number;
  training = true;

  constructor(hidden: number, seed: number, dropoutRate = 0, numClasses = 2) {
    super();
    if (!Number.isInteger(hidden) || hidden <= 0 || hidden > 64) throw new Error("Hidden units must be a positive integer up to 64.");
    if (!Number.isFinite(dropoutRate) || dropoutRate < 0 || dropoutRate >= 1) throw new Error("Dropout rate must be a number in [0, 1).");
    if (!Number.isInteger(numClasses) || numClasses < 2 || numClasses > MAX_CLASSES) {
      throw new Error(`Number of classes must be an integer in [2, ${MAX_CLASSES}].`);
    }
    const rng = new Rng(seed);
    this.l1 = new nn.Linear(2, hidden, { rng });
    this.l2 = new nn.Linear(hidden, numClasses === 2 ? 1 : numClasses, { rng });
    this.dropout = new nn.Dropout(dropoutRate);
    this.numClasses = numClasses;
  }

  train(): void {
    this.training = true;
  }

  eval(): void {
    this.training = false;
  }

  forward(x: ReturnType<typeof variable>): ReturnType<typeof variable> {
    return this.l2.forward(this.dropout.forward(this.l1.forward(x).relu(), this.training));
  }
}

/**
 * `numClasses` (default 2, matching `TinyMlp`'s own default) shapes `y`
 * to match whichever loss function `trainModel` picks: `[N, 1]` of raw
 * 0/1 labels for `nn.binaryCrossEntropy` (numClasses===2, UNCHANGED from
 * pre-#253 -- every existing caller passing no third argument gets the
 * exact same tensor as before), or `[N]` of integer class indices for
 * `nn.crossEntropy` (numClasses>2, matching its own "shape `[batch]`"
 * contract).
 */
export function datasetToBatch(points: readonly LabeledPoint[], numClasses = 2): { x: Tensor; y: Tensor } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of points) {
    xs.push(p.x, p.y);
    ys.push(p.label);
  }
  const yShape = numClasses === 2 ? [points.length, 1] : [points.length];
  return {
    x: Tensor.from(xs, { dtype: "f64" }).reshape([points.length, 2]),
    y: Tensor.from(ys, { dtype: "f64" }).reshape(yShape),
  };
}

export interface TrainResult {
  /** One loss value per epoch, in order (trainer.fit's own lossHistory) -- binary cross-entropy for a 2-class model, softmax cross-entropy for 3+ classes (issue #253). */
  lossHistory: number[];
}

/**
 * Issue #34 item 2's "novel part": installs a `mallory-telemetry` sink
 * scoped to `runId`, forwarding every `"metric"` event whose `runId`
 * matches to `onMetric(name, value)` -- `setSink` is global/single-
 * installed (not per-call), so a `runId` filter is what keeps one
 * MlPlaygroundPanel instance's training run from writing into a
 * DIFFERENT instance's cells if two happen to be mounted at once.
 * Returns an uninstall function (`setSink(null)`) the caller MUST call
 * once the run finishes, in a `finally` block -- an installed sink left
 * in place after its run ends would silently swallow (or worse,
 * misattribute) telemetry from whatever runs next.
 */
export function installMetricSink(runId: string, onMetric: (name: string, value: number) => void): () => void {
  setSink((event: TrainingEvent) => {
    if (event.runId !== runId || event.type !== "metric") return;
    onMetric(event.name, event.value);
  });
  return () => setSink(null);
}

const MAX_EPOCHS = 2000;

/**
 * Full-batch training via the family's own `trainer.fit` (issue #34's
 * intended integration, not a bespoke loop): Adam + `binaryCrossEntropy` on
 * logits, `epochs` steps over the whole dataset. Mutates `model`'s weights
 * in place -- callers keep the model across calls to continue training.
 *
 * An optional `schedule` wraps the optimizer in `optim.StepLR` (issue #34's
 * remaining "StepLR exposure" item, mirroring `gradient-descent.ts`'s own
 * StepLR wiring). `trainer.configure({...epochs}).fit({x,y})` has no hook
 * to call `scheduler.step()` BETWEEN its internal `epochs`-many
 * `optimizer.step()` calls -- it's one synchronous batch, not a
 * per-iteration loop the caller can interleave with. So a scheduled run
 * calls `fit()` once per SINGLE epoch instead, `scheduler.step()`'d after
 * each -- the exact same "optimizer.step(); scheduler.step();"
 * per-iteration convention `gradient-descent.ts` already established,
 * just spread across `epochs` separate `fit()` calls rather than one. The
 * SAME `optimizer` instance is reused across every call (constructed once,
 * outside the loop), so Adam's per-parameter momentum/second-moment state
 * persists correctly across chunks -- only `optimizer.lr` (StepLR's own
 * target) changes between calls, verified empirically against the real
 * installed package: `stepSize=3, gamma=0.5` produces the lr sequence
 * `[1,1,1,0.5,0.5,0.5,0.25,0.25,0.25,0.125]` over 10 `.step()` calls,
 * matching `StepLR`'s own documented `initialLr * gamma^floor(n/stepSize)`
 * contract exactly.
 */
export interface EpochEvent {
  epoch: number;
  loss: number;
}

/**
 * Issue #34 item 2's prerequisite: an optional per-epoch observer. Passing
 * one (regardless of `schedule`) switches to the same one-`fit()`-call-per-
 * epoch chunking `schedule` already required (#156) -- calling `fit()` N
 * times with `epochs:1` each, reusing the same `optimizer` instance, is
 * numerically identical to one `fit()` call with `epochs:N` (each internal
 * `step()` does the exact same zeroGrad/forward/backward/optimizer.step
 * regardless of which `Trainer` instance issued it), so this doesn't change
 * training results -- only how often the caller gets to observe/yield. The
 * caller decides what "observe" means (a synchronous callback keeps this
 * function's own fast path; an async one that itself awaits a
 * `requestAnimationFrame`-style yield turns each epoch into a real
 * mid-training checkpoint an agent or the UI can read a live cell during --
 * see MlPlaygroundPanel.tsx's `onEpoch`, which does exactly that via
 * `mallory-telemetry`'s `metric()`/`setSink` handshake, issue #34's own
 * "novel part").
 */
export async function trainModel(
  model: TinyMlp,
  points: readonly LabeledPoint[],
  lr: number,
  epochs: number,
  schedule?: { stepSize: number; gamma: number },
  onEpoch?: (event: EpochEvent) => void | Promise<void>,
): Promise<TrainResult> {
  if (points.length === 0) throw new Error("Dataset is empty.");
  if (!Number.isFinite(lr) || lr <= 0) throw new Error("Learning rate must be a positive number.");
  if (!Number.isInteger(epochs) || epochs <= 0 || epochs > MAX_EPOCHS) throw new Error(`Epochs must be a positive integer up to ${MAX_EPOCHS}.`);
  if (schedule) {
    if (!Number.isInteger(schedule.stepSize) || schedule.stepSize <= 0) throw new Error("Schedule step size must be a positive integer.");
    if (!Number.isFinite(schedule.gamma) || schedule.gamma <= 0) throw new Error("Schedule gamma must be a positive number.");
  }
  const { x, y } = datasetToBatch(points, model.numClasses);
  // Issue #253: the binary path (numClasses===2) keeps using
  // `nn.binaryCrossEntropy` directly, UNCHANGED from before -- every
  // existing determinism/regression test above pins its exact lossHistory
  // values. `nn.crossEntropy`'s own signature takes a raw `labels: Tensor`,
  // but `trainer.step()` always calls `lossFn(prediction, constant(y))`
  // (see trainer.js) -- i.e. the SECOND argument is always a `Variable`,
  // never a bare `Tensor`. A thin wrapper unwraps `target.value` (the
  // Tensor `constant()` wrapped) before handing it to `crossEntropy`,
  // verified empirically against the installed package: calling
  // `nn.crossEntropy` directly as `lossFn` throws
  // "labels.toArray is not a function" the moment `trainer` wraps `y`.
  const lossFn =
    model.numClasses === 2
      ? nn.binaryCrossEntropy
      : (logits: ReturnType<typeof variable>, target: ReturnType<typeof variable>) => nn.crossEntropy(logits, target.value);
  const optimizer = new optim.Adam(model.parameters(), { lr });
  if (!schedule && !onEpoch) {
    const fit = trainer.configure({ model, optimizer, lossFn, epochs });
    const { lossHistory } = await fit.fit({ x, y });
    return { lossHistory: [...lossHistory] };
  }
  const scheduler = schedule ? new optim.StepLR(optimizer, schedule) : undefined;
  const lossHistory: number[] = [];
  for (let epoch = 0; epoch < epochs; epoch++) {
    const fit = trainer.configure({ model, optimizer, lossFn, epochs: 1 });
    const result = await fit.fit({ x, y });
    const loss = result.lossHistory[0] as number;
    lossHistory.push(loss);
    scheduler?.step();
    if (onEpoch) await onEpoch({ epoch, loss });
  }
  return { lossHistory };
}

export interface GridDomain {
  min: number;
  max: number;
}

/** Shared by `predictProbabilityGrid`/`predictClassGrid`: a `[resolution*resolution, 2]` tensor of every grid cell's (x, y) coordinate, row-major with row 0 at `domain.min` y (the caller's renderer decides screen orientation). */
function gridInput(domain: GridDomain, resolution: number): Tensor {
  if (!Number.isInteger(resolution) || resolution <= 1 || resolution > 200) throw new Error("Resolution must be an integer in [2, 200].");
  const coords: number[] = [];
  for (let j = 0; j < resolution; j++) {
    const y = domain.min + (j / (resolution - 1)) * (domain.max - domain.min);
    for (let i = 0; i < resolution; i++) {
      const x = domain.min + (i / (resolution - 1)) * (domain.max - domain.min);
      coords.push(x, y);
    }
  }
  return Tensor.from(coords, { dtype: "f64" }).reshape([resolution * resolution, 2]);
}

/**
 * P(label=1) over a `resolution x resolution` grid -- one batched forward
 * pass (the whole grid as a single [R*R, 2] tensor), sigmoided from logits.
 * Row index 0 is the domain's MIN y; the caller's renderer decides screen
 * orientation. Temporarily switches `model` to eval mode (dropout becomes a
 * no-op) for the duration of this call, restoring the prior mode afterward --
 * inference should see the model's expected-value behavior, not a randomly
 * dropped-out sample of it.
 *
 * Binary-only (issue #253): a model built with more than 2 classes has an
 * output layer wider than the single logit this reads via `.at(row, 0)` --
 * see `predictClassGrid` for the 3+-class equivalent.
 */
export function predictProbabilityGrid(model: TinyMlp, domain: GridDomain, resolution: number): number[][] {
  if (model.numClasses !== 2) {
    throw new Error("predictProbabilityGrid only supports a binary (2-class) model; use predictClassGrid for 3+ classes.");
  }
  const input = gridInput(domain, resolution);
  const wasTraining = model.training;
  model.eval();
  let probs: ReturnType<typeof variable>["value"];
  try {
    probs = model.forward(variable(input)).sigmoid().value;
  } finally {
    model.training = wasTraining;
  }
  const grid: number[][] = [];
  for (let j = 0; j < resolution; j++) {
    const row: number[] = [];
    for (let i = 0; i < resolution; i++) row.push(probs.at(j * resolution + i, 0) as number);
    grid.push(row);
  }
  return grid;
}

/**
 * Issue #253's multi-class decision boundary: the predicted class index
 * (argmax over the model's `numClasses`-wide logit output) at every
 * `resolution x resolution` grid cell -- `predictProbabilityGrid`'s
 * continuous P(label=1) heatmap has no equivalent once there are more than
 * 2 classes to pick among, so this reports the winning class directly
 * (`tensor-core`'s own `Tensor.argmax(axis)`, not a hand-rolled loop) for
 * the caller to color categorically. Same eval-mode/restore and grid
 * layout as `predictProbabilityGrid`.
 *
 * 3+-classes-only: a binary (numClasses===2) model's output layer is a
 * single logit, so `argmax` over it is always index 0 -- meaningless;
 * `predictProbabilityGrid` is the binary equivalent.
 */
export function predictClassGrid(model: TinyMlp, domain: GridDomain, resolution: number): number[][] {
  if (model.numClasses < 3) {
    throw new Error("predictClassGrid requires a model with 3 or more classes; use predictProbabilityGrid for a binary model.");
  }
  const input = gridInput(domain, resolution);
  const wasTraining = model.training;
  model.eval();
  let classIndices: unknown[];
  try {
    classIndices = model.forward(variable(input)).value.argmax(1).toArray();
  } finally {
    model.training = wasTraining;
  }
  const grid: number[][] = [];
  for (let j = 0; j < resolution; j++) {
    const row: number[] = [];
    for (let i = 0; i < resolution; i++) row.push(Number(classIndices[j * resolution + i]));
    grid.push(row);
  }
  return grid;
}
