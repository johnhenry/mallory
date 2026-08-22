import { GraphUtils, Symbolic, Vector, type Expr, type Path2D } from "@johnhenry/math";
import { preprocessImplicitMultiplication } from "./implicit-mult.ts";
import { memoizeLru } from "./memoize-lru.ts";

export interface Domain {
  min: number;
  max: number;
}

/**
 * Sample a single-variable expression over a domain into a @johnhenry/math
 * Path2D. Uses Symbolic.compile (a closure tree built once) rather than
 * evaluate (which re-parses/re-walks the AST per call) since this runs
 * `resolution` times per render. String input is run through the
 * implicit-multiplication preprocessor first, since Symbolic.parse's grammar
 * requires an explicit `*` between factors. `params` (e.g. slider values for
 * free variables like `a`,`b` in `a*x^2+b`) is merged into the environment
 * object once outside the sampling loop, mutating only the axis field per
 * iteration, to avoid reallocating per sample.
 *
 * `GraphUtils.vectorToCurve` (upstream, unmodifiable) connects every point
 * unconditionally via `lineTo` -- a NaN/Infinity sample (e.g. at an
 * asymptote, or a piecewise/comparison expression's discontinuity) would
 * otherwise draw a garbage line straight through the gap. Segmenting the
 * samples into contiguous finite runs first, and calling `vectorToCurve`
 * once per run, produces the gap for free: each run's own leading `moveTo`
 * becomes the break when the command arrays are concatenated.
 *
 * `visibleYRange`, when supplied, extends this same run-breaking to a
 * near-asymptote sample that's huge but still finite (e.g. `tan(x)` a few
 * grid steps from a pole might sample ~50 or ~600 depending how close the
 * grid lands, never actually `Infinity`) -- a magnitude check ("is this
 * point way outside the visible plot"), not a sign check, so it uniformly
 * covers both sign-changing poles (`tan`/`cot`) and same-sign blow-ups
 * (`1/x^2`) with one rule. Omitted, behavior is unchanged from before this
 * parameter existed.
 */
export function isOffVisibleRange(y: number, visibleYRange?: { min: number; max: number }): boolean {
  if (!visibleYRange) return false;
  const span = visibleYRange.max - visibleYRange.min;
  return Math.abs(y) > Math.abs(visibleYRange.min) + Math.abs(visibleYRange.max) + 5 * span;
}

/**
 * Where the segment `a`-`b` crosses `visibleYRange`'s nearer boundary
 * (`min` if `b` undershoots, `max` if it overshoots) -- linear
 * interpolation, the same technique `findConditionCrossings` already uses
 * for a threshold crossing between two samples. Returns `null` when
 * interpolation isn't meaningful: no `visibleYRange`, either endpoint is
 * non-finite (a genuine singularity/NaN gap has no boundary to aim for --
 * unlike an off-visible-range gap, which is finite by definition), or the
 * two y-values coincide.
 */
function boundaryCrossing(
  a: { x: number; y: number },
  b: { x: number; y: number },
  visibleYRange?: { min: number; max: number },
): { x: number; y: number } | null {
  if (!visibleYRange || !Number.isFinite(a.y) || !Number.isFinite(b.y) || a.y === b.y) return null;
  // Inset 3% of the span from the true edge -- landing exactly on
  // visibleYRange's boundary would put a discontinuity marker (a circle
  // with its own radius) centered right on the canvas edge, half clipped
  // off-screen by the canvas itself.
  const span = visibleYRange.max - visibleYRange.min;
  const inset = 0.03 * span;
  const boundary = b.y > a.y ? visibleYRange.max - inset : visibleYRange.min + inset;
  const t = (boundary - a.y) / (b.y - a.y);
  if (!Number.isFinite(t) || t < 0 || t > 1) return null;
  return { x: a.x + t * (b.x - a.x), y: boundary };
}

/**
 * Shared run-segmentation for `sampleExpr`/`sampleExprAdaptive`: splits a
 * flat point list into contiguous "valid" (finite, and within
 * `visibleYRange` when supplied) runs, the same gap-tolerant-run mechanism
 * both functions' own doc comments describe. When a run ends or begins at
 * an off-visible-range point (not a genuine NaN/Infinity singularity), the
 * run is capped with an interpolated point at the visible boundary
 * (`boundaryCrossing`) rather than either drawing the huge raw sample or
 * abruptly stopping mid-canvas -- this makes the curve visually run right
 * up to the plot's edge before gapping, and gives `findDiscontinuities`'s
 * `before`/`after` marker points a location that's actually on-screen,
 * instead of off at the sampled value's own (possibly enormous) y.
 */
function pointsToRuns(points: { x: number; y: number }[], visibleYRange?: { min: number; max: number }): Vector<number>[][] {
  const runs: Vector<number>[][] = [[]];
  let prevPoint: { x: number; y: number } | null = null;
  let prevValid = false;
  for (const p of points) {
    const finite = Number.isFinite(p.y);
    const valid = finite && !isOffVisibleRange(p.y, visibleYRange);
    const currentRun = runs[runs.length - 1] as Vector<number>[];
    if (valid) {
      if (!prevValid && prevPoint) {
        const entry = boundaryCrossing(prevPoint, p, visibleYRange);
        if (entry) currentRun.push(Vector.fromArray([entry.x, entry.y]));
      }
      currentRun.push(Vector.fromArray([p.x, p.y]));
    } else {
      if (prevValid && prevPoint && finite) {
        const exit = boundaryCrossing(prevPoint, p, visibleYRange);
        if (exit) currentRun.push(Vector.fromArray([exit.x, exit.y]));
      }
      if (currentRun.length > 0) runs.push([]);
    }
    prevPoint = p;
    prevValid = valid;
  }
  return runs;
}

export function sampleExpr(
  expr: Expr | string,
  domain: Domain,
  resolution: number,
  variable = "x",
  params: Record<string, number> = {},
  color = 0x2563eb,
  visibleYRange?: { min: number; max: number },
): Path2D {
  const compiled = Symbolic.compile(typeof expr === "string" ? preprocessImplicitMultiplication(expr) : expr);
  const env: Record<string, number> = { ...params, [variable]: 0 };
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < resolution; i++) {
    const x = domain.min + (i / (resolution - 1)) * (domain.max - domain.min);
    env[variable] = x;
    points.push({ x, y: compiled(env) });
  }
  const runs = pointsToRuns(points, visibleYRange);
  const segments = runs.filter((run) => run.length > 0).map((run) => GraphUtils.vectorToCurve(Vector.fromArray(run), 2, color));
  if (segments.length === 0) return GraphUtils.vectorToCurve(Vector.fromArray([]), 2, color);
  return { stroke: (segments[0] as Path2D).stroke, commands: segments.flatMap((s) => s.commands) };
}

export interface AdaptiveOptions {
  /** How many times a single base-grid segment may be bisected. */
  maxDepth?: number;
  /**
   * A segment is bisected further when its midpoint sample deviates from
   * straight-line interpolation by more than this, in absolute y-units.
   * Explicit here always wins; omitted and no `visibleYRange` falls back to
   * `FALLBACK_ABSOLUTE_TOLERANCE`. The usual case (`visibleYRange` given,
   * no override) instead scales with the viewport via
   * {@link resolveAdaptiveTolerance} -- see its own doc comment.
   */
  tolerance?: number;
}

/** Absolute-y-unit fallback when `tolerance` is unset AND there's no `visibleYRange` to scale against (`sampleExprAdaptiveImpl`'s pre-#52 constant, kept for that one case). */
const FALLBACK_ABSOLUTE_TOLERANCE = 1e-3;

/**
 * The visible y-span's `RELATIVE_TOLERANCE_FRACTION` -- refine until a
 * segment's deviation from straight-line interpolation is under this
 * fraction of the CURRENT viewport's y-range, e.g. zoomed in to a span of 1
 * unit refines down to a 1e-4 y-unit deviation; zoomed out to a span of
 * 1000 only refines down to a 0.1 y-unit deviation. A fixed absolute
 * tolerance (this function's behavior before issue #52's "refinement
 * budget" follow-up) doesn't have this property: zoomed in on a subtly
 * curved region, the same curve could read as visually straight-line-
 * segmented (not enough refinement per what's now a much larger fraction
 * of the visible area) -- or, zoomed out, waste refinement depth resolving
 * curvature too fine to render as more than a single pixel of deviation
 * anyway.
 */
const RELATIVE_TOLERANCE_FRACTION = 1e-4;

/** Resolves `AdaptiveOptions.tolerance` per its own doc comment: explicit override > `visibleYRange`-relative > absolute fallback. Pure and directly unit-testable, independent of the sampling logic around it. */
export function resolveAdaptiveTolerance(explicitTolerance: number | undefined, visibleYRange?: { min: number; max: number }): number {
  if (explicitTolerance !== undefined) return explicitTolerance;
  if (visibleYRange) return (visibleYRange.max - visibleYRange.min) * RELATIVE_TOLERANCE_FRACTION;
  return FALLBACK_ABSOLUTE_TOLERANCE;
}

/**
 * Like `sampleExpr`, but refines the fixed uniform grid where the curve is
 * locally non-linear: for each pair of adjacent base-grid points, evaluate
 * the midpoint and compare it to straight-line interpolation between the
 * two -- if they disagree by more than `tolerance` (see
 * {@link resolveAdaptiveTolerance}, viewport-relative by default), recurse
 * into both halves (up to `maxDepth`). A segment that's already locally
 * straight adds no extra points, so a gentle curve costs the same as
 * `sampleExpr`, while a sharp bend or narrow spike that a uniform grid
 * could straddle gets resolved.
 *
 * `visibleYRange`: see `sampleExpr`'s own doc comment -- same off-visible-
 * plot run-breaking, also applied inside `refine` so bisection doesn't
 * waste depth smoothing a region that's about to be gapped anyway.
 */
function sampleExprAdaptiveImpl(
  expr: Expr | string,
  domain: Domain,
  baseResolution: number,
  variable = "x",
  params: Record<string, number> = {},
  color = 0x2563eb,
  options: AdaptiveOptions = {},
  visibleYRange?: { min: number; max: number },
): Path2D {
  const { maxDepth = 4 } = options;
  const tolerance = resolveAdaptiveTolerance(options.tolerance, visibleYRange);
  const compiled = Symbolic.compile(typeof expr === "string" ? preprocessImplicitMultiplication(expr) : expr);
  const env: Record<string, number> = { ...params, [variable]: 0 };
  function evalAt(x: number): number {
    env[variable] = x;
    return compiled(env);
  }

  const basePoints: { x: number; y: number }[] = [];
  for (let i = 0; i < baseResolution; i++) {
    const x = domain.min + (i / (baseResolution - 1)) * (domain.max - domain.min);
    basePoints.push({ x, y: evalAt(x) });
  }

  function refine(a: { x: number; y: number }, b: { x: number; y: number }, depth: number): { x: number; y: number }[] {
    if (
      depth >= maxDepth ||
      !Number.isFinite(a.y) ||
      !Number.isFinite(b.y) ||
      isOffVisibleRange(a.y, visibleYRange) ||
      isOffVisibleRange(b.y, visibleYRange)
    ) {
      return [a];
    }
    const xm = (a.x + b.x) / 2;
    const ym = evalAt(xm);
    // A non-finite midpoint means a singularity lives between a and b -- let
    // the base grid's own gap-detection (below) handle that boundary rather
    // than forcing a bad sample into the middle of an otherwise-good run.
    if (!Number.isFinite(ym)) return [a];
    const linearY = (a.y + b.y) / 2;
    if (Math.abs(ym - linearY) <= tolerance) return [a];
    const mid = { x: xm, y: ym };
    return [...refine(a, mid, depth + 1), ...refine(mid, b, depth + 1)];
  }

  const refinedPoints: { x: number; y: number }[] = [];
  for (let i = 0; i < basePoints.length - 1; i++) {
    refinedPoints.push(...refine(basePoints[i] as { x: number; y: number }, basePoints[i + 1] as { x: number; y: number }, 0));
  }
  const last = basePoints[basePoints.length - 1];
  if (last) refinedPoints.push(last);

  const runs = pointsToRuns(refinedPoints, visibleYRange);
  const segments = runs.filter((run) => run.length > 0).map((run) => GraphUtils.vectorToCurve(Vector.fromArray(run), 2, color));
  if (segments.length === 0) return GraphUtils.vectorToCurve(Vector.fromArray([]), 2, color);
  return { stroke: (segments[0] as Path2D).stroke, commands: segments.flatMap((s) => s.commands) };
}

/**
 * `sampleExprAdaptiveImpl`, memoized (issue #52's "memoization audit" work
 * item) -- see `memoizeLru`'s own doc comment for why: `CellGraph`'s
 * dependency tracking already skips a redundant call when nothing changed,
 * but has no memory of a past call, so panning back to an exact previous
 * viewport (e.g. a double-click reset) re-triggers a from-scratch resample
 * even though the result is identical to one already computed. This is the
 * only production call site (`ExpressionRow.tsx`), so wrapping the export
 * here benefits it with no call-site changes needed.
 */
export const sampleExprAdaptive = memoizeLru(sampleExprAdaptiveImpl);

/**
 * Samples a `cmp` (comparison) Expr at the same resolution/grid as
 * `sampleExpr`, producing one boolean per sample point (true where the
 * comparison holds), for grid-based 1D inequality shading along the x-axis.
 * Returns `null` if `expr`'s top-level node isn't a `cmp` node -- so callers
 * can pass any parsed expression and get "nothing to shade" for the common
 * (non-inequality) case, rather than needing to check the type themselves.
 */
export function sampleRegionMask(
  expr: Expr,
  domain: Domain,
  resolution: number,
  variable = "x",
  params: Record<string, number> = {},
): boolean[] | null {
  if (expr.type !== "cmp") return null;
  const compiled = Symbolic.compile(expr);
  const env: Record<string, number> = { ...params, [variable]: 0 };
  const mask = new Array<boolean>(resolution);
  for (let i = 0; i < resolution; i++) {
    const x = domain.min + (i / (resolution - 1)) * (domain.max - domain.min);
    env[variable] = x;
    mask[i] = compiled(env) !== 0;
  }
  return mask;
}

/**
 * Flags where a sampled path crosses a condition boundary, via
 * `toSignedDistance`: a function of `y` whose *sign* says which side of the
 * condition a point is on, and whose *magnitude* is a plain linear distance
 * from the boundary (so lerping it to zero between two adjacent points
 * locates the crossing) -- e.g. `y - threshold` for "crosses a threshold",
 * or plain `y` (identity) for "crosses zero", which is
 * {@link findRootCrossings}'s original, single hardcoded case. A boolean
 * predicate alone (`y >= threshold`) isn't enough information to
 * interpolate *where* between two samples the crossing actually falls --
 * only a signed, lerpable quantity is, which is why this takes a number-
 * returning function rather than the boolean one this started as. A
 * declarative "condition" derived from the curve's own sampled data,
 * decoupled from how (or whether) a consumer draws it -- the Open
 * MCT-inspired condition-object/styling-consumer pattern from the research
 * roadmap. `moveTo` commands (the start of a new gap-tolerant run -- see
 * `sampleExpr`) are skipped as a *left* endpoint of a pair, since a
 * `moveTo` means the previous run ended at a singularity/undefined point,
 * not a real condition change into this new run.
 */
export function findConditionCrossings(path: Path2D, toSignedDistance: (y: number) => number): { x: number; y: number }[] {
  const crossings: { x: number; y: number }[] = [];
  for (let i = 1; i < path.commands.length; i++) {
    const prev = path.commands[i - 1];
    const curr = path.commands[i];
    if (!prev || !curr || curr.op !== "lineTo") continue;
    const dPrev = toSignedDistance(prev.y);
    const dCurr = toSignedDistance(curr.y);
    if (dPrev >= 0 === dCurr >= 0) continue;
    const t = dPrev / (dPrev - dCurr);
    crossings.push({ x: prev.x + t * (curr.x - prev.x), y: prev.y + t * (curr.y - prev.y) });
  }
  return crossings;
}

/** Where a sampled path crosses y=0 -- {@link findConditionCrossings} with the one condition this shipped for originally. */
export function findRootCrossings(path: Path2D): { x: number; y: number }[] {
  return findConditionCrossings(path, (y) => y).map((c) => ({ x: c.x, y: 0 }));
}

/**
 * Flags every discontinuity (gap) in a sampled path -- each `moveTo` after
 * the first command marks where the previous contiguous run ended at a
 * singularity or left the function's domain (see `sampleExpr`'s own
 * gap-tolerant-run doc comment) and a new run began. The same declarative
 * "condition cell, decoupled from drawing" pattern as
 * {@link findConditionCrossings}, applied to "this curve has a
 * discontinuity/domain boundary here" instead of "crosses a threshold."
 * Returns the last point of the run *before* the gap and the first point
 * of the run *after* it, so a consumer can mark both edges (e.g. open
 * circles) rather than guessing a single representative location for a
 * gap whose true width isn't known any more precisely than the sampling
 * resolution.
 */
export function findDiscontinuities(path: Path2D): { before: { x: number; y: number }; after: { x: number; y: number } }[] {
  const gaps: { before: { x: number; y: number }; after: { x: number; y: number } }[] = [];
  for (let i = 1; i < path.commands.length; i++) {
    const curr = path.commands[i];
    if (curr?.op !== "moveTo") continue;
    const prev = path.commands[i - 1];
    if (!prev) continue;
    gaps.push({ before: { x: prev.x, y: prev.y }, after: { x: curr.x, y: curr.y } });
  }
  return gaps;
}

/**
 * Where two expressions' curves cross, over a shared domain -- the same
 * "flag a sign change" technique as {@link findRootCrossings}, applied to
 * `fA(x) - fB(x)` instead of `fA(x)` itself, i.e. an intersection is just a
 * root crossing of the difference function. Deliberately re-evaluates both
 * expressions on one freshly-built, uniform grid (not each row's own
 * already-sampled `Path2D`, which `GraphCanvasMulti` builds via
 * `sampleExprAdaptive` at each curve's own curvature-driven resolution and
 * x-positions) -- two rows' adaptive samples essentially never land at the
 * same x, so comparing them directly would be comparing points that aren't
 * actually at the same x. A uniform shared grid sidesteps that entirely.
 */
export function findIntersections(
  exprA: Expr | string,
  paramsA: Record<string, number>,
  exprB: Expr | string,
  paramsB: Record<string, number>,
  domain: Domain,
  resolution = 400,
  variable = "x",
): { x: number; y: number }[] {
  const compiledA = Symbolic.compile(typeof exprA === "string" ? preprocessImplicitMultiplication(exprA) : exprA);
  const compiledB = Symbolic.compile(typeof exprB === "string" ? preprocessImplicitMultiplication(exprB) : exprB);
  const envA: Record<string, number> = { ...paramsA, [variable]: 0 };
  const envB: Record<string, number> = { ...paramsB, [variable]: 0 };
  const points: { x: number; y: number }[] = [];
  let prevX: number | null = null;
  let prevDiff: number | null = null;
  for (let i = 0; i < resolution; i++) {
    const x = domain.min + (i / (resolution - 1)) * (domain.max - domain.min);
    envA[variable] = x;
    envB[variable] = x;
    const a = compiledA(envA);
    const b = compiledB(envB);
    const diff = a - b;
    const finiteDiff = Number.isFinite(diff) ? diff : null;
    if (prevX !== null && prevDiff !== null && finiteDiff !== null && (prevDiff >= 0) !== (finiteDiff >= 0)) {
      const t = prevDiff / (prevDiff - finiteDiff);
      const xi = prevX + t * (x - prevX);
      envA[variable] = xi;
      points.push({ x: xi, y: compiledA(envA) });
    }
    prevX = x;
    prevDiff = finiteDiff;
  }
  return points;
}
