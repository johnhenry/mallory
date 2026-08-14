/**
 * Pure evaluation logic for CalculatorPanel.tsx (mallory-graph's SPA-shell
 * pass): a REPL-style "just an answer" tool with no plot/viewport, so unlike
 * every other panel here it has no CellGraph cells to derive -- this module
 * is the whole of its business logic, kept separate from the component so it
 * can be unit-tested directly instead of only through a live-browser pass.
 *
 * Mirrors GraphCanvas.tsx's own mode/structure conventions exactly rather
 * than inventing new ones: `mode` (float/exact) and `modulus` (null = real
 * numbers, else Z/nZ via `integersModuloStructure`) are the same two knobs
 * GraphCanvas exposes, just without a curve attached to them.
 */
import { Interval, Rational, Symbolic } from "mallory-math";
import { integersModuloStructure } from "./finite-structure.ts";
import { evaluateInterval } from "./interval-eval.ts";
import { preprocessImplicitMultiplication } from "./implicit-mult.ts";
import { evaluateUnitExpr } from "./unit-expr.ts";

export type CalculatorMode = "float" | "exact" | "units" | "interval";

export interface CalculatorEntry {
  input: string;
  display: string;
  isAssignment: boolean;
  isError: boolean;
}

export interface CalculatorState {
  history: CalculatorEntry[];
  variables: Record<string, number>;
}

export const EMPTY_CALCULATOR_STATE: CalculatorState = { history: [], variables: {} };

/** `name = expr`, not `==` (equality) and not `name >= expr`/`name <= expr` etc. */
const ASSIGNMENT_RE = /^([a-zA-Z_]\w*)\s*=(?![=])\s*(.+)$/;

/** Trims floating noise (e.g. 0.1+0.2) without permanently losing precision for genuinely small results. */
function formatFloat(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (value !== 0 && Math.abs(value) < 1e-10) return String(value);
  return String(Math.round(value * 1e10) / 1e10);
}

export interface EvalResult {
  display: string;
  isError: boolean;
  /** The plain-number value to store when this evaluation is the RHS of an assignment; null on error. */
  value: number | null;
}

/**
 * Evaluates one expression against the calculator's current named values.
 * `modulus` (a finite structure, e.g. Z/7Z) takes precedence over `mode` --
 * asking "float or exact" doesn't mean anything once evaluation is happening
 * inside a finite ring, mirroring how GraphCanvas's own float/exact radios
 * are about the point readout, orthogonal to (and superseded in relevance
 * by) its structure selector.
 */
export function evaluateCalculatorExpr(
  source: string,
  variables: Record<string, number>,
  mode: CalculatorMode,
  modulus: number | null,
): EvalResult {
  try {
    if (modulus !== null) {
      const expr = Symbolic.parse(preprocessImplicitMultiplication(source));
      const value = Symbolic.evaluateOverStructure(expr, integersModuloStructure(modulus).structure, variables);
      if (Number.isNaN(value)) return { display: `undefined in Z/${modulus}Z`, isError: true, value: null };
      return { display: String(value), isError: false, value };
    }
    if (mode === "units") {
      // Not routed through Symbolic (its Expr AST has no unit-carrying leaf
      // type) -- see unit-expr.ts for the small hand-written grammar this
      // uses instead. `variables` are plain dimensionless numbers here (a
      // stated v1 limitation); the result's magnitude, in whatever unit
      // symbol it ends up in, is what gets stored on assignment.
      const result = evaluateUnitExpr(source, variables);
      return { display: result.toString(), isError: false, value: result.value };
    }
    if (mode === "interval") {
      // Every named variable is a previously-computed plain float, so it's
      // treated as a degenerate point interval here -- there's no input
      // syntax yet for a genuinely non-degenerate interval literal (e.g.
      // "[1, 2]"), a real grammar change out of scope for this v1. Bounds
      // still widen meaningfully through the evaluation itself (sqrt, trig,
      // division, ...), which is the point of interval mode: rigorous
      // bounds on the RESULT, not necessarily on the inputs.
      const expr = Symbolic.parse(preprocessImplicitMultiplication(source));
      const env: Record<string, Interval> = {};
      for (const [name, v] of Object.entries(variables)) env[name] = Interval.point(v);
      const result = evaluateInterval(expr, env);
      return { display: result.toString(), isError: false, value: result.midpoint };
    }
    if (mode === "exact") {
      const expr = Symbolic.parse(preprocessImplicitMultiplication(source));
      const env: Record<string, Rational> = {};
      for (const [name, v] of Object.entries(variables)) env[name] = Rational.fromNumber(v);
      const exact = Symbolic.evaluateExact(expr, env);
      return { display: exact.toString(), isError: false, value: exact.toNumber() };
    }
    const compiled = Symbolic.compile(preprocessImplicitMultiplication(source));
    const value = compiled(variables);
    if (!Number.isFinite(value)) return { display: "undefined", isError: true, value: null };
    return { display: formatFloat(value), isError: false, value };
  } catch (e) {
    return { display: e instanceof Error ? e.message : "couldn't evaluate that", isError: true, value: null };
  }
}

/**
 * Submits one typed line -- a bare expression, or a `name = expr` assignment
 * -- returning the next `CalculatorState`. A failed assignment still appends
 * a history entry (showing the error) but leaves `variables` untouched.
 */
export function submitCalculatorLine(
  raw: string,
  state: CalculatorState,
  mode: CalculatorMode,
  modulus: number | null,
): CalculatorState {
  const trimmed = raw.trim();
  if (!trimmed) return state;

  const assignMatch = trimmed.match(ASSIGNMENT_RE);
  if (assignMatch) {
    const [, name, rhs] = assignMatch;
    const result = evaluateCalculatorExpr(rhs, state.variables, mode, modulus);
    const entry: CalculatorEntry = { input: trimmed, display: result.display, isAssignment: !result.isError, isError: result.isError };
    const variables = !result.isError && result.value !== null ? { ...state.variables, [name]: result.value } : state.variables;
    return { history: [...state.history, entry], variables };
  }

  const result = evaluateCalculatorExpr(trimmed, state.variables, mode, modulus);
  const entry: CalculatorEntry = { input: trimmed, display: result.display, isAssignment: false, isError: result.isError };
  return { history: [...state.history, entry], variables: state.variables };
}
