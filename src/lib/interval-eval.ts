import { Interval, type Expr } from "@johnhenry/math";

export type IntervalEnv = Record<string, Interval>;

const CONSTANTS: Record<string, Interval> = { pi: Interval.point(Math.PI), e: Interval.point(Math.E) };

/**
 * Evaluates a mallory-math `Expr` AST over `Interval` values -- rigorous
 * bounds propagation, not a point evaluation. Neither of mallory-math's own
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
    // Every non-exact elementary function is outward-rounded by 1 ulp per
    // side (mallory#305 smaller note 1, upstream johnhenry/math#57):
    // mallory-math's Interval computes bounds with plain Math.* calls and no
    // directed rounding, so a POINT input came back as a point output --
    // `sqrt(2)` displayed `[1.4142135623730951, 1.4142135623730951]`, an
    // interval that provably does NOT contain the irrational sqrt(2). One
    // ulp outward per side restores the containment guarantee interval
    // mode's whole pitch rests on (Math.sqrt is correctly rounded to
    // 0.5 ulp; the libm-style trig/exp/log are within ~1 ulp on every
    // mainstream engine, so 1 ulp of slack covers both), at the cost of a
    // deliberately-loose bound when the true value happens to be exactly
    // representable (sqrt(4) reports a width-2-ulp interval around 2).
    // `abs` is exact -- no widening.
    case "sqrt":
      return outward(x.sqrt());
    case "exp":
      return outward(x.exp());
    case "ln":
      return outward(x.log());
    case "sin":
      return outward(x.sin());
    case "cos":
      return outward(x.cos());
    case "abs":
      return x.abs();
    // tan = sin/cos has no dedicated Interval method; dividing the two
    // rigorously propagates the asymptote as a divide-by-zero-containing-
    // interval error, exactly the correct behavior near an odd multiple of
    // pi/2 -- not a workaround, the mathematically right answer.
    case "tan":
      return outward(x.sin()).divide(outward(x.cos()));
    default:
      throw new Error(`"${name}" isn't supported in interval mode (no rigorous Interval implementation available).`);
  }
}

/** `lo` stepped one representable double toward -Infinity, `hi` one toward +Infinity -- IEEE-754 nextafter via bit manipulation, since JS has no Math.nextafter. */
function outward(x: Interval): Interval {
  return new Interval(nextDown(x.lo), nextUp(x.hi));
}

const F64 = new Float64Array(1);
const U64 = new BigUint64Array(F64.buffer);

export function nextUp(value: number): number {
  if (Number.isNaN(value) || value === Infinity) return value;
  if (value === 0) return Number.MIN_VALUE;
  F64[0] = value;
  U64[0] = (U64[0] as bigint) + (value > 0 ? 1n : -1n);
  return F64[0] as number;
}

export function nextDown(value: number): number {
  return -nextUp(-value);
}
