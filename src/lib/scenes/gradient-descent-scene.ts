/**
 * Statically-importable ecmanim scene for GradientDescentPanel's video
 * export (`export-gradient-descent-video.ts`) -- johnhenry/mallory#337.
 * Exports the 3D view (loss surface + racing optimizer paths) -- the
 * panel's 2D contour canvas and 3D surface share a single `TransportControls`
 * clock, so only one export button/scene is needed, and the 3D view is
 * where the surface itself is visible (the whole point of a video export
 * here, vs. the 2D contour PNG export the panel already had).
 *
 * Must be a top-level export and deterministic given `params` -- see
 * `ode-scene.ts`'s doc comment for why (worker_threads re-`import()` by
 * path + export name, segment-cache correctness).
 *
 * The surface-building half (z-range sampling, `ThreeDAxes`, checkerboard
 * `Surface`, camera/depth-sorting setup) is copied from `surface-scene.ts`
 * almost unmodified -- same shape, `f(x, y)` evaluated directly via
 * `Symbolic.compile` rather than through `sample-surface.ts`'s Mesh format
 * (that format is for Three.js consumption; ecmanim's `Surface` mobject
 * already wants a plain `(u, v) => point` function, matching
 * `surface-scene.ts`'s own convention).
 *
 * The racing-paths half reuses the exact same `runGradientDescent` the
 * panel calls (not a re-implementation) and, like `ode-scene.ts`, traces
 * each path via a `Dot` + `TracedPath` driven by one shared `ValueTracker`
 * -- one tracker drives every optimizer's dot in lockstep, matching the
 * panel's own single shared `TIME_CELL` clock racing all optimizers
 * against real elapsed time (`visiblePathIndex`): a shorter/diverged run
 * just holds at its own last point once the tracker outruns its path
 * length, exactly like `visiblePathIndex`'s own clamp.
 */
import { Dot, rate_functions, Surface, ThreeDAxes, ThreeDCamera, ThreeDScene, TracedPath, Transform, ValueTracker } from "ecmanim/node";
import { Symbolic } from "@johnhenry/math";
import { preprocessImplicitMultiplication } from "../implicit-mult.ts";
import { runGradientDescent, type OptimizerType } from "../gradient-descent.ts";

const SURFACE_COLORS = ["#3b82f6", "#60a5fa"];
const SURFACE_RESOLUTION = 28; // matches surface-scene.ts's own measured-tractable resolution.
const DOMAIN = { min: -5, max: 5 }; // matches GradientDescentPanel.tsx's own DOMAIN.

const OPTIMIZER_COLORS: Record<OptimizerType, string> = {
  sgd: "#2563eb",
  adam: "#dc2626",
  rmsprop: "#16a34a",
};

export interface GradientDescentSceneParams {
  exprText: string;
  startX: number;
  startY: number;
  lr: number;
  steps: number;
  /** Which optimizers are racing -- mirrors the panel's showSgd/showAdam/showRmsprop checkboxes. */
  optimizers: OptimizerType[];
  useSchedule: boolean;
  stepSize?: number;
  gamma?: number;
  momentum: number;
  nesterov: boolean;
  duration: number;
}

/** Same padding/fallback convention as surface-scene.ts's own padZExtent. */
function padZExtent(zMin: number, zMax: number): [number, number] {
  if (!Number.isFinite(zMin) || !Number.isFinite(zMax)) return [-1, 1];
  if (zMax - zMin < 1e-9) return [zMin - 1, zMax + 1];
  const pad = (zMax - zMin) * 0.1;
  return [zMin - pad, zMax + pad];
}

/** Coarse [zMin, zMax] sample of `f` over DOMAIN x DOMAIN, same shape as surface-scene.ts's own sampleZExtent. */
function surfaceZRange(f: (x: number, y: number) => number): [number, number] {
  let zMin = Number.POSITIVE_INFINITY;
  let zMax = Number.NEGATIVE_INFINITY;
  const N = 24;
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const x = DOMAIN.min + (i / N) * (DOMAIN.max - DOMAIN.min);
      const y = DOMAIN.min + (j / N) * (DOMAIN.max - DOMAIN.min);
      const z = f(x, y);
      if (!Number.isFinite(z)) continue;
      if (z < zMin) zMin = z;
      if (z > zMax) zMax = z;
    }
  }
  return padZExtent(zMin, zMax);
}

export class GradientDescentExportScene extends ThreeDScene {
  constructor(config: any = {}) {
    super(config);
    this.camera = new ThreeDCamera({
      phi: (65 * Math.PI) / 180,
      theta: (-45 * Math.PI) / 180,
      zoom: 0.75,
      background: "#ffffff",
    });
  }

  override async construct(): Promise<void> {
    const data = this.params as GradientDescentSceneParams;
    const compiled = Symbolic.compile(preprocessImplicitMultiplication(data.exprText));
    const f = (x: number, y: number): number => compiled({ x, y });

    const schedule = data.useSchedule && data.stepSize != null && data.gamma != null ? { stepSize: data.stepSize, gamma: data.gamma } : undefined;
    const sgdMomentum = { momentum: data.momentum, nesterov: data.nesterov };
    const runs = data.optimizers.map((optimizer) => ({
      optimizer,
      result: runGradientDescent(data.exprText, data.startX, data.startY, optimizer, data.lr, data.steps, schedule, sgdMomentum),
    }));
    const maxSteps = Math.max(0, ...runs.map((r) => r.result.path.length - 1));

    const [zMin, zMax] = surfaceZRange(f);

    const axes = new ThreeDAxes({
      xRange: [DOMAIN.min, DOMAIN.max, (DOMAIN.max - DOMAIN.min) / 10],
      yRange: [DOMAIN.min, DOMAIN.max, (DOMAIN.max - DOMAIN.min) / 10],
      zRange: [zMin, zMax, (zMax - zMin) / 4],
      xLength: 6,
      yLength: 6,
      zLength: 3,
    });
    // A pole/hole still has to return *a* point (Surface tessellates a full
    // grid); clamp to the axes' z extent, same as surface-scene.ts.
    const clampZ = (z: number): number => (Number.isFinite(z) ? Math.min(Math.max(z, zMin), zMax) : zMin);
    const surface = new Surface((u: number, v: number) => axes.c2p(u, v, clampZ(f(u, v))), {
      uRange: [DOMAIN.min, DOMAIN.max],
      vRange: [DOMAIN.min, DOMAIN.max],
      resolution: SURFACE_RESOLUTION,
      checkerboardColors: SURFACE_COLORS,
      fillOpacity: 0.85,
    });
    this.enableDepthSorting(true);
    this.add(axes, surface);

    const tracker = new ValueTracker(0);
    for (const run of runs) {
      if (run.result.path.length === 0) continue;
      const color = OPTIMIZER_COLORS[run.optimizer];
      const at = (): number[] => {
        const frac = Math.min(1, Math.max(0, tracker.getValue() / data.duration));
        const stepIndex = maxSteps > 0 ? Math.min(Math.floor(frac * maxSteps), run.result.path.length - 1) : 0;
        const p = run.result.path[stepIndex]!;
        return axes.c2p(p.x, p.y, clampZ(p.f));
      };
      const dot = new Dot({ point: at(), color, radius: 0.1 });
      dot.addUpdater(() => {
        dot.moveTo(at());
      });
      const trail = new TracedPath(() => dot.getCenter(), { strokeColor: color, strokeWidth: 4 });
      this.add(trail, dot);
    }

    const target = tracker.copy();
    target.setValue(data.duration);
    this.beginAmbientCameraRotation({ rate: (2 * Math.PI) / data.duration });
    await this.play(new Transform(tracker, target, { rateFunc: rate_functions.linear }), { runTime: data.duration });
    this.stopAmbientCameraRotation();
  }
}
