import { Symbolic } from "mallory-math";
import { compileExpr } from "mallory-adapter-math";
import { optim, variable } from "mallory-tensor-autograd";
import { Tensor } from "mallory-tensor-core";
import { preprocessImplicitMultiplication } from "./implicit-mult.ts";

export type OptimizerType = "sgd" | "adam" | "rmsprop";

export interface DescentPoint {
  x: number;
  y: number;
  f: number;
}

export interface DescentResult {
  /** Start point first, then one entry per completed optimizer step. */
  path: DescentPoint[];
  /** True when the run bailed before `steps` because f or the position went non-finite (a genuine divergence, e.g. SGD with too-large a learning rate on a steep field). */
  stoppedEarly: boolean;
}

const MAX_STEPS = 2000;

/**
 * Gradient descent on f(x, y) through the full family chain (issue #33's
 * whole point -- every link shipped separately, nothing had composed them):
 * `Symbolic.parse` -> adapter-math `compileExpr` (Expr -> elementwise IR)
 * -> tensor-compile's `asVariableOp` (autograd-compatible fused op) ->
 * tensor-autograd `Variable.backward()` for gradients -> an optim
 * `SGD`/`Adam`/`RMSprop` step loop.
 *
 * The gradients are EXACT (reverse-mode autograd, not finite differences) --
 * confirmed directly before writing this: d/dx[(x-1)^2+(y+2)^2] at (4,3)
 * comes back as exactly 6/10 in f64, and the very first SGD step lands on
 * the hand-computable point (start - lr*grad) bit-for-bit.
 *
 * An expression using only one of x/y still works: both are always declared
 * to `compileExpr` (input order [x, y]), and the unused one's gradient is a
 * genuine 0 (confirmed directly), so the descent simply never moves along
 * that axis.
 *
 * `UnsupportedExprError` (adapter-math's own error for an Expr with no
 * elementwise-tensor meaning, e.g. `gcd(x, y)`) propagates to the caller --
 * the panel surfaces it as the standard cell error, per the issue.
 *
 * `schedule`, if given, wraps the optimizer in an `optim.StepLR` (issue
 * #33's remaining "StepLR schedule wiring" item): `stepSize`/`gamma` as
 * documented on `StepLR` itself -- lr multiplies by `gamma` every
 * `stepSize` calls to `.step()`. `StepLR.step()` is called once per
 * descent iteration here (this toy single-batch setting has no separate
 * epoch/batch distinction, so "once per epoch" collapses to "once per
 * iteration"), AFTER the optimizer's own `.step()` -- the first descent
 * step always uses the unmodified initial lr, matching `StepLR`'s own
 * "effective lr after n calls" contract.
 */
export function runGradientDescent(
  exprText: string,
  startX: number,
  startY: number,
  optimizerType: OptimizerType,
  lr: number,
  steps: number,
  schedule?: { stepSize: number; gamma: number },
): DescentResult {
  if (!Number.isFinite(startX) || !Number.isFinite(startY)) throw new Error("Start point must be finite numbers.");
  if (!Number.isFinite(lr) || lr <= 0) throw new Error("Learning rate must be a positive number.");
  if (!Number.isInteger(steps) || steps <= 0 || steps > MAX_STEPS) throw new Error(`Steps must be a positive integer up to ${MAX_STEPS}.`);

  const expr = Symbolic.parse(preprocessImplicitMultiplication(exprText));
  const compiled = compileExpr(expr, { variables: ["x", "y"] });
  const op = compiled.asVariableOp();

  const x = variable(Tensor.from([startX], { dtype: "f64" }));
  const y = variable(Tensor.from([startY], { dtype: "f64" }));

  const optimizer =
    optimizerType === "sgd"
      ? new optim.SGD([x, y], { lr })
      : optimizerType === "adam"
        ? new optim.Adam([x, y], { lr })
        : new optim.RMSprop([x, y], { lr });
  const scheduler = schedule ? new optim.StepLR(optimizer, schedule) : null;

  const evaluateF = (): number => {
    // A plain (non-tracked) forward just for the readout -- reuses the same
    // compiled kernel, so the recorded f is byte-identical to what the
    // descent itself minimized.
    return compiled.forward(x.value, y.value).item() as number;
  };

  const path: DescentPoint[] = [{ x: startX, y: startY, f: evaluateF() }];
  let stoppedEarly = false;

  for (let i = 0; i < steps; i++) {
    optimizer.zeroGrad();
    const loss = op(x, y);
    loss.backward();
    optimizer.step();
    scheduler?.step();

    const newX = x.value.item() as number;
    const newY = y.value.item() as number;
    if (!Number.isFinite(newX) || !Number.isFinite(newY)) {
      stoppedEarly = true;
      break;
    }
    const f = evaluateF();
    if (!Number.isFinite(f)) {
      stoppedEarly = true;
      break;
    }
    path.push({ x: newX, y: newY, f });
  }

  return { path, stoppedEarly };
}
