import { nn, optim, trainer } from "mallory-tensor-autograd";
import { Tensor } from "mallory-tensor-core";

export interface RegressionPoint {
  x: number;
  y: number;
}

export interface RobustLinearFit {
  slope: number;
  intercept: number;
}

const MAX_EPOCHS = 2000;

/**
 * Robust linear fit via Huber loss (issue #34 item 3): a `nn.Linear(1,1)`
 * IS `y = slope*x + intercept` exactly (weight = slope, bias = intercept),
 * so no bespoke model class is needed -- just train that one layer with
 * `nn.huberLoss` instead of the panel's existing closed-form
 * `Statistics.linearRegression` (which minimizes squared error and is
 * dragged hard by a single outlier). Uses the same `trainer.fit`/`optim.Adam`
 * machinery ml-playground.ts already established, since `trainer.fit` is
 * async (no synchronous closed form for a robust loss), which doesn't fit a
 * `CellGraph.define` reactive cell -- callers trigger this imperatively
 * (a "Fit" button), matching MlPlaygroundPanel's own precedent for the
 * same reason.
 *
 * Verified empirically before writing this: on a line y=2x+1 with one
 * point moved to (9, 200), OLS recovers slope 11.87/intercept -25.3 (wildly
 * skewed by the outlier) while this Huber fit recovers slope ~2.09/intercept
 * ~0.77 -- genuinely close to the true line despite the same outlier.
 */
export async function fitRobustLinear(points: readonly RegressionPoint[], options: { lr?: number; epochs?: number } = {}): Promise<RobustLinearFit> {
  if (points.length < 2) throw new Error("Enter at least two (x, y) rows.");
  const lr = options.lr ?? 0.1;
  const epochs = options.epochs ?? 500;
  if (!Number.isFinite(lr) || lr <= 0) throw new Error("Learning rate must be a positive number.");
  if (!Number.isInteger(epochs) || epochs <= 0 || epochs > MAX_EPOCHS) throw new Error(`Epochs must be a positive integer up to ${MAX_EPOCHS}.`);

  const xT = Tensor.from(points.map((p) => p.x), { dtype: "f64" }).reshape([points.length, 1]);
  const yT = Tensor.from(points.map((p) => p.y), { dtype: "f64" }).reshape([points.length, 1]);
  const model = new nn.Linear(1, 1);
  const fit = trainer.configure({
    model,
    optimizer: new optim.Adam(model.parameters(), { lr }),
    lossFn: nn.huberLoss,
    epochs,
  });
  await fit.fit({ x: xT, y: yT });
  const [weight, bias] = model.parameters();
  return { slope: weight!.value.at(0, 0) as number, intercept: bias!.value.at(0) as number };
}

/**
 * Points whose residual from a given (slope, intercept) line exceeds
 * `thresholdMads` scaled median-absolute-deviations -- the standard robust
 * outlier convention (MAD scaled by 1.4826 estimates the same spread a
 * gaussian's standard deviation would, so this reads like a z-score test
 * but isn't itself dragged off by the very outliers it's trying to flag,
 * unlike a mean/stddev-based test would be). Returns the 0-based indices
 * into `points`, not the points themselves, so callers can cross-reference
 * against their own row list (which may carry ids/other fields).
 */
export function findOutlierIndices(points: readonly RegressionPoint[], slope: number, intercept: number, thresholdMads = 2.5): number[] {
  if (points.length === 0) return [];
  const residuals = points.map((p) => p.y - (slope * p.x + intercept));
  const sorted = [...residuals].sort((a, b) => a - b);
  const median = sorted.length % 2 === 1 ? sorted[(sorted.length - 1) / 2]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
  const absDevs = residuals.map((r) => Math.abs(r - median)).sort((a, b) => a - b);
  const mad = absDevs.length % 2 === 1 ? absDevs[(absDevs.length - 1) / 2]! : (absDevs[absDevs.length / 2 - 1]! + absDevs[absDevs.length / 2]!) / 2;
  if (mad === 0) return []; // every residual identical (or all but one exactly on the line) -- no meaningful spread to test against
  const scaledMad = mad * 1.4826;
  const indices: number[] = [];
  residuals.forEach((r, i) => {
    if (Math.abs(r - median) / scaledMad > thresholdMads) indices.push(i);
  });
  return indices;
}
