import { Rational, Symbolic } from "mallory-math";
import { preprocessImplicitMultiplication } from "./implicit-mult.ts";

/**
 * Evaluates an expression string at one point over `Rational` arithmetic
 * instead of floats -- exact-mode readout (issue #51, porting `GraphCanvas`'s
 * `ids.exact` compute to a shared, on-demand function so `GraphCanvasMulti`'s
 * per-row point readout can reuse the exact same semantics without a
 * per-row reactive cell for a value only ever needed for whichever ONE row
 * was last clicked). Returns `null` (not a lossy decimal string) whenever
 * the expression isn't exactly representable -- a `func` node (`sin`, `exp`,
 * ...) or a non-integer `pow` exponent -- or on any parse/eval error, so
 * callers fall back to the float value rather than showing a wrong "exact"
 * answer.
 */
export function evaluateExactAt(source: string, x: number, params: Record<string, number>, axisVariable = "x"): string | null {
  try {
    const expr = Symbolic.parse(preprocessImplicitMultiplication(source));
    const env: Record<string, Rational> = { [axisVariable]: Rational.fromNumber(x) };
    for (const [name, value] of Object.entries(params)) env[name] = Rational.fromNumber(value);
    return Symbolic.evaluateExact(expr, env).toString();
  } catch {
    return null;
  }
}
