import { nn, optim, trainer, variable } from "mallory-tensor-autograd";
import { Rng, Tensor } from "mallory-tensor-core";
import { setSink, type TrainingEvent } from "mallory-telemetry";

export type DatasetType = "xor" | "moons" | "rings" | "drawn";

export interface LabeledPoint {
  x: number;
  y: number;
  label: 0 | 1;
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
 * `"drawn"` is deliberately NOT procedurally generated here -- it always
 * returns an empty array. Its points come from user clicks on the panel's
 * own canvas (issue #34's "user-drawn points as a dataset source"), held
 * in a separate `mlDrawnPoints` cell the panel's `points` cell reads from
 * directly when `dataset === "drawn"`, bypassing this function entirely.
 * The case still exists explicitly (not a `default`) so this switch stays
 * exhaustive over `DatasetType`.
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
  }
  return points;
}

/**
 * A 2 -> hidden -> 1 MLP with a ReLU between -- composed from two
 * `nn.Linear` layers as a `Module` subclass, since the published nn
 * namespace has no activation *Module* for `Sequential` to chain (ReLU
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
 */
export class TinyMlp extends nn.Module {
  readonly l1: InstanceType<typeof nn.Linear>;
  readonly l2: InstanceType<typeof nn.Linear>;
  readonly dropout: InstanceType<typeof nn.Dropout>;
  training = true;

  constructor(hidden: number, seed: number, dropoutRate = 0) {
    super();
    if (!Number.isInteger(hidden) || hidden <= 0 || hidden > 64) throw new Error("Hidden units must be a positive integer up to 64.");
    if (!Number.isFinite(dropoutRate) || dropoutRate < 0 || dropoutRate >= 1) throw new Error("Dropout rate must be a number in [0, 1).");
    const rng = new Rng(seed);
    this.l1 = new nn.Linear(2, hidden, { rng });
    this.l2 = new nn.Linear(hidden, 1, { rng });
    this.dropout = new nn.Dropout(dropoutRate);
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

export function datasetToBatch(points: readonly LabeledPoint[]): { x: Tensor; y: Tensor } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of points) {
    xs.push(p.x, p.y);
    ys.push(p.label);
  }
  return {
    x: Tensor.from(xs, { dtype: "f64" }).reshape([points.length, 2]),
    y: Tensor.from(ys, { dtype: "f64" }).reshape([points.length, 1]),
  };
}

type LossVariable = ReturnType<typeof variable>;

/**
 * Numerically stable binary cross-entropy from logits -- a workaround for a
 * real upstream bug found while building this panel: `nn.binaryCrossEntropy`
 * computes `log(sigmoid(z))`/`log(1-sigmoid(z))` directly, and once |z|
 * exceeds ~37, f64 `sigmoid` saturates to exactly 1 (or 0), so the
 * "correct" side's term becomes `0 * log(0) = NaN` -- the loss NaNs
 * PRECISELY BECAUSE the classifier converged (reproduced deterministically:
 * seed 42, moons, 200+~49 epochs). Filed upstream on mallory-plus.
 *
 * This uses the standard logits-space identity
 * `L(z, y) = relu(z) - z*y + log(1 + exp(-|z|))`, with the last term
 * rewritten as `-log(sigmoid(|z|))` to fit the published Variable op set
 * (no `exp`/`abs` ops exist; `|z| = relu(z) + relu(-z)`). `sigmoid(|z|)`
 * is always >= 0.5, so its log never sees 0 for ANY logit magnitude.
 * Verified equal to `nn.binaryCrossEntropy` to ~1e-12 in the non-saturated
 * regime, and finite (where upstream NaNs) in the saturated one.
 */
export function stableBinaryCrossEntropy(logits: LossVariable, target: LossVariable): LossVariable {
  const absZ = logits.relu().add(logits.mul(-1).relu());
  const perElement = logits.relu().sub(logits.mul(target)).sub(absZ.sigmoid().log());
  return perElement.mean();
}

export interface TrainResult {
  /** One binary-cross-entropy loss per epoch, in order (trainer.fit's own lossHistory). */
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
  const { x, y } = datasetToBatch(points);
  const optimizer = new optim.Adam(model.parameters(), { lr });
  if (!schedule && !onEpoch) {
    const fit = trainer.configure({ model, optimizer, lossFn: stableBinaryCrossEntropy, epochs });
    const { lossHistory } = await fit.fit({ x, y });
    return { lossHistory: [...lossHistory] };
  }
  const scheduler = schedule ? new optim.StepLR(optimizer, schedule) : undefined;
  const lossHistory: number[] = [];
  for (let epoch = 0; epoch < epochs; epoch++) {
    const fit = trainer.configure({ model, optimizer, lossFn: stableBinaryCrossEntropy, epochs: 1 });
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

/**
 * P(label=1) over a `resolution x resolution` grid -- one batched forward
 * pass (the whole grid as a single [R*R, 2] tensor), sigmoided from logits.
 * Row index 0 is the domain's MIN y; the caller's renderer decides screen
 * orientation. Temporarily switches `model` to eval mode (dropout becomes a
 * no-op) for the duration of this call, restoring the prior mode afterward --
 * inference should see the model's expected-value behavior, not a randomly
 * dropped-out sample of it.
 */
export function predictProbabilityGrid(model: TinyMlp, domain: GridDomain, resolution: number): number[][] {
  if (!Number.isInteger(resolution) || resolution <= 1 || resolution > 200) throw new Error("Resolution must be an integer in [2, 200].");
  const coords: number[] = [];
  for (let j = 0; j < resolution; j++) {
    const y = domain.min + (j / (resolution - 1)) * (domain.max - domain.min);
    for (let i = 0; i < resolution; i++) {
      const x = domain.min + (i / (resolution - 1)) * (domain.max - domain.min);
      coords.push(x, y);
    }
  }
  const input = Tensor.from(coords, { dtype: "f64" }).reshape([resolution * resolution, 2]);
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
