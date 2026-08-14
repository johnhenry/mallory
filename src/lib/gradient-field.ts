import { DualNumber, Symbolic, type Expr } from "mallory-math";
import type { Domain } from "./sample-function.ts";
import type { VectorFieldPoint } from "./sample-ode.ts";

/**
 * Evaluates a two-variable `Expr` AST over `DualNumber` -- `VectorCalculus.
 * gradient`/`DualNumber.gradient` take a hand-written `(xs: DualNumber[]) =>
 * DualNumber` callback, not an `Expr`, so this is the walker that bridges
 * the two (the same shape as complex-eval.ts's walker for ComplexNumber,
 * for the same reason: neither `Symbolic.evaluate` (real-only) nor
 * `Symbolic.evaluateOverStructure` (throws on any func/call2 node) fits).
 * `DualNumber` exposes a smaller elementary-function set than `ComplexNumber`
 * (sin/cos/tan/exp/log/sqrt only, all static) -- anything else throws a
 * clear "not supported" error rather than silently producing a wrong
 * gradient.
 */
export function evaluateDual(expr: Expr, env: Record<string, DualNumber>): DualNumber {
  switch (expr.type) {
    case "const":
      return DualNumber.constant(expr.value);
    case "var": {
      if (expr.name === "pi") return DualNumber.constant(Math.PI);
      if (expr.name === "e") return DualNumber.constant(Math.E);
      const bound = env[expr.name];
      if (!bound) throw new Error(`"${expr.name}" is not bound -- only the field's own variables and constants (pi, e) are available here.`);
      return bound;
    }
    case "add":
      return evaluateDual(expr.left, env).add(evaluateDual(expr.right, env));
    case "sub":
      return evaluateDual(expr.left, env).subtract(evaluateDual(expr.right, env));
    case "mul":
      return evaluateDual(expr.left, env).multiply(evaluateDual(expr.right, env));
    case "div":
      return evaluateDual(expr.left, env).divide(evaluateDual(expr.right, env));
    case "pow": {
      const base = evaluateDual(expr.base, env);
      // DualNumber.pow only takes a constant exponent (chain rule needs a
      // fixed power); a variable-dependent exponent falls back to the
      // x^y = exp(y*ln(x)) identity, same as any CAS would rewrite it.
      if (expr.exp.type === "const") return base.pow(expr.exp.value);
      const exponent = evaluateDual(expr.exp, env);
      return DualNumber.exp(exponent.multiply(DualNumber.log(base)));
    }
    case "neg":
      return evaluateDual(expr.arg, env).negate();
    case "func":
      return evaluateDualFunc(expr.name, evaluateDual(expr.arg, env));
    default:
      throw new Error(`"${expr.type}" has no gradient-field meaning here.`);
  }
}

function evaluateDualFunc(name: string, x: DualNumber): DualNumber {
  switch (name) {
    case "sin":
      return DualNumber.sin(x);
    case "cos":
      return DualNumber.cos(x);
    case "tan":
      return DualNumber.tan(x);
    case "exp":
      return DualNumber.exp(x);
    case "ln":
      return DualNumber.log(x);
    case "sqrt":
      return DualNumber.sqrt(x);
    default:
      throw new Error(`"${name}" isn't supported for a gradient field (DualNumber only has sin/cos/tan/exp/ln/sqrt).`);
  }
}

/**
 * Samples the gradient of `exprText` (a function of `xVar`/`yVar`) over a
 * grid -- the exact analogue of `sampleVectorField2D`'s ODE phase portrait,
 * but for a scalar field's gradient instead of a system's flow. Points
 * where the field itself isn't finite (e.g. `ln(x)` off its domain) are
 * omitted, matching `sampleVectorField2D`'s own convention -- checked via a
 * plain real evaluation of `f` first, NOT by checking the gradient's own
 * finiteness: `DualNumber.log`'s derivative formula (`1/x`) stays finite
 * even when its VALUE (`Math.log` of a non-positive number) is `NaN` -- the
 * chain-rule arithmetic on the derivative component doesn't itself check
 * whether the value it's built from was ever meaningful, so a domain
 * violation can silently produce a finite-looking but meaningless gradient
 * if not caught upstream (confirmed directly: `ln(-1)` gives `{value: NaN,
 * deriv: -1}`, not an all-NaN result).
 */
export function sampleGradientField(
  exprText: string,
  xDomain: Domain,
  yDomain: Domain,
  gridDensity = 15,
  xVar = "x",
  yVar = "y",
): VectorFieldPoint[] {
  const parsed = Symbolic.parse(exprText);
  const compiledReal = Symbolic.compile(parsed, { declaredVariables: [xVar, yVar] });
  const points: VectorFieldPoint[] = [];
  for (let i = 0; i < gridDensity; i++) {
    const x = xDomain.min + (i / (gridDensity - 1)) * (xDomain.max - xDomain.min);
    for (let j = 0; j < gridDensity; j++) {
      const y = yDomain.min + (j / (gridDensity - 1)) * (yDomain.max - yDomain.min);
      if (!Number.isFinite(compiledReal({ [xVar]: x, [yVar]: y }))) continue;
      try {
        const [dx, dy] = DualNumber.gradient(
          (xs) => evaluateDual(parsed, { [xVar]: xs[0] as DualNumber, [yVar]: xs[1] as DualNumber }),
          [x, y],
        );
        if (Number.isFinite(dx) && Number.isFinite(dy)) points.push({ x, y, dx: dx as number, dy: dy as number });
      } catch {
        // Undefined at this grid point (e.g. off the field's domain) -- omit, same as a non-finite value.
      }
    }
  }
  return points;
}
