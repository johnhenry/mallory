/**
 * Statically-importable ecmanim scene for the first-order ODE video export
 * (`export-ode-video.ts`) -- johnhenry/mallory-graph#210. See
 * `expression-2d-scene.ts`'s header comment for why this had to move out of
 * an in-request closure (`buildOdeConstruct`) and into its own module that
 * reads everything from ecmanim's `params` argument: `renderParallel`'s
 * worker_threads re-`import()` the scene by file path + export name, and the
 * per-segment partial cache requires `construct()` to be deterministic given
 * the same params.
 */
import { ArrowVectorField, Axes, Dot, rate_functions, TracedPath, Transform, ValueTracker } from "ecmanim/node";
import { Symbolic } from "mallory-math";
import { AXIS_COLOR } from "../export-render.ts";
import { preprocessImplicitMultiplication } from "../implicit-mult.ts";
import { sampleOdeSolution } from "../sample-ode.ts";

const TRACE_COLOR = "#16a34a";
const HEAD_COLOR = "#dc2626";
const FIELD_MIN_COLOR = "#93c5fd";
const FIELD_MAX_COLOR = "#1d4ed8";
/** Scene-space grid pitch for the field arrows -- ~13 columns across the 7-unit-wide axes. */
const FIELD_STEP = 0.55;

export interface OdeSceneParams {
  /** dy/dx as an expression in x and y. */
  source: string;
  x0: number;
  y0: number;
  viewport: { xMin: number; xMax: number; yMin: number; yMax: number };
  duration: number;
}

/**
 * The RK4 trajectory split into the two runs a viewer watches grow from the
 * initial condition: `forward` ascending x0 -> xMax, `backward` descending
 * x0 -> xMin. Either may be empty (x0 at a domain edge, or an immediate
 * blow-up).
 */
function splitTrajectory(data: OdeSceneParams): { forward: [number, number][]; backward: [number, number][] } {
  const path = sampleOdeSolution(
    data.source,
    data.x0,
    data.y0,
    { min: data.viewport.xMin, max: data.viewport.xMax },
    240,
  );
  const points = path.commands.map((c) => [c.x, c.y] as [number, number]);
  // Seam: the point closest to x0 (sampleOdeSolution seeds both runs there).
  let seam = 0;
  let best = Number.POSITIVE_INFINITY;
  points.forEach(([x], i) => {
    const d = Math.abs(x - data.x0);
    if (d < best) {
      best = d;
      seam = i;
    }
  });
  return {
    forward: points.slice(seam),
    backward: points.slice(0, seam + 1).reverse(),
  };
}

export async function construct(scene: any, data: OdeSceneParams): Promise<void> {
  const compiled = Symbolic.compile(preprocessImplicitMultiplication(data.source));
  const slope = (x: number, y: number): number => compiled({ x, y });
  const { forward, backward } = splitTrajectory(data);
  const { viewport, duration } = data;

  const axes = new Axes({
    xRange: [viewport.xMin, viewport.xMax, (viewport.xMax - viewport.xMin) / 10],
    yRange: [viewport.yMin, viewport.yMax, (viewport.yMax - viewport.yMin) / 10],
    xLength: 7,
    yLength: 6.4,
    axisConfig: { color: AXIS_COLOR },
    // See expression-2d-scene.ts's identical config for the fontSize rationale.
    xAxisConfig: { includeNumbers: true, fontSize: 0.24 },
    yAxisConfig: { includeNumbers: true, fontSize: 0.24 },
  });
  scene.add(axes);

  const [sxMin, syMin] = axes.c2p(viewport.xMin, viewport.yMin);
  const [sxMax, syMax] = axes.c2p(viewport.xMax, viewport.yMax);
  const field = new ArrowVectorField(
    (p: number[]) => {
      const [x, y] = axes.p2c(p);
      const m = slope(x, y);
      if (!Number.isFinite(m)) return [0, 0, 0];
      const n = Math.hypot(1, m);
      const a = axes.c2p(x, y);
      const b = axes.c2p(x + 1 / n, y + m / n);
      return [b[0] - a[0], b[1] - a[1], 0];
    },
    {
      xRange: [sxMin, sxMax, FIELD_STEP],
      yRange: [syMin, syMax, FIELD_STEP],
      minColor: FIELD_MIN_COLOR,
      maxColor: FIELD_MAX_COLOR,
    },
  );
  scene.add(field);

  const tracker = new ValueTracker(0);
  const runs = [forward, backward].filter((run) => run.length > 1);
  for (const run of runs) {
    const at = (): number[] => {
      const frac = Math.min(1, Math.max(0, tracker.getValue() / duration));
      const [x, y] = run[Math.min(run.length - 1, Math.floor(frac * (run.length - 1)))] as [number, number];
      return axes.c2p(x, y);
    };
    const dot = new Dot({ point: at(), color: HEAD_COLOR, radius: 0.08 });
    dot.addUpdater(() => {
      dot.moveTo(at());
    });
    const trail = new TracedPath(() => dot.getCenter(), { strokeColor: TRACE_COLOR, strokeWidth: 4 });
    scene.add(trail, dot);
  }

  const target = tracker.copy();
  target.setValue(duration);
  await scene.play(new Transform(tracker, target, { rateFunc: rate_functions.linear }), { runTime: duration });
}
