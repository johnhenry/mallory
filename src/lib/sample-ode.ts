import { GraphUtils, Numerical, Symbolic, Vector, type Expr, type Path2D } from "@johnhenry/math";
import { exprToLatex } from "./expr-to-latex.ts";
import { preprocessImplicitMultiplication } from "./implicit-mult.ts";
import type { Domain } from "./sample-function.ts";

export interface SlopeFieldPoint {
  x: number;
  y: number;
  slope: number;
}

export interface OdeSystemSpec {
  /** State variable names, in Numerical.rk4's y-vector order, e.g. ["x", "y"]. */
  stateVars: [string, string];
  /** Independent variable name (usually "t"), available in both derivative expressions. */
  independentVar: string;
  /** One derivative expression per state var, e.g. [dx/dt, dy/dt]; each may reference stateVars + independentVar. */
  derivatives: [string, string];
}

export interface OdeTrajectoryPoint {
  t: number;
  state: [number, number];
}

export interface VectorFieldPoint {
  x: number;
  y: number;
  dx: number;
  dy: number;
}

const SOLUTION_COLOR = 0x16a34a; // distinct from the curve/area blue, so a solution overlaid on a plotted f(x,y)=0 relation reads as a separate object

/**
 * Numerically solves the first-order IVP dy/dx = f(x, y), y(x0) = y0, across
 * `xDomain` via RK4 (Numerical.rk4) -- forward from x0 to xDomain.max, and
 * backward from x0 down to xDomain.min via the substitution s = -x (so
 * `Numerical.rk4`, which always integrates forward in its own time
 * variable, can walk backward in x).
 *
 * A non-finite y (the solution blowing up, e.g. dy/dx = y^2 escaping to
 * infinity in finite x) truncates that direction's run rather than
 * poisoning the whole curve, mirroring sampleExpr's gap-tolerant-run
 * convention -- just bounded by "solver diverged" instead of "undefined at
 * this sample". Non-goal: fixed step size, no adaptive refinement near a
 * singularity.
 */
export function sampleOdeSolution(
  expr: Expr | string,
  x0: number,
  y0: number,
  xDomain: Domain,
  steps = 200,
): Path2D {
  const parsed = typeof expr === "string" ? Symbolic.parse(preprocessImplicitMultiplication(expr)) : expr;
  const compiled = Symbolic.compile(parsed);
  const f = (x: number, y: number): number => compiled({ x, y });

  function collectRun(target: number): number[][] {
    const run: number[][] = [];
    if (Math.abs(target - x0) < 1e-12) return run;
    const forward = target > x0;
    const h = Math.abs(target - x0) / steps;
    const odeFn = forward
      ? (t: number, ys: number[]): number[] => [f(t, ys[0] as number)]
      : (s: number, ys: number[]): number[] => [-f(-s, ys[0] as number)];
    const t0 = forward ? x0 : -x0;
    const t1 = forward ? target : -target;
    for (const step of Numerical.rk4(odeFn, [y0], t0, t1, h)) {
      const x = forward ? step.t : -step.t;
      const y = step.y[0] as number;
      if (!Number.isFinite(y)) break;
      run.push([x, y]);
    }
    return run;
  }

  const backwardRun = collectRun(xDomain.min).reverse(); // reverse -> x-ascending
  const forwardRun = collectRun(xDomain.max);
  // Both runs' first element is the (x0,y0) step (rk4 always seeds its
  // output with {t0,y0}); backwardRun's got moved to its *last* position by
  // the reverse() above, and forwardRun's is at its first, so drop
  // backwardRun's duplicate to avoid drawing (x0,y0) twice at the seam.
  if (backwardRun.length > 0) backwardRun.pop();

  const runs = [backwardRun, forwardRun].filter((run) => run.length > 0);
  if (runs.length === 0) {
    return GraphUtils.vectorToCurve(Vector.fromArray([Vector.fromArray([x0, y0])]), 2, SOLUTION_COLOR);
  }
  const segments = runs.map((run) => GraphUtils.vectorToCurve(Vector.fromArray(run.map((p) => Vector.fromArray(p))), 2, SOLUTION_COLOR));
  return { stroke: (segments[0] as Path2D).stroke, commands: segments.flatMap((s) => s.commands) };
}

export interface OdeClosedFormAttempt {
  found: boolean;
  /** Present only when `found`. `false` means `latex` is an implicit relation (in both x and y), not an isolated y(x). */
  explicit?: boolean;
  latex?: string;
}

/**
 * Best-effort wrapper around `Symbolic.solveOdeClosedForm` for the ODE
 * panel: tries a closed-form solution and returns a renderable LaTeX
 * string when one is found, or `{found:false}` uniformly for any failure
 * (NotSeparableError, NoClosedFormError, a malformed expression, etc.) --
 * most ODEs have no elementary closed form, so this is an expected, silent
 * "nothing to show" outcome, not an error surfaced to the user.
 * `sampleOdeSolution`'s numeric RK4 plot is unconditional and computed
 * independently of this, so there's no separate "fall back to numeric"
 * branch here beyond simply not rendering this extra line when
 * `found` is `false`.
 */
export function attemptOdeClosedForm(expr: Expr | string, x0: number, y0: number): OdeClosedFormAttempt {
  try {
    const parsed = typeof expr === "string" ? Symbolic.parse(preprocessImplicitMultiplication(expr)) : expr;
    const result = Symbolic.solveOdeClosedForm(parsed, x0, y0);
    const rendered = result.explicit ? result.y : result.implicitRelation;
    if (!rendered) return { found: false };
    return { found: true, explicit: result.explicit, latex: exprToLatex(rendered) };
  } catch {
    return { found: false };
  }
}

function compileSystem(spec: OdeSystemSpec): (t: number, a: number, b: number) => [number, number] {
  const compiledA = Symbolic.compile(Symbolic.parse(preprocessImplicitMultiplication(spec.derivatives[0])));
  const compiledB = Symbolic.compile(Symbolic.parse(preprocessImplicitMultiplication(spec.derivatives[1])));
  const [nameA, nameB] = spec.stateVars;
  return (t, a, b) => {
    const env: Record<string, number> = { [spec.independentVar]: t, [nameA]: a, [nameB]: b };
    return [compiledA(env), compiledB(env)];
  };
}

/**
 * Numerically integrates a coupled 2-variable first-order ODE system
 * dstate/dt = f(t, state) from `initial.t0` across `tDomain`, forward and
 * (via the same s=-t substitution as sampleOdeSolution) backward. This
 * leans entirely on `Numerical.rk4` already being a *system* solver -- it
 * takes an arbitrary-length `number[]` state, not just a scalar -- so the
 * only new work here is the two-derivative-expressions-over-a-named-
 * state-vector glue, mirroring sampleOdeSolution's single-equation version.
 *
 * Unlike sampleOdeSolution, the seed point (t0, state0) is stripped from
 * each direction's run and spliced back in exactly once between them,
 * rather than relying on one run or the other to still contain it -- that
 * avoids a subtly asymmetric edge case where a degenerate one-sided domain
 * (`tDomain.max` equal to `t0`) would otherwise drop the seed entirely.
 */
export function sampleOdeSystem2D(
  spec: OdeSystemSpec,
  initial: { t0: number; state0: [number, number] },
  tDomain: Domain,
  steps = 400,
): OdeTrajectoryPoint[] {
  const f = compileSystem(spec);
  const { t0, state0 } = initial;

  function collectRun(target: number): OdeTrajectoryPoint[] {
    const run: OdeTrajectoryPoint[] = [];
    if (Math.abs(target - t0) < 1e-12) return run;
    const forward = target > t0;
    const h = Math.abs(target - t0) / steps;
    const odeFn = forward
      ? (tt: number, ys: number[]): number[] => f(tt, ys[0] as number, ys[1] as number)
      : (s: number, ys: number[]): number[] => {
          const [da, db] = f(-s, ys[0] as number, ys[1] as number);
          return [-da, -db];
        };
    const tStart = forward ? t0 : -t0;
    const tEnd = forward ? target : -target;
    let seeded = false;
    for (const step of Numerical.rk4(odeFn, [state0[0], state0[1]], tStart, tEnd, h)) {
      if (!seeded) {
        seeded = true; // rk4 always emits the initial condition as its first step -- dropped here, spliced back once by the caller
        continue;
      }
      const t = forward ? step.t : -step.t;
      const a = step.y[0] as number;
      const b = step.y[1] as number;
      if (!Number.isFinite(a) || !Number.isFinite(b)) break;
      run.push({ t, state: [a, b] });
    }
    return run;
  }

  const backwardRun = collectRun(tDomain.min).reverse();
  const forwardRun = collectRun(tDomain.max);
  return [...backwardRun, { t: t0, state: [state0[0], state0[1]] }, ...forwardRun];
}

/**
 * Converts a trajectory into a phase-plane Path2D (state[0] on the x axis,
 * state[1] on the y axis, `t` dropped) for rendering via `drawPath` -- the
 * 2D-system analogue of sampleOdeSolution returning a Path2D directly.
 * `sampleOdeSystem2D` always includes at least the seed point, so `trajectory`
 * is never empty in practice here.
 */
export function odeSystemTrajectoryToPhasePath(trajectory: OdeTrajectoryPoint[], color = SOLUTION_COLOR): Path2D {
  return GraphUtils.vectorToCurve(
    Vector.fromArray(trajectory.map((p) => Vector.fromArray(p.state))),
    2,
    color,
  );
}

/**
 * Samples the 2D direction field dstate/dt = f(t, state) over an
 * `xDomain`×`yDomain` grid at a fixed `t` -- the phase-portrait analogue of
 * sampleSlopeField, except a genuine vector (dx, dy) rather than one scalar
 * slope, since a coupled system's flow direction isn't representable as a
 * single number the way dy/dx is. Points where the field isn't finite are
 * omitted, same convention as sampleSlopeField.
 */
export function sampleVectorField2D(
  spec: OdeSystemSpec,
  xDomain: Domain,
  yDomain: Domain,
  t = 0,
  gridDensity = 15,
): VectorFieldPoint[] {
  const f = compileSystem(spec);
  const points: VectorFieldPoint[] = [];
  for (let i = 0; i < gridDensity; i++) {
    const x = xDomain.min + (i / (gridDensity - 1)) * (xDomain.max - xDomain.min);
    for (let j = 0; j < gridDensity; j++) {
      const y = yDomain.min + (j / (gridDensity - 1)) * (yDomain.max - yDomain.min);
      const [dx, dy] = f(t, x, y);
      if (Number.isFinite(dx) && Number.isFinite(dy)) points.push({ x, y, dx, dy });
    }
  }
  return points;
}

export interface Ode2ndOrderCoeffs {
  a: number;
  b: number;
  c: number;
}

export type Ode2ndOrderRootCase = "distinct-real" | "repeated" | "complex";

/** Classifies `a*y''+b*y'+c*y=0`'s characteristic-equation roots by discriminant, matching Symbolic.solveOde2ndOrderConstCoeff's own three cases (same 1e-9 tolerance for "repeated"). */
export function classifyOde2ndOrderRoots({ a, b, c }: Ode2ndOrderCoeffs): { discriminant: number; rootCase: Ode2ndOrderRootCase } {
  const discriminant = b * b - 4 * a * c;
  const rootCase: Ode2ndOrderRootCase = Math.abs(discriminant) < 1e-9 ? "repeated" : discriminant > 0 ? "distinct-real" : "complex";
  return { discriminant, rootCase };
}

export interface Ode2ndOrderClosedFormAttempt {
  found: boolean;
  latex?: string;
  discriminant?: number;
  rootCase?: Ode2ndOrderRootCase;
  /** Present only when `!found` -- currently only "a === 0" (DegenerateOdeError), surfaced rather than swallowed since it's the one avoidable failure mode here (unlike attemptOdeClosedForm, where "no elementary closed form" is the expected common case). */
  message?: string;
}

/**
 * Closed form for the homogeneous, constant-coefficient `a*y''+b*y'+c*y=0`,
 * `y(x0)=y0`, `y'(x0)=yPrime0`, via `Symbolic.solveOde2ndOrderConstCoeff`.
 * That method always solves for `a !== 0` (it's built from the
 * characteristic equation, not an iterative/heuristic search), so the only
 * failure case is the degenerate `a === 0` one.
 */
export function attemptOde2ndOrderClosedForm(coeffs: Ode2ndOrderCoeffs, x0: number, y0: number, yPrime0: number): Ode2ndOrderClosedFormAttempt {
  const { a, b, c } = coeffs;
  try {
    const expr = Symbolic.solveOde2ndOrderConstCoeff(a, b, c, x0, y0, yPrime0);
    const { discriminant, rootCase } = classifyOde2ndOrderRoots(coeffs);
    return { found: true, latex: exprToLatex(expr), discriminant, rootCase };
  } catch (e) {
    return { found: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Numeric RK4 trajectory of `a*y''+b*y'+c*y=0`, `y(x0)=y0`, `y'(x0)=yPrime0`,
 * across `xDomain` -- the self-check counterpart to
 * `attemptOde2ndOrderClosedForm`'s symbolic solution (the two should overlap
 * when plotted together). Converts to the first-order system `[y, y']`
 * directly with plain numeric derivatives -- `a`/`b`/`c` are already
 * numbers, so unlike `sampleOdeSolution` there's no `Symbolic.compile`
 * round-trip needed -- and reuses the same bidirectional-RK4 shape
 * (`Numerical.rk4` forward from x0, and backward via the `s = -x`
 * substitution) as `sampleOdeSolution`/`sampleOdeSystem2D`.
 */
export function sampleOde2ndOrderSolution(
  coeffs: Ode2ndOrderCoeffs,
  x0: number,
  y0: number,
  yPrime0: number,
  xDomain: Domain,
  steps = 200,
): Path2D {
  const { a, b, c } = coeffs;
  if (a === 0) return GraphUtils.vectorToCurve(Vector.fromArray([Vector.fromArray([x0, y0])]), 2, SOLUTION_COLOR);

  const f = (state: number[]): number[] => {
    const y = state[0] as number;
    const yp = state[1] as number;
    return [yp, (-b * yp - c * y) / a];
  };

  function collectRun(target: number): number[][] {
    const run: number[][] = [];
    if (Math.abs(target - x0) < 1e-12) return run;
    const forward = target > x0;
    const h = Math.abs(target - x0) / steps;
    const odeFn = forward ? (_t: number, state: number[]): number[] => f(state) : (_s: number, state: number[]): number[] => f(state).map((v) => -v);
    const t0 = forward ? x0 : -x0;
    const t1 = forward ? target : -target;
    for (const step of Numerical.rk4(odeFn, [y0, yPrime0], t0, t1, h)) {
      const x = forward ? step.t : -step.t;
      const y = step.y[0] as number;
      if (!Number.isFinite(y)) break;
      run.push([x, y]);
    }
    return run;
  }

  const backwardRun = collectRun(xDomain.min).reverse();
  const forwardRun = collectRun(xDomain.max);
  if (backwardRun.length > 0) backwardRun.pop();

  const runs = [backwardRun, forwardRun].filter((run) => run.length > 0);
  if (runs.length === 0) {
    return GraphUtils.vectorToCurve(Vector.fromArray([Vector.fromArray([x0, y0])]), 2, SOLUTION_COLOR);
  }
  const segments = runs.map((run) => GraphUtils.vectorToCurve(Vector.fromArray(run.map((p) => Vector.fromArray(p))), 2, SOLUTION_COLOR));
  return { stroke: (segments[0] as Path2D).stroke, commands: segments.flatMap((s) => s.commands) };
}

/**
 * Samples dy/dx = f(x, y) over a grid spanning `xDomain`×`yDomain` for a
 * slope-field renderer. Points where `f` isn't finite (e.g. a genuine
 * singularity of the vector field) are simply omitted.
 */
export function sampleSlopeField(
  expr: Expr | string,
  xDomain: Domain,
  yDomain: Domain,
  gridDensity = 17,
): SlopeFieldPoint[] {
  const parsed = typeof expr === "string" ? Symbolic.parse(preprocessImplicitMultiplication(expr)) : expr;
  const compiled = Symbolic.compile(parsed);
  const points: SlopeFieldPoint[] = [];
  for (let i = 0; i < gridDensity; i++) {
    const x = xDomain.min + (i / (gridDensity - 1)) * (xDomain.max - xDomain.min);
    for (let j = 0; j < gridDensity; j++) {
      const y = yDomain.min + (j / (gridDensity - 1)) * (yDomain.max - yDomain.min);
      const slope = compiled({ x, y });
      if (Number.isFinite(slope)) points.push({ x, y, slope });
    }
  }
  return points;
}
