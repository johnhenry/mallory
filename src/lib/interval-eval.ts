import { Interval, type Expr } from "@johnhenry/math";

export type IntervalEnv = Record<string, Interval>;

const CONSTANTS: Record<string, Interval> = { pi: Interval.point(Math.PI), e: Interval.point(Math.E) };

/**
 * Evaluates an @johnhenry/math `Expr` AST over `Interval` values -- rigorous
 * bounds propagation, not a point evaluation. Neither of @johnhenry/math's own
 * evaluators fits (same reasoning as `complex-eval.ts`'s own evaluator):
 * `Symbolic.evaluate` is float-only, so this is a dedicated AST walker
 * dispatching to `Interval`'s own arithmetic/elementary-function methods.
 *
 * A `pow` node requires a constant, non-negative-integer exponent --
 * `Interval.pow` itself only accepts that (rigorous interval bounds for a
 * general real exponent would need `exp(exponent * log(base))`, which fails
 * outright for a base interval touching zero or negative, so it's out of
 * scope here). Division by an interval containing zero, and `sqrt`/`log` of
 * an interval containing a non-positive value, throw straight from
 * `Interval` itself -- that's the mathematically correct behavior (the
 * result isn't a single bounded interval), so those exceptions are left to
 * propagate rather than caught and papered over.
 */
export function evaluateInterval(expr: Expr, env: IntervalEnv): Interval {
  switch (expr.type) {
    case "const":
      return Interval.point(expr.value);
    case "var": {
      const constant = CONSTANTS[expr.name];
      if (constant) return constant;
      const bound = env[expr.name];
      if (!bound) throw new Error(`"${expr.name}" is not bound -- only variables passed in env, plus constants (pi, e), are available here.`);
      return bound;
    }
    case "add":
      return evaluateInterval(expr.left, env).add(evaluateInterval(expr.right, env));
    case "sub":
      return evaluateInterval(expr.left, env).subtract(evaluateInterval(expr.right, env));
    case "mul":
      return evaluateInterval(expr.left, env).multiply(evaluateInterval(expr.right, env));
    case "div":
      return evaluateInterval(expr.left, env).divide(evaluateInterval(expr.right, env));
    case "pow": {
      const base = evaluateInterval(expr.base, env);
      const exponent = evaluateInterval(expr.exp, env);
      if (exponent.lo !== exponent.hi || !Number.isInteger(exponent.lo) || exponent.lo < 0) {
        throw new Error("Interval mode only supports a constant, non-negative integer exponent (e.g. x^3, not x^y or x^0.5).");
      }
      return base.pow(exponent.lo);
    }
    case "neg":
      return evaluateInterval(expr.arg, env).negate();
    case "func":
      return evaluateIntervalFunc(expr.name, evaluateInterval(expr.arg, env));
    default:
      throw new Error(`"${expr.type}" has no interval-valued meaning here.`);
  }
}

function evaluateIntervalFunc(name: string, x: Interval): Interval {
  switch (name) {
    // Every non-exact op -- including sqrt/exp/log/sin/cos here, and
    // add/subtract/multiply/divide/pow up in evaluateInterval -- now
    // outward-rounds its own result by ~1 ulp per side natively inside
    // @johnhenry/math's Interval (johnhenry/math#57). This function used to
    // carry a LOCAL nextUp/nextDown-based outward() wrapper around exactly
    // these five cases, worked around here (mallory#305) before the fix
    // landed upstream; now redundant (double-widening these specific ops by
    // ~2 ulp instead of ~1, while leaving arithmetic ops unrounded) and
    // deleted, per johnhenry/math#57's own note that this workaround could
    // be deleted once Interval did this natively. `abs` is exact -- no
    // widening, from either this call site or Interval's own.
    case "sqrt":
      return x.sqrt();
    case "exp":
      return x.exp();
    case "ln":
      return x.log();
    case "sin":
      return x.sin();
    case "cos":
      return x.cos();
    case "abs":
      return x.abs();
    // tan = sin/cos has no dedicated Interval method; dividing the two
    // rigorously propagates the asymptote as a divide-by-zero-containing-
    // interval error, exactly the correct behavior near an odd multiple of
    // pi/2 -- not a workaround, the mathematically right answer.
    case "tan":
      return x.sin().divide(x.cos());
    default:
      throw new Error(`"${name}" isn't supported in interval mode (no rigorous Interval implementation available).`);
  }
}
